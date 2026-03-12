import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

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
    } else if (path.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    // Кэширование для продакшена
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

app.use(express.static(staticPath, {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    } else if (path.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
  }
}));

// База данных SQLite
let db;

async function initDatabase() {
  // ВАЖНО: Используем корень проекта для постоянного хранения в Railway
  const dbPath = path.resolve(__dirname, 'calendar.db');
  
  db = new sqlite3.Database(dbPath);
  
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Таблица пользователей
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          telegram_id INTEGER UNIQUE NOT NULL,
          role TEXT NOT NULL DEFAULT 'VIEWER' CHECK (role IN ('OWNER', 'ADMIN', 'VIEWER')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Таблица закрытых дат
      db.run(`
        CREATE TABLE IF NOT EXISTS closed_dates (
          id SERIAL PRIMARY KEY,
          date TEXT UNIQUE NOT NULL,
          closed_by BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
          // Если таблица уже есть с другими типами (Postgres legacy), SQLite это проглотит или создаст новую
      });
      
      // Таблица настроек
      db.run(`
        CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY DEFAULT 1,
          background_image TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, () => {
        // Вставляем начальные настройки
        db.run(`INSERT OR IGNORE INTO settings (id, background_image) VALUES (1, NULL)`);
      });
    });
    
    console.log('SQLite database initialized at:', dbPath);
    resolve();
  });
}

// Проверка подписи Telegram WebApp
function verifyTelegramWebAppData(initData) {
  if (initData === 'browser_mode') return true;
  const secret = crypto.createHmac('sha256', 'WebAppData')
    .update(process.env.BOT_TOKEN || '')
    .digest();
  
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  
  const hmac = crypto.createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');
  
  return hmac === hash;
}

// Middleware авторизации
async function authMiddleware(req, res, next) {
  try {
    const initData = req.headers['x-telegram-init-data'];
    
    if (!initData) {
      return res.status(401).json({ error: 'No init data provided' });
    }
    
    if (initData === 'browser_mode') {
      req.user = { id: 0, username: 'browser', first_name: 'Browser' };
      req.userRole = 'OWNER'; // Для отладки в браузере даем права
      return next();
    }
    
    if (!verifyTelegramWebAppData(initData)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    const params = new URLSearchParams(initData);
    const user = JSON.parse(params.get('user'));
    
    req.user = user;
    
    // Очистка ID от любых лишних символов
    const adminIdsStr = process.env.ADMIN_IDS || '';
    const adminIds = adminIdsStr.split(',').map(id => id.replace(/[^0-9]/g, '').trim()).filter(id => id !== '');
    const userIdStr = user.id.toString().replace(/[^0-9]/g, '').trim();
    const isEnvAdmin = adminIds.includes(userIdStr);

    console.log(`[AUTH] UserID: "${userIdStr}", AdminList: ${JSON.stringify(adminIds)}, Match: ${isEnvAdmin}`);

    // Получаем роль пользователя из БД
    db.get('SELECT role FROM users WHERE telegram_id = ?', [user.id], (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      let role = row ? row.role : 'VIEWER';
      if (isEnvAdmin) role = 'OWNER';
      
      req.userRole = role;

      if (!row) {
        db.run('INSERT INTO users (telegram_id, role) VALUES (?, ?)', [user.id, role], () => next());
      } else {
        if (row.role !== role) {
          db.run('UPDATE users SET role = ? WHERE telegram_id = ?', [role, user.id]);
        }
        next();
      }
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

// Проверка роли администратора
function requireAdmin(req, res, next) {
  if (req.userRole !== 'ADMIN' && req.userRole !== 'OWNER') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Получить закрытые даты за месяц
app.get('/api/calendar', authMiddleware, (req, res) => {
  const { year, month } = req.query;
  const formattedMonth = month.toString().padStart(2, '0');
  const pattern = `${year}-${formattedMonth}-%`;
  
  db.all(
    'SELECT date FROM closed_dates WHERE date LIKE ? ORDER BY date',
    [pattern],
    (err, rows) => {
      if (err) {
        console.error('Get calendar error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.json({
        closedDates: rows || [],
        userRole: req.userRole,
        version: 'v1021-final'
      });
    }
  );
});

// Переключить дату
app.post('/api/calendar/toggle', authMiddleware, requireAdmin, (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'Date required' });
  
  // УБРАНО ОГРАНИЧЕНИЕ НА ПРОШЕДШИЕ ДАТЫ
  
  db.get('SELECT id FROM closed_dates WHERE date = ?', [date], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    
    if (row) {
      db.run('DELETE FROM closed_dates WHERE date = ?', [date], (err) => {
        if (err) return res.status(500).json({ error: 'Failed to open date' });
        res.json({ status: 'opened', date });
      });
    } else {
      db.run('INSERT INTO closed_dates (date, closed_by) VALUES (?, ?)', [date, req.user.id], (err) => {
        if (err) return res.status(500).json({ error: 'Failed to close date' });
        res.json({ status: 'closed', date });
      });
    }
  });
});

app.get('/api/user', authMiddleware, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.userRole });
});

app.get('/api/settings', authMiddleware, (req, res) => {
  db.get('SELECT background_image FROM settings LIMIT 1', (err, row) => {
    res.json({ backgroundImage: row?.background_image || null });
  });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(staticPath, 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`Server v1021 running on port ${PORT}`);
  await initDatabase();
});
