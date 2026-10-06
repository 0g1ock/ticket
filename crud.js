require('dotenv').config();
const mysql = require('mysql2/promise');


const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ticket_booking',
    waitForConnections: true,
    connectionLimit: 10
});


async function createEvent(title, category) {
    try {
        const [result] = await pool.query(
            'INSERT INTO events (title, category) VALUES (?, ?)',
            [title, category]
        );
        console.log(`[CREATE] Мероприятие успешно создано с ID: ${result.insertId}`);
        return result.insertId;
    } catch (err) {
        console.error('[CREATE ERROR] Ошибка при создании:', err.message);
        return null;
    }
}


async function getAllEvents() {
    try {
        const [rows] = await pool.query('SELECT * FROM events');
        console.log(`[READ ALL] Получено мероприятий из базы: ${rows.length}`);
        return rows;
    } catch (err) {
        console.error('[READ ERROR] Ошибка при получении списка:', err.message);
        return [];
    }
}

async function getEventById(id) {
    try {
        const [rows] = await pool.query('SELECT * FROM events WHERE id = ?', [id]);
        if (rows.length === 0) {
            console.log(`[READ ONE] Мероприятие с ID ${id} не найдено.`);
            return null;
        }
        console.log(`[READ ONE] Найдено мероприятие: "${rows[0].title}"`);
        return rows[0];
    } catch (err) {
        console.error('[READ ERROR] Ошибка при поиске по ID:', err.message);
        return null;
    }
}


async function updateEvent(id, newTitle, newCategory) {
    try {
        const [result] = await pool.query(
            'UPDATE events SET title = COALESCE(?, title), category = COALESCE(?, category) WHERE id = ?',
            [newTitle, newCategory, id]
        );
        if (result.affectedRows === 0) {
            console.log(`[UPDATE] Мероприятие с ID ${id} не найдено для обновления.`);
            return false;
        }
        console.log(`[UPDATE] Мероприятие с ID ${id} успешно обновлено.`);
        return true;
    } catch (err) {
        console.error('[UPDATE ERROR] Ошибка обновления:', err.message);
        return false;
    }
}


async function deleteEvent(id) {
    try {
        const [result] = await pool.query('DELETE FROM events WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            console.log(`[DELETE] Мероприятие с ID ${id} не найдено для удаления.`);
            return false;
        }
        console.log(`[DELETE] Мероприятие с ID ${id} успешно удалено.`);
        return true;
    } catch (err) {
        console.error('[DELETE ERROR] Ошибка удаления:', err.message);
        return false;
    }
}


async function runCrudTest() {
    console.log(' ЗАПУСК ТЕСТИРОВАНИЯ CRUD-ОПЕРАЦИЙ\n');

   
    const newId = await createEvent('Тестовый спектакль', 'Театр');

    
    await getAllEvents();

   
    await getEventById(newId);

  
    await getEventById(99999);

    
    await updateEvent(newId, 'Обновленный спектакль', 'Театр и Шоу');

    
    await deleteEvent(newId);

    console.log('\n ТЕСТИРОВАНИЕ УСПЕШНО ЗАВЕРШЕНО ');
    process.exit(0);
}


runCrudTest();