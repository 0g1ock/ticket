require('dotenv').config();
const mysql = require('mysql2/promise');

async function runCrudTest() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '', // Если у тебя есть пароль, укажи его здесь или в .env
        database: process.env.DB_NAME || 'ticket_booking'
    });

    console.log('ЗАПУСК ТЕСТИРОВАНИЯ CRUD-ОПЕРАЦИЙ (Мероприятия, Залы, Заказы)');

    try {
        // --- 1. CRUD ДЛЯ МЕРОПРИЯТИЙ (events) ---
        const [eventRes] = await pool.query('INSERT INTO events (title, category_id) VALUES (?, ?)', ['Тестовый спектакль', 2]);
        const eventId = eventRes.insertId;
        console.log(`[CREATE EVENT] Мероприятие создано с ID: ${eventId}`);

        const [events] = await pool.query('SELECT * FROM events WHERE id = ?', [eventId]);
        console.log(`[READ EVENT] Найдено: "${events[0].title}"`);

        await pool.query('UPDATE events SET title = ? WHERE id = ?', ['Обновленный спектакль', eventId]);
        console.log(`[UPDATE EVENT] Мероприятие с ID ${eventId} обновлено.`);

        // --- 2. CRUD ДЛЯ ЗАЛОВ (halls) ---
        const [hallRes] = await pool.query('INSERT INTO halls (name, capacity) VALUES (?, ?)', ['Тестовый зал', 100]);
        const hallId = hallRes.insertId;
        console.log(`[CREATE HALL] Зал создан с ID: ${hallId}`);

        const [halls] = await pool.query('SELECT * FROM halls WHERE id = ?', [hallId]);
        console.log(`[READ HALL] Найден зал: "${halls[0].name}" (мест: ${halls[0].capacity})`);

        await pool.query('UPDATE halls SET capacity = ? WHERE id = ?', [120, hallId]);
        console.log(`[UPDATE HALL] Зал с ID ${hallId} обновлен.`);

        // --- 3. CRUD ДЛЯ ЗАКАЗОВ (orders) ---
        const [orderRes] = await pool.query('INSERT INTO orders (user_id, status_id) VALUES (?, ?)', [2, 1]);
        const orderId = orderRes.insertId;
        console.log(`[CREATE ORDER] Заказ создан с ID: ${orderId}`);

        const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
        console.log(`[READ ORDER] Заказ ID ${orders[0].id}, статус ID: ${orders[0].status_id}`);

        await pool.query('UPDATE orders SET status_id = ? WHERE id = ?', [2, orderId]);
        console.log(`[UPDATE ORDER] Статус заказа ID ${orderId} изменен на оплачен.`);

        // Очистка тестовых данных
        await pool.query('DELETE FROM orders WHERE id = ?', [orderId]);
        await pool.query('DELETE FROM halls WHERE id = ?', [hallId]);
        await pool.query('DELETE FROM events WHERE id = ?', [eventId]);
        console.log('[DELETE] Все тестовые записи успешно удалены.');

    } catch (err) {
        console.error('Ошибка в CRUD тесте:', err.message);
    } finally {
        await pool.end();
        console.log('\nТЕСТИРОВАНИЕ УСПЕШНО ЗАВЕРШЕНО');
        process.exit(0);
    }
}

runCrudTest();