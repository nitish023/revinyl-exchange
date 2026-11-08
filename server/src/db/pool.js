import pg from 'pg';

/**
 * pg returns bigint (int8) columns as strings, because JavaScript numbers can't hold
 * every bigint. Ours (ids, cents, counts) stay far below 2^53, so read them as numbers:
 * the matching engine refuses string ids and string money would compare wrongly.
 * A value too big to be exact throws instead of being rounded. (sum() of a bigint
 * column returns numeric, which stays a string: cast it, e.g. sum(price_cents)::bigint.)
 */
const INT8_OID = 20;
const INT8_ARRAY_OID = 1016;
const toSafeNumber = (text) => {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new RangeError(`bigint ${text} is too large`);
  return value;
};
const parseInt8Array = pg.types.getTypeParser(INT8_ARRAY_OID);
pg.types.setTypeParser(INT8_OID, toSafeNumber);
pg.types.setTypeParser(INT8_ARRAY_OID, (text) =>
  parseInt8Array(text).map((item) => (item === null ? null : toSafeNumber(item))),
);

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
