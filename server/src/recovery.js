/**
 * What the server does after a restart, before it takes requests (Part 7).
 * Spec: docs/parts/part-7-recovery.md. Tests: server/test/recovery.int.test.js.
 *
 * Nothing that matters lives only in memory: orders, trades and wallets are saved in one
 * transaction each, and a transaction cut off by a crash is rolled back by Postgres. The
 * order books are a copy of the open orders, so recovery is:
 *   1. check the database still adds up (exchangeRules.js), and say loudly if it doesn't
 *   2. rebuild every pressing's order book from its open orders
 * A broken rule is logged rather than stopping the server: one bad row shouldn't take the
 * whole site down, and the log says exactly which ids to look at.
 */
import { findBrokenRules } from './orders/exchangeRules.js';

/**
 * @param {Pick<import('./context.js').AppContext, 'pool' | 'orders'>} ctx
 * @param {Pick<Console, 'log' | 'error'>} [log]
 * @returns {Promise<{ broken: import('./orders/exchangeRules.js').BrokenRule[],
 *   books: number, orders: number, failed: number[] }>}
 */
export async function recoverExchange(ctx, log = console) {
  const broken = await findBrokenRules(ctx.pool);
  for (const { rule, detail } of broken) log.error(`[check] ${rule}: ${detail}`);
  if (broken.length) log.error(`[check] ${broken.length} problems found; see above`);

  const rebuilt = await ctx.orders.recover();
  log.log(`[orders] rebuilt ${rebuilt.books} order books from ${rebuilt.orders} open orders`);
  if (rebuilt.failed.length) {
    log.error(`[orders] these pressings can't trade until fixed: ${rebuilt.failed.join(', ')}`);
  }
  return { broken, ...rebuilt };
}
