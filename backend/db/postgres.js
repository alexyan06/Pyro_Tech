const { Pool } = require('pg');

let pool = null;
let connected = false;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/ember',
      max: 5,
    });
    pool.on('error', (err) => {
      console.warn('[Postgres] Pool error:', err.message);
      connected = false;
    });
  }
  return pool;
}

async function query(text, params) {
  if (!connected) {
    try {
      const p = getPool();
      await p.query('SELECT 1');
      connected = true;
    } catch (err) {
      console.warn('[Postgres] Not available, skipping query:', err.message);
      return { rows: [] };
    }
  }
  return getPool().query(text, params);
}

async function initDB() {
  try {
    const p = getPool();
    await p.query('SELECT 1');
    connected = true;
    console.log('[Postgres] Connected');
  } catch (err) {
    console.warn('[Postgres] Not available, running without persistence:', err.message);
  }
}

module.exports = { query, initDB, getPool };
