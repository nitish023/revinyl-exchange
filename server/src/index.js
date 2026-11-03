/** Starts the server: check settings, update the database, listen. */
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createContext } from './context.js';
import { migrate } from './db/migrate.js';

const config = loadConfig();
const ctx = createContext(config);

const applied = await migrate(ctx.pool);
if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`);

const server = createApp(ctx).listen(config.PORT, () => {
  console.log(`[http] listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
});

// Render sends SIGTERM on deploys: finish open requests, then close the pool.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close(() => ctx.pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
