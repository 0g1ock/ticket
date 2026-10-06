require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());

// 1. Подключение к БД
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ticket_booking',
    waitForConnections: true,
    connectionLimit: 10
});

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key';

// 2. Middleware для проверки токена и ролей (Задание 2)
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

// ==========================================
// ЗАДАНИЕ 2: АВТОРИЗАЦИЯ
// ==========================================
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Укажите email и пароль' });
        
        const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        const user = rows[0];
        
        // Сравнение пароля (в тестовых данных БД лежат bcrypt-хеши)
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
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ==========================================
// ЗАДАНИЯ 3 И 4: CRUD ОПЕРАЦИИ (REST API)
// ==========================================

// READ (Все записи)
app.get('/api/events', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM events');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// READ (Одна запись по ID)
app.get('/api/events/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM events WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Мероприятие не найдено' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// CREATE (Доступно только админу)
app.post('/api/events', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const { title, category } = req.body;
        if (!title || !category) return res.status(400).json({ error: 'Заполните title и category' });
        
        const [result] = await pool.query('INSERT INTO events (title, category) VALUES (?, ?)', [title, category]);
        res.status(201).json({ id: result.insertId, title, category, message: 'Мероприятие создано' });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка создания мероприятия' });
    }
});

// UPDATE (Доступно только админу)
app.patch('/api/events/:id', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const { title, category } = req.body;
        const [result] = await pool.query(
            'UPDATE events SET title = COALESCE(?, title), category = COALESCE(?, category) WHERE id = ?',
            [title, category, req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Мероприятие не найдено' });
        res.json({ message: 'Мероприятие успешно обновлено' });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка обновления мероприятия' });
    }
});

// DELETE (Доступно только админу)
app.delete('/api/events/:id', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM events WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Мероприятие не найдено' });
        res.json({ message: 'Мероприятие успешно удалено' });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка удаления мероприятия' });
    }
});

// ==========================================
// ЗАДАНИЕ 5: ЭКСПОРТ В CSV
// ==========================================
app.get('/api/events/export', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, title, category FROM events');
        let csvContent = 'ID;Название;Категория\n';
        rows.forEach(row => {
            csvContent += `${row.id};"${row.title}";"${row.category}"\n`;
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="events_list.csv"');
        res.send('\uFEFF' + csvContent); // \uFEFF - BOM для корректной кириллицы в Excel
    } catch (err) {
        res.status(500).json({ error: 'Ошибка выгрузки CSV' });
    }
});

// ==========================================
// ЗАДАНИЕ 6: СТАТИСТИЧЕСКИЕ ОТЧЕТЫ
// ==========================================
app.get('/api/reports/orders-stats', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const [byStatus] = await pool.query('SELECT status, COUNT(*) AS count FROM orders GROUP BY status');
        const [summary] = await pool.query('SELECT COUNT(*) AS total_orders FROM orders');
        const [byUser] = await pool.query(
            'SELECT u.fio, u.email, COUNT(o.id) AS orders_count FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.id, u.fio, u.email'
        );
        res.json({
            report_name: 'Отчет по состояниям заказов',
            total_orders: summary[0]?.total_orders || 0,
            orders_by_status: byStatus,
            orders_by_user: byUser
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка формирования отчета' });
    }
});

// ==========================================
// ДОП. ФУНКЦИОНАЛ: БРОНИРОВАНИЕ МЕСТ
// ==========================================
app.get('/api/sessions/:id/seats', async (req, res) => {
    try {
        const [seats] = await pool.query(
            `SELECT st.id AS seat_id, r.row_index AS row_number, st.seat_num, st.is_free 
             FROM seats st 
             JOIN \`rows\` r ON st.row_id = r.id 
             WHERE st.hall_id = (SELECT hall_id FROM sessions WHERE id = ?)`,
            [req.params.id]
        );
        res.json(seats);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения мест' });
    }
});

app.post('/api/orders', authenticateToken, async (req, res) => {
    try {
        const { session_id, seat_id } = req.body;
        if (!session_id || !seat_id) return res.status(400).json({ error: 'Укажите session_id и seat_id' });
        
        const [orderResult] = await pool.query('INSERT INTO orders (user_id, status) VALUES (?, "new")', [req.user.id]);
        await pool.query('INSERT INTO tickets (order_id, session_id, seat_id) VALUES (?, ?, ?)', [orderResult.insertId, session_id, seat_id]);
        
        res.status(201).json({ message: 'Заказ успешно создан', order_id: orderResult.insertId });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка оформления заказа' });
    }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));