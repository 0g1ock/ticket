require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key';

// Подключение к пулу базы данных
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ticket_booking',
    waitForConnections: true,
    connectionLimit: 10
});

// --- МИДДЛВАРИ АВТОРИЗАЦИИ ---

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Доступ запрещен (токен отсутствует)' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен' });
        req.user = user;
        next();
    });
}

function requireRole(role) {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) {
            return res.status(403).json({ error: 'Недостаточно прав' });
        }
        next();
    };
}

// --- ЭНДПОИНТЫ АВТОРИЗАЦИИ ---

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Укажите email и пароль' });
        }

        const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        const user = rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '4h' }
        );

        res.json({ message: 'Успешный вход', token, role: user.role });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера при входе' });
    }
});

// --- CRUD МЕРОПРИЯТИЙ (С учетом таблицы категорий) ---
// --- ЭКСПОРТ CSV ---

app.get('/api/events/export', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT e.id, e.title, ec.name AS category 
            FROM events e 
            JOIN event_categories ec ON e.category_id = ec.id
        `);
        let csvContent = 'ID;Название;Категория\n';
        rows.forEach(row => {
            csvContent += `${row.id};"${row.title}";"${row.category}"\n`;
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="events_list.csv"');
        res.send('\uFEFF' + csvContent);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка выгрузки CSV' });
    }
});

// Получение списка всех мероприятий (сJOIN категории)
app.get('/api/events', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT e.id, e.title, ec.name AS category 
            FROM events e 
            JOIN event_categories ec ON e.category_id = ec.id
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения мероприятий' });
    }
});

// Получение конкретного мероприятия по ID
app.get('/api/events/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT e.id, e.title, ec.name AS category 
            FROM events e 
            JOIN event_categories ec ON e.category_id = ec.id 
            WHERE e.id = ?
        `, [req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Мероприятие не найдено' });
        }
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Создание мероприятия (админ)
app.post('/api/events', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const { title, category_id } = req.body;
        if (!title || !category_id) {
            return res.status(400).json({ error: 'Заполните title и category_id' });
        }

        const [result] = await pool.query(
            'INSERT INTO events (title, category_id) VALUES (?, ?)',
            [title, category_id]
        );
        res.status(201).json({ id: result.insertId, title, category_id, message: 'Мероприятие создано' });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка создания мероприятия' });
    }
});

// --- CRUD / Эндпоинты для управления залами (Задание 4) ---

// Получение списка всех залов (публичный)
app.get('/api/halls', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM halls');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения списка залов' });
    }
});

// Создание нового зала (только для администратора)
app.post('/api/halls', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const { name, capacity } = req.body;
        if (!name || !capacity) {
            return res.status(400).json({ error: 'Заполните name и capacity' });
        }
        
        const [result] = await pool.query(
            'INSERT INTO halls (name, capacity) VALUES (?, ?)',
            [name, capacity]
        );
        
        res.status(201).json({ 
            id: result.insertId, 
            name, 
            capacity, 
            message: 'Зал успешно создан' 
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка создания зала' });
    }
});

// --- СТАТИСТИЧЕСКИЕ ОТЧЕТЫ (Задание 6) ---

// Отчет по статусам заказов (с учетом таблицы order_statuses)
app.get('/api/reports/orders-stats', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const [byStatus] = await pool.query(`
            SELECT os.name AS status, COUNT(o.id) AS count 
            FROM order_statuses os 
            LEFT JOIN orders o ON os.id = o.status_id 
            GROUP BY os.id, os.name
        `);
        const [summary] = await pool.query('SELECT COUNT(*) AS total_orders FROM orders');
        const [byUser] = await pool.query(`
            SELECT u.fio, u.email, COUNT(o.id) AS orders_count 
            FROM users u 
            LEFT JOIN orders o ON u.id = o.user_id 
            GROUP BY u.id
        `);
        res.json({
            report_name: 'Отчет по состояниям заказов',
            total_orders: summary[0]?.total_orders || 0,
            orders_by_status: byStatus,
            orders_by_user: byUser
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка формирования отчета по заказам' });
    }
});

// Отчет по популярности мероприятий (Задание 6)
app.get('/api/reports/events-stats', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                e.id AS event_id,
                e.title AS event_title,
                ec.name AS category,
                COUNT(DISTINCT s.id) AS total_sessions,
                COUNT(t.id) AS total_tickets_sold
            FROM events e
            JOIN event_categories ec ON e.category_id = ec.id
            LEFT JOIN sessions s ON e.id = s.event_id
            LEFT JOIN tickets t ON s.id = t.session_id
            GROUP BY e.id, e.title, ec.name
            ORDER BY total_tickets_sold DESC
        `);
        
        res.json({
            report_name: 'Отчет по популярности мероприятий',
            events_analytics: rows
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка формирования отчета по мероприятиям' });
    }
});

// --- ВРЕМЕННЫЙ МАРШРУТ ДЛЯ СОЗДАНИЯ АДМИНА (если понадобится) ---
app.post('/api/auth/make-admin', async (req, res) => {
    try {
        const hash = await bcrypt.hash('admin123', 10);
        await pool.query(
            'INSERT INTO users (fio, email, password_hash, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role)',
            ['Администратор', 'real_admin@ticket.ru', hash, 'admin']
        );
        res.json({ message: 'Админ успешно создан/обновлен!', email: 'real_admin@ticket.ru', password: 'admin123' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});