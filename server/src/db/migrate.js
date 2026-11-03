/**
 * Applies the numbered SQL files in server/migrations, in order, once each.
 * Runs automatically when the server starts, and by hand with `npm run db:migrate`.
 *
 * Rules: never edit a migration that has been applied anywhere (local, Neon).
 * To change the schema, add the next numbered file.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
/** Any fixed number: makes two servers starting at once take turns. */
const LOCK_ID = 7_331_975;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<string[]>} names of the migrations applied this time
 */
export async function migrate(pool, dir = MIGRATIONS_DIR) {
  const files = (await fs.readdir(dir)).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((row) => row.name));
    for (const name of files) {
      if (done.has(name)) continue;
      const sql = await fs.readFile(path.join(dir, name), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        applied.push(name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${name} failed: ${error.message}`, { cause: error });
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
  return applied;
}

// `npm run db:migrate`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadConfig } = await import('../config.js');
  const { createPool } = await import('./pool.js');
  const pool = createPool(loadConfig().DATABASE_URL);
  try {
    const applied = await migrate(pool);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  } finally {
    await pool.end();
  }
}
