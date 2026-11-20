/** Starts the server: check settings, update the database, rebuild the order books, listen. */
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createContext } from './context.js';
import { migrate } from './db/migrate.js';
import { recoverExchange } from './recovery.js';

const config = loadConfig();
const ctx = createContext(config);

const applied = await migrate(ctx.pool);
if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`);
// Before listening, so no order can arrive while the books are being rebuilt.
await recoverExchange(ctx);

const server = createApp(ctx).listen(config.PORT, () => {
  console.log(`[http] listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
});
// Live updates share the port: browsers upgrade /ws to a WebSocket.
ctx.live.attach(server);

// Part 15: expire ads whose time is up, once at start and then every minute. (An ad also
// expires on time whenever its pressing next trades; this covers quiet pressings.)
const sweepExpired = () =>
  ctx.orders.sweepExpired().catch((error) => console.error('[orders] expiry sweep failed:', error));
void sweepExpired();
const sweeper = setInterval(sweepExpired, 60_000);
sweeper.unref();

// Render sends SIGTERM on deploys: finish open requests, then close the pool.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    clearInterval(sweeper);
    ctx.live.close();
    server.close(() => ctx.pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
