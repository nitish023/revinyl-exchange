import pg from 'pg';

/**
 * One connection pool per process. Neon (production) needs SSL, which the
 * connection string turns on with ?sslmode=require.
 * @param {string} connectionString
 */
export function createPool(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  pool.on('error', (error) => console.error('[db] idle client error:', error.message));
  return pool;
}

/**
 * Run `work` inside a transaction. Commits if it resolves, rolls back if it throws.
 * @template T
 * @param {pg.Pool} pool
 * @param {(client: pg.PoolClient) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
