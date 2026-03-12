import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import ExcelJS from 'exceljs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Статические файлы
const staticPath = path.resolve(__dirname, '../frontend/dist');

// Правильные MIME типы для JS модулей
app.use('/assets', express.static(path.join(staticPath, 'assets'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    }
  }
}));

app.use(express.static(staticPath));

// База данных
let db;
const isPostgres = !!process.env.DATABASE_URL;

async function initDatabase() {
  if (isPostgres) {
    console.log('Using PostgreSQL database');
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    db = {
      all: (sql, params, cb) => pool.query(sql.replace(/\?/g, (m, i) => `$${i + 1}`), params).then(res => cb(null, res.rows)).catch(cb),
      get: (sql, params, cb) => pool.query(sql.replace(/\?/g, (m, i) => `$${i + 1}`), params).then(res => cb(null, res.rows[0])).catch(cb),
      run: (sql, params, cb) => pool.query(sql.replace(/\?/g, (m, i) => `$${i + 1}`), params).then(res => cb && cb(null)).catch(cb)
    };

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
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        background_image TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO settings (id, background_image) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;
    `);
  } else {
    console.log('Using SQLite database');
    const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/calendar.db' : './calendar.db';
    const sqliteDb = new sqlite3.Database(dbPath);
    db = sqliteDb;
    
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER UNIQUE NOT NULL, role TEXT NOT NULL DEFAULT 'VIEWER', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      db.run(`CREATE TABLE IF NOT EXISTS closed_dates (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT UNIQUE NOT NULL, closed_by INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      db.run(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY DEFAULT 1, background_image TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      db.run(`INSERT OR IGNORE INTO settings (id, background_image) VALUES (1, NULL)`);
    });
  }
}

// Проверка подписи Telegram WebApp
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

// Middleware авторизации
async function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) return res.status(401).json({ error: 'No init data' });
  if (!verifyTelegramWebAppData(initData)) return res.status(401).json({ error: 'Invalid signature' });

  let user;
  if (initData === 'browser_mode') {
    user = { id: 0, username: 'browser' };
  } else {
    const params = new URLSearchParams(initData);
    user = JSON.parse(params.get('user'));
  }
  
  req.user = user;
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()).filter(id => id !== '');
  const isEnvAdmin = adminIds.includes(user.id.toString());

  db.get('SELECT role FROM users WHERE telegram_id = ?', [user.id], (err, row) => {
    let role = row ? row.role : 'VIEWER';
    if (isEnvAdmin) role = 'OWNER';
    req.userRole = role;
    
    if (!row) {
      db.run('INSERT INTO users (telegram_id, role) VALUES (?, ?)', [user.id, role], () => next());
    } else {
      if (row.role !== role) db.run('UPDATE users SET role = ? WHERE telegram_id = ?', [role, user.id]);
      next();
    }
  });
}

// API Routes
app.get('/api/calendar', authMiddleware, (req, res) => {
  const { year, month } = req.query;
  const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
  const endDate = `${year}-${month.toString().padStart(2, '0')}-31`;
  
  db.all('SELECT date FROM closed_dates WHERE date >= ? AND date <= ?', [startDate, endDate], (err, rows) => {
    res.json({ closedDates: rows || [], userRole: req.userRole });
  });
});

app.post('/api/calendar/toggle', authMiddleware, (req, res) => {
  if (req.userRole !== 'ADMIN' && req.userRole !== 'OWNER') return res.status(403).json({ error: 'Forbidden' });
  const { date } = req.body;
  
  const targetDate = new Date(date); targetDate.setHours(0,0,0,0);
  const today = new Date(); today.setHours(0,0,0,0);
  if (targetDate < today) return res.status(400).json({ error: 'Past date' });

  db.get('SELECT id FROM closed_dates WHERE date = ?', [date], (err, row) => {
    if (row) {
      db.run('DELETE FROM closed_dates WHERE date = ?', [date], () => res.json({ status: 'opened' }));
    } else {
      db.run('INSERT INTO closed_dates (date, closed_by) VALUES (?, ?)', [date, req.user.id], () => res.json({ status: 'closed' }));
    }
  });
});

app.get('/api/user', authMiddleware, (req, res) => {
  res.json({ id: req.user.id, role: req.userRole });
});

// Экспорт в Excel (ручной запрос для теста)
app.get('/api/export', authMiddleware, async (req, res) => {
  if (req.userRole !== 'OWNER') return res.status(403).json({ error: 'Forbidden' });
  
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Closed Dates');
  sheet.columns = [
    { header: 'Дата', key: 'date', width: 15 },
    { header: 'Кто закрыл (ID)', key: 'closed_by', width: 20 },
    { header: 'Дата создания', key: 'created_at', width: 25 }
  ];

  db.all('SELECT * FROM closed_dates ORDER BY date DESC', [], async (err, rows) => {
    rows.forEach(row => sheet.addRow(row));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=report.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  });
});

// Еженедельный отчет (Cron)
cron.schedule('0 9 * * 1', () => {
  console.log('Generating weekly report...');
  // Здесь можно добавить отправку в Telegram через бота, если будет BOT_TOKEN
});

app.get('*', (req, res) => res.sendFile(path.join(staticPath, 'index.html')));

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initDatabase();
});
