// Runs once before the integration tests: bring the test database's schema up to date.
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { TEST_DATABASE_URL } from './helpers.js';

export default async function setup() {
  const pool = createPool(TEST_DATABASE_URL);
  try {
    await migrate(pool);
  } catch (error) {
    throw new Error(
      `Could not prepare the test database at ${TEST_DATABASE_URL}. Is Postgres running (npm run db:up)?\n${error.message}`,
      { cause: error },
    );
  } finally {
    await pool.end();
  }
}
