import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = 'v1020-sqlite-persistent';

// Инициализация бота
const botToken = process.env.BOT_TOKEN;
let bot;
if (botToken) {
  bot = new TelegramBot(botToken, { polling: false });
  console.log(`[INIT] Telegram Bot initialized for reports (${APP_VERSION})`);
}

// Middleware
app.use(cors());
app.use(express.json());

// Статические файлы
const staticPath = path.resolve(__dirname, '../frontend/dist');
app.use('/assets', express.static(path.join(staticPath, 'assets'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    else if (path.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
  }
}));
app.use(express.static(staticPath));

// База данных SQLite (локальная и сверхбыстрая)
// В Railway /tmp очищается при каждом перезапуске. Используем текущую папку для постоянного хранения.
const dbPath = path.resolve(__dirname, 'calendar.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    telegram_id INTEGER UNIQUE NOT NULL, 
    role TEXT NOT NULL DEFAULT 'VIEWER', 
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS closed_dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    date TEXT UNIQUE NOT NULL, 
    closed_by INTEGER NOT NULL, 
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  console.log('[DB] SQLite initialized at', dbPath);
});

// Хелперы для SQLite
const dbAll = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));
const dbGet = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
const dbRun = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));

// Проверка подписи Telegram
function verifyTelegramWebAppData(initData) {
  if (initData === 'browser_mode') return true;
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN || '').digest();
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const dataCheckString = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const hmac = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return hmac === hash;
}

// Auth Middleware
async function authMiddleware(req, res, next) {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'No init data' });
    if (!verifyTelegramWebAppData(initData)) return res.status(401).json({ error: 'Invalid signature' });

    let user;
    if (initData === 'browser_mode') user = { id: 0, username: 'browser' };
    else user = JSON.parse(new URLSearchParams(initData).get('user'));
    
    req.user = user;
    const userIdStr = user.id.toString().replace(/[^0-9]/g, '').trim();
    
    // Очистка списка админов
    const rawAdminIds = (process.env.ADMIN_IDS || '').split(',');
    const adminIds = rawAdminIds.map(id => id.replace(/[^0-9]/g, '').trim()).filter(id => id !== '');
    const isEnvAdmin = adminIds.includes(userIdStr);
    
    let role = isEnvAdmin ? 'OWNER' : 'VIEWER';
    req.userRole = role;
    
    // Фоновое обновление пользователя
    dbRun('INSERT OR REPLACE INTO users (telegram_id, role) VALUES (?, ?)', [user.id, role]).catch(e => console.error('[AUTH DB ERROR]', e.message));
    
    next();
  } catch (err) {
    console.error('[AUTH ERROR]', err.message);
    res.status(500).json({ error: 'Auth internal error' });
  }
}

// API Routes
app.get('/api/calendar', authMiddleware, async (req, res) => {
  try {
    let { year, month } = req.query;
    const formattedMonth = month.toString().padStart(2, '0');
    const pattern = `${year}-${formattedMonth}-%`;
    
    const rows = await dbAll('SELECT date FROM closed_dates WHERE date LIKE ?', [pattern]);
    console.log(`[LOAD] Loaded ${(rows || []).length} dates for ${year}-${month}`);
    res.json({ closedDates: (rows || []).map(r => r.date), userRole: req.userRole, version: APP_VERSION });
  } catch (err) {
    console.error('[API ERROR]', err.message);
    res.status(500).json({ error: 'Failed to load dates' });
  }
});

app.post('/api/calendar/toggle', authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== 'ADMIN' && req.userRole !== 'OWNER') return res.status(403).json({ error: 'Forbidden' });
    const { date } = req.body;
    
    const row = await dbGet('SELECT id FROM closed_dates WHERE date = ?', [date]);
    if (row) {
      await dbRun('DELETE FROM closed_dates WHERE date = ?', [date]);
      console.log(`[TOGGLE] Opened date: ${date}`);
      res.json({ status: 'opened' });
    } else {
      await dbRun('INSERT INTO closed_dates (date, closed_by) VALUES (?, ?)', [date, req.user.id]);
      console.log(`[TOGGLE] Closed date: ${date}`);
      res.json({ status: 'closed' });
    }
  } catch (err) {
    console.error('[TOGGLE ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user', authMiddleware, (req, res) => res.json({ id: req.user.id, role: req.userRole, version: APP_VERSION }));

// Еженедельный отчет (Воскресенье 18:00)
cron.schedule('0 18 * * 0', async () => {
  if (!bot) return;
  try {
    const rows = await dbAll('SELECT date FROM closed_dates ORDER BY date ASC');
    if (!rows || rows.length === 0) return;
    const report = rows.map(r => `📅 ${r.date}`).join('\n');
    const message = `📊 *Еженедельный отчет по бронированиям*\n\nЗакрытые даты:\n${report}`;
    const rawAdminIds = (process.env.ADMIN_IDS || '').split(',');
    const adminIds = rawAdminIds.map(id => id.replace(/[^0-9]/g, '').trim()).filter(id => id !== '');
    for (const adminId of adminIds) {
      try { await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' }); } 
      catch (e) { console.error(`[CRON ERROR]`, e.message); }
    }
  } catch (err) { console.error('[CRON ERROR]', err.message); }
});

app.get('*', (req, res) => res.sendFile(path.join(staticPath, 'index.html')));

app.listen(PORT, () => {
  console.log(`[SERVER] Running ${APP_VERSION} on port ${PORT}`);
});
