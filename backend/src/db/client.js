const { Pool } = require('pg');

// Initialize Postgres pool using environment variables or defaults
const pool = new Pool({
  user: process.env.DB_USER || 'aicreator',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'aicreator_db',
  password: process.env.DB_PASSWORD || 'aicreator',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  max: 20, // Max concurrent connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Test connection on startup
pool.on('connect', () => {
  console.log('[DB] PostgreSQL pool connected successfully.');
});

pool.on('error', (err) => {
  console.error('[DB Error] Unexpected error on idle client:', err);
});

/**
 * Helper to run queries with parameter binding
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DB Query] Executed in ${duration}ms | Rows: ${res.rowCount}`);
    }
    return res;
  } catch (err) {
    console.error(`[DB Error] Query failed: ${text}`, err);
    throw err;
  }
}

/**
 * Helper for running transactions safely
 */
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DB Transaction Error] Rolled back transaction:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query,
  transaction,
};