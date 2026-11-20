/**
 * `npm run db:reset`: start a local database over, for a demo. Every table is emptied (the
 * schema stays), then the demo seed and 90 days of simulated history (Part 19) go back in.
 * It refuses to run in production: there, the ledger is append-only on purpose, and nothing
 * here should ever be wiped.
 */
import { pathToFileURL } from 'node:url';

/** Every table with data in it; schema_migrations stays, so the schema isn't rebuilt. */
const TABLES = [
  'users',
  'sessions',
  'releases',
  'copies',
  'copy_photos',
  'orders',
  'trades',
  'ledger_journals',
  'ledger_entries',
  'book_versions',
  'auctions',
  'auction_bids',
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadConfig } = await import('../config.js');
  const { createPool } = await import('./pool.js');
  const { migrate } = await import('./migrate.js');
  const { seedDemo } = await import('./seed.js');
  const { simulateHistory } = await import('../sim/history.js');
  const config = loadConfig();
  if (config.isProduction) {
    console.error('db:reset refuses to run in production.');
    process.exit(1);
  }
  const pool = createPool(config.DATABASE_URL);
  try {
    await migrate(pool);
    // TRUNCATE skips the ledger's row triggers, which only guard against editing history.
    await pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    await seedDemo(pool);
    const simulated = await simulateHistory(pool);
    console.log(
      `Started over: the demo seed and ${simulated.sales} simulated sales over 90 days. ` +
        'Log in as groovegarden@example.com (password password123).',
    );
  } catch (error) {
    console.error(`Reset failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
