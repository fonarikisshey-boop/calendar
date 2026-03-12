import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Инициализация бота
const botToken = process.env.BOT_TOKEN;
let bot;
if (botToken) {
  bot = new TelegramBot(botToken, { polling: false });
  console.log('[INIT] Telegram Bot initialized for reports');
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

// База данных
let pool = null;
let sqliteDb = null;
const isPostgres = !!process.env.DATABASE_URL;

async function initDatabase() {
  if (isPostgres) {
    console.log('[DB] Connecting to PostgreSQL...');
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          telegram_id BIGINT UNIQUE NOT NULL,
          role TEXT NOT NULL DEFAULT 'VIEWER',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS closed_dates (
          id SERIAL PRIMARY KEY,
          date TEXT UNIQUE NOT NULL,
          closed_by BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('[DB] PostgreSQL tables initialized');
    } catch (err) {
      console.error('[DB ERROR] PostgreSQL init failed:', err.message);
    }
  } else {
    console.log('[DB] Using SQLite database');
    const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/calendar.db' : './calendar.db';
    sqliteDb = new sqlite3.Database(dbPath);
    sqliteDb.serialize(() => {
      sqliteDb.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER UNIQUE NOT NULL, role TEXT NOT NULL DEFAULT 'VIEWER', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      sqliteDb.run(`CREATE TABLE IF NOT EXISTS closed_dates (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT UNIQUE NOT NULL, closed_by INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    });
  }
}

// Хелперы для БД
async function dbQuery(sql, params = []) {
  if (isPostgres) {
    const pgSql = sql.replace(/\?/g, (_, i) => `$${params.indexOf(params[i]) + 1}`); // Simple ? to $n conversion
    // For more robust conversion:
    let count = 1;
    const finalSql = sql.replace(/\?/g, () => `$${count++}::text`);
    const res = await pool.query(finalSql, params);
    return res.rows;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });
  }
}

async function dbGet(sql, params = []) {
  const rows = await dbQuery(sql, params);
  return rows[0];
}

async function dbRun(sql, params = []) {
  if (isPostgres) {
    let count = 1;
    const finalSql = sql.replace(/\?/g, () => `$${count++}::text`);
    await pool.query(finalSql, params);
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(sql, params, (err) => err ? reject(err) : resolve());
    });
  }
}

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
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()).filter(id => id !== '');
    const isEnvAdmin = adminIds.some(id => id === user.id.toString());
    console.log(`[AUTH] Checking user ${user.id} against admins ${JSON.stringify(adminIds)}. Is Admin: ${isEnvAdmin}`);

    const row = await dbGet('SELECT role FROM users WHERE telegram_id = ?', [user.id]);
    let role = row ? row.role : 'VIEWER';
    if (isEnvAdmin) role = 'OWNER';
    req.userRole = role;
    
    if (!row) {
      await dbRun('INSERT INTO users (telegram_id, role) VALUES (?, ?)', [user.id, role]);
    } else if (row.role !== role) {
      await dbRun('UPDATE users SET role = ? WHERE telegram_id = ?', [role, user.id]);
    }
    next();
  } catch (err) {
    console.error('[AUTH ERROR]', err.message);
    res.status(500).json({ error: 'Auth internal error' });
  }
}

// API Routes
app.get('/api/calendar', authMiddleware, async (req, res) => {
  try {
    const { year, month } = req.query;
    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endDate = `${year}-${month.toString().padStart(2, '0')}-31`;
    const rows = await dbQuery('SELECT date FROM closed_dates WHERE date >= ? AND date <= ?', [startDate, endDate]);
    res.json({ closedDates: (rows || []).map(r => r.date), userRole: req.userRole });
  } catch (err) {
    console.error('[API ERROR] Get calendar failed:', err.message);
    res.status(500).json({ error: 'Failed to load dates' });
  }
});

app.post('/api/calendar/toggle', authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== 'ADMIN' && req.userRole !== 'OWNER') return res.status(403).json({ error: 'Forbidden' });
    const { date } = req.body;
    console.log(`[TOGGLE] Processing date: ${date} by admin ${req.user.id}`);

    const row = await dbGet('SELECT id FROM closed_dates WHERE date = ?', [date]);
    if (row) {
      await dbRun('DELETE FROM closed_dates WHERE date = ?', [date]);
      console.log(`[TOGGLE SUCCESS] Date ${date} is now OPEN`);
      res.json({ status: 'opened' });
    } else {
      await dbRun('INSERT INTO closed_dates (date, closed_by) VALUES (?, ?)', [date, req.user.id]);
      console.log(`[TOGGLE SUCCESS] Date ${date} is now CLOSED`);
      res.json({ status: 'closed' });
    }
  } catch (err) {
    console.error('[TOGGLE ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user', authMiddleware, (req, res) => res.json({ id: req.user.id, role: req.userRole }));

// Cron report
cron.schedule('0 18 * * 0', async () => {
  console.log('[CRON] Generating weekly report...');
  if (!bot) return;
  try {
    const rows = await dbQuery('SELECT date FROM closed_dates ORDER BY date ASC');
    if (!rows || rows.length === 0) return;
    const report = rows.map(r => `📅 ${r.date}`).join('\n');
    const message = `📊 *Еженедельный отчет по бронированиям*\n\nСписок всех закрытых дат:\n${report}`;
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()).filter(id => id !== '');
    for (const adminId of adminIds) {
      try { await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' }); } 
      catch (e) { console.error(`[CRON ERROR] Failed to send to ${adminId}:`, e.message); }
    }
  } catch (err) { console.error('[CRON ERROR]', err.message); }
});

app.get('*', (req, res) => res.sendFile(path.join(staticPath, 'index.html')));

app.listen(PORT, async () => {
  console.log(`[SERVER] Running on port ${PORT}`);
  await initDatabase();
});
