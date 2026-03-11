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
  const dbPath = process.env.NODE_ENV === 'production' 
    ? '/tmp/calendar.db'  // Railway разрешает писать в /tmp
    : './calendar.db';
  
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
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT UNIQUE NOT NULL,
          closed_by INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
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
      req.userRole = 'VIEWER';
      return next();
    }
    
    if (!verifyTelegramWebAppData(initData)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    const params = new URLSearchParams(initData);
    const user = JSON.parse(params.get('user'));
    
    req.user = user;
    
    // Получаем роль пользователя
    db.get('SELECT role FROM users WHERE telegram_id = ?', [user.id], (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!row) {
        // Создаем нового пользователя как VIEWER
        db.run('INSERT INTO users (telegram_id, role) VALUES (?, ?)', [user.id, 'VIEWER'], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to create user' });
          }
          req.userRole = 'VIEWER';
          next();
        });
      } else {
        req.userRole = row.role;
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

// Проверка роли владельца
function requireOwner(req, res, next) {
  if (req.userRole !== 'OWNER') {
    return res.status(403).json({ error: 'Owner access required' });
  }
  next();
}

// Получить закрытые даты за месяц
app.get('/api/calendar', authMiddleware, (req, res) => {
  const { year, month } = req.query;
  
  if (!year || !month) {
    return res.status(400).json({ error: 'Year and month required' });
  }
  
  const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${month.toString().padStart(2, '0')}-${lastDay}`;
  
  db.all(
    'SELECT date, closed_by, created_at FROM closed_dates WHERE date >= ? AND date <= ? ORDER BY date',
    [startDate, endDate],
    (err, rows) => {
      if (err) {
        console.error('Get calendar error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      res.json({
        closedDates: rows,
        userRole: req.userRole,
        timezone: 'Europe/Moscow'
      });
    }
  );
});

// Переключить дату
app.post('/api/calendar/toggle', authMiddleware, requireAdmin, (req, res) => {
  const { date } = req.body;
  
  if (!date) {
    return res.status(400).json({ error: 'Date required' });
  }
  
  // Проверяем, не прошла ли дата
  const targetDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (targetDate < today) {
    return res.status(400).json({ error: 'Cannot modify past dates' });
  }
  
  // Проверяем, закрыта ли дата
  db.get('SELECT id FROM closed_dates WHERE date = ?', [date], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (row) {
      // Открываем дату
      db.run('DELETE FROM closed_dates WHERE date = ?', [date], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to open date' });
        }
        res.json({ status: 'opened', date });
      });
    } else {
      // Закрываем дату
      db.run('INSERT INTO closed_dates (date, closed_by) VALUES (?, ?)', [date, req.user.id], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to close date' });
        }
        res.json({ status: 'closed', date });
      });
    }
  });
});

// Получить информацию о пользователе
app.get('/api/user', authMiddleware, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    firstName: req.user.first_name,
    lastName: req.user.last_name,
    role: req.userRole
  });
});

// Добавить администратора (только OWNER)
app.post('/api/admin/add', authMiddleware, requireOwner, (req, res) => {
  const { telegramId } = req.body;
  
  if (!telegramId) {
    return res.status(400).json({ error: 'Telegram ID required' });
  }
  
  db.run(
    'INSERT OR REPLACE INTO users (telegram_id, role) VALUES (?, ?)',
    [telegramId, 'ADMIN'],
    (err) => {
      if (err) {
        console.error('Add admin error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.json({ success: true, message: 'Admin added' });
    }
  );
});

// Удалить администратора (только OWNER)
app.post('/api/admin/remove', authMiddleware, requireOwner, (req, res) => {
  const { telegramId } = req.body;
  
  if (!telegramId) {
    return res.status(400).json({ error: 'Telegram ID required' });
  }
  
  db.run(
    "UPDATE users SET role = 'VIEWER' WHERE telegram_id = ? AND role = 'ADMIN'",
    [telegramId],
    (err) => {
      if (err) {
        console.error('Remove admin error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.json({ success: true, message: 'Admin removed' });
    }
  );
});

// Инициализация владельца
app.post('/api/init-owner', (req, res) => {
  const { telegramId, secret } = req.body;
  
  if (secret !== process.env.INIT_SECRET) {
    return res.status(403).json({ error: 'Invalid secret' });
  }
  
  db.run(
    'INSERT OR REPLACE INTO users (telegram_id, role) VALUES (?, ?)',
    [telegramId, 'OWNER'],
    (err) => {
      if (err) {
        console.error('Init owner error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.json({ success: true, message: 'Owner initialized' });
    }
  );
});

// Получить настройки
app.get('/api/settings', authMiddleware, (req, res) => {
  db.get('SELECT background_image FROM settings LIMIT 1', (err, row) => {
    if (err) {
      console.error('Get settings error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.json({ backgroundImage: row?.background_image || null });
  });
});

// Обновить фон (только OWNER)
app.post('/api/settings/background', authMiddleware, requireOwner, (req, res) => {
  const { backgroundImage } = req.body;
  
  db.run(
    'INSERT OR REPLACE INTO settings (id, background_image, updated_at) VALUES (1, ?, datetime("now"))',
    [backgroundImage],
    (err) => {
      if (err) {
        console.error('Update background error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.json({ success: true, backgroundImage });
    }
  );
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timezone: 'Europe/Moscow' });
});

// Serve frontend
app.get('*', (req, res) => {
  // Если запрос к API, но не найден - возвращаем 404
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  // Для всех остальных путей (навигация фронтенда) возвращаем index.html
  res.sendFile(path.join(staticPath, 'index.html'));
});

// Запуск сервера
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Timezone: Europe/Moscow`);
  
  await initDatabase();
});
