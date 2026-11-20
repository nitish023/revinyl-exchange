/**
 * The rules the whole exchange keeps, checked straight against the database (Part 7).
 * Spec: docs/parts/part-7-recovery.md. Tests: server/test/recovery.int.test.js.
 *
 * Every order, trade and wallet change happens in one transaction, so these should always
 * hold. Checking them anyway catches a bug in our own code, or a bad hand-written fix to
 * the data, before it turns into a wrong trade:
 *   - at startup (server/src/recovery.js), before the order books are rebuilt
 *   - in the tests, after every mix of orders and trades
 *   - by hand: `npm run db:check` (run it after the demo bots, say)
 *
 * Each check returns the rows that break it, at most MAX_EXAMPLES, as plain sentences.
 */
import { pathToFileURL } from 'node:url';
import { formatCents } from '../../../shared/index.js';

/** A broken rule can affect thousands of rows; a few examples are enough to find the bug. */
const MAX_EXAMPLES = 20;

/** Trades whose price is still held by reVINYL: the buyer has paid, the seller isn't paid. */
const UNSETTLED = `('awaiting_shipment', 'shipped')`;

/**
 * @typedef {object} BrokenRule
 * @property {string} rule   which rule (one of the keys of RULES)
 * @property {string} detail what's wrong, with the ids involved
 */

/**
 * Each rule: a query for the rows that break it, and how to describe one.
 * @type {Record<string, { sql: string, describe: (row: any) => string }>}
 */
const RULES = {
  // Money is only ever moved, never made or lost: every journal in the ledger adds up to
  // zero (the database checks each one at COMMIT; this checks the whole history too).
  ledgerBalanced: {
    sql: `SELECT j.id, coalesce(sum(e.amount_cents), 0)::bigint AS off_by
            FROM ledger_journals j LEFT JOIN ledger_entries e ON e.journal_id = j.id
           GROUP BY j.id
          HAVING coalesce(sum(e.amount_cents), 0) <> 0 OR count(e.id) < 2
           ORDER BY j.id LIMIT ${MAX_EXAMPLES}`,
    describe: (row) =>
      `Ledger journal ${row.id} doesn't balance (off by ${row.off_by} cents, or has under two entries).`,
  },

  // All the money there is: everything ever issued (the $2,000 grants, and any correction)
  // is in someone's wallet, in escrow or in fees. It follows from the ledger rules, and is
  // checked on its own because it's the one everybody understands.
  money: {
    sql: `SELECT issued, cash, escrow, fees
            FROM (SELECT coalesce(-sum(amount_cents) FILTER (WHERE account = 'issued'), 0)::bigint AS issued,
                         coalesce(sum(amount_cents) FILTER (WHERE account = 'escrow'), 0)::bigint AS escrow,
                         coalesce(sum(amount_cents) FILTER (WHERE account = 'fees'), 0)::bigint AS fees
                    FROM ledger_entries) books,
                 (SELECT coalesce(sum(cash_cents), 0)::bigint AS cash FROM users) wallets
           WHERE cash + escrow + fees <> issued`,
    describe: (row) =>
      `$${formatCents(row.issued)} has been issued, but wallets hold $${formatCents(row.cash)}, ` +
      `escrow $${formatCents(row.escrow)} and fees $${formatCents(row.fees)}.`,
  },

  // Each wallet (users.cash_cents) is exactly its cash entries in the ledger.
  cashMatchesLedger: {
    sql: `SELECT id, cash_cents, ledger
            FROM (SELECT u.id, u.cash_cents,
                         coalesce((SELECT sum(e.amount_cents) FROM ledger_entries e
                                    WHERE e.account = 'cash' AND e.user_id = u.id), 0)::bigint AS ledger
                    FROM users u) wallets
           WHERE cash_cents <> ledger
           ORDER BY id LIMIT ${MAX_EXAMPLES}`,
    describe: (row) =>
      `User ${row.id} has $${formatCents(row.cash_cents)} in their wallet, but the ledger says $${formatCents(row.ledger)}.`,
  },

  // Escrow holds exactly the prices of the trades that haven't settled.
  escrowMatchesTrades: {
    sql: `SELECT escrow, owed
            FROM (SELECT coalesce(sum(amount_cents), 0)::bigint AS escrow
                    FROM ledger_entries WHERE account = 'escrow') books,
                 (SELECT coalesce(sum(price_cents), 0)::bigint AS owed
                    FROM trades WHERE status IN ${UNSETTLED}) trades
           WHERE escrow <> owed`,
    describe: (row) =>
      `Escrow holds $${formatCents(row.escrow)}, but unsettled trades add up to $${formatCents(row.owed)}.`,
  },

  // Fees are exactly the seller fees of completed trades.
  feesMatchTrades: {
    sql: `SELECT fees, owed
            FROM (SELECT coalesce(sum(amount_cents), 0)::bigint AS fees
                    FROM ledger_entries WHERE account = 'fees') books,
                 (SELECT coalesce(sum(seller_fee_cents), 0)::bigint AS owed
                    FROM trades WHERE status = 'completed') trades
           WHERE fees <> owed`,
    describe: (row) =>
      `reVINYL has taken $${formatCents(row.fees)} in fees, but completed trades' fees add up to $${formatCents(row.owed)}.`,
  },

  // Every trade was paid for once, and a settled trade was paid out (completed) or refunded
  // once, to the right person for the right amount: the journals agree with the trade.
  tradeJournals: {
    sql: `SELECT t.id, t.status,
                 count(j.id) FILTER (WHERE j.kind = 'trade_payment') AS payments,
                 count(j.id) FILTER (WHERE j.kind = 'trade_payout') AS payouts,
                 count(j.id) FILTER (WHERE j.kind = 'trade_refund') AS refunds
            FROM trades t LEFT JOIN ledger_journals j ON j.trade_id = t.id
           GROUP BY t.id
          HAVING count(j.id) FILTER (WHERE j.kind = 'trade_payment') <> 1
              OR count(j.id) FILTER (WHERE j.kind = 'trade_payout') <> (t.status = 'completed')::int
              OR count(j.id) FILTER (WHERE j.kind = 'trade_refund') <> (t.status = 'refunded')::int
              OR EXISTS (
                   SELECT 1 FROM ledger_journals jj JOIN ledger_entries e ON e.journal_id = jj.id
                    WHERE jj.trade_id = t.id AND e.account = 'cash'
                      AND NOT ((jj.kind = 'trade_payment' AND e.user_id = t.buyer_id
                                AND e.amount_cents = -t.price_cents)
                            OR (jj.kind = 'trade_refund' AND e.user_id = t.buyer_id
                                AND e.amount_cents = t.price_cents)
                            OR (jj.kind = 'trade_payout' AND e.user_id = t.seller_id
                                AND e.amount_cents = t.price_cents - t.seller_fee_cents)))
           ORDER BY t.id LIMIT ${MAX_EXAMPLES}`,
    describe: (row) =>
      `Trade ${row.id} (${row.status}) has ${row.payments} payments, ${row.payouts} payouts and ` +
      `${row.refunds} refunds, or one of them went to the wrong person or amount.`,
  },

  // Held cash is exactly what your open WANTED ads would cost.
  holds: {
    sql: `SELECT u.id, u.held_cents, coalesce(sum(o.price_cents), 0)::bigint AS open_bids
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.id AND o.side = 'bid' AND o.status = 'open'
           GROUP BY u.id
          HAVING u.held_cents <> coalesce(sum(o.price_cents), 0)
           ORDER BY u.id LIMIT ${MAX_EXAMPLES}`,
    describe: (row) =>
      `User ${row.id} has $${formatCents(row.held_cents)} held, but their open wanted ads ` +
      `add up to $${formatCents(row.open_bids)}.`,
  },

  // A copy is `listed` exactly when it has one open FOR SALE ad.
  listedCopies: {
    sql: `SELECT c.id, c.status, count(o.id) AS open_asks
            FROM copies c
            LEFT JOIN orders o ON o.copy_id = c.id AND o.side = 'ask' AND o.status = 'open'
           GROUP BY c.id
          HAVING (c.status = 'listed') <> (count(o.id) = 1)
           ORDER BY c.id LIMIT ${MAX_EXAMPLES}`,
    describe: (row) =>
      `Copy ${row.id} is ${row.status} with ${row.open_asks} open FOR SALE ads (listed means exactly 1).`,
  },

  // A FOR SALE ad is for the seller's own copy, of that pressing.
  askOwners: {
    sql: `SELECT o.id, o.user_id, c.owner_id, o.release_id, c.release_id AS copy_release_id
            FROM orders o JOIN copies c ON c.id = o.copy_id
           WHERE o.side = 'ask' AND o.status = 'open'
             AND (c.owner_id <> o.user_id OR c.release_id <> o.release_id)
           ORDER BY o.id LIMIT ${MAX_EXAMPLES}`,
    describe: (row) =>
      `FOR SALE ad ${row.id} (user ${row.user_id}, pressing ${row.release_id}) is for a copy ` +
      `owned by user ${row.owner_id}, of pressing ${row.copy_release_id}.`,
  },

  // A copy is `in_trade` exactly when one unsettled trade has it.
  copiesInTrades: {
    sql: `SELECT c.id, c.status, count(t.id) AS open_trades
            FROM copies c
            LEFT JOIN trades t ON t.copy_id = c.id AND t.status IN ${UNSETTLED}
           GROUP BY c.id
          HAVING (c.status = 'in_trade') <> (count(t.id) = 1)
           ORDER BY c.id LIMIT ${MAX_EXAMPLES}`,
    describe: (row) =>
      `Copy ${row.id} is ${row.status} with ${row.open_trades} unsettled trades (in_trade means exactly 1).`,
  },

  // Until a trade settles, its copy still belongs to the seller.
  tradeCopies: {
    sql: `SELECT t.id, t.seller_id, c.owner_id
            FROM trades t JOIN copies c ON c.id = t.copy_id
           WHERE t.status IN ${UNSETTLED} AND c.owner_id <> t.seller_id
           ORDER BY t.id LIMIT ${MAX_EXAMPLES}`,
    describe: (row) =>
      `Trade ${row.id} is unsettled, but its copy belongs to user ${row.owner_id}, not the seller (user ${row.seller_id}).`,
  },

  // An order is `filled` exactly when a trade names it.
  filledOrders: {
    sql: `SELECT o.id, o.status
            FROM orders o
           WHERE (o.status = 'filled') <> EXISTS (
                   SELECT 1 FROM trades t WHERE t.bid_order_id = o.id OR t.ask_order_id = o.id)
           ORDER BY o.id LIMIT ${MAX_EXAMPLES}`,
    describe: (row) =>
      row.status === 'filled'
        ? `Order ${row.id} is filled, but no trade names it.`
        : `Order ${row.id} is ${row.status}, but a trade names it.`,
  },

  // A trade agrees with the two orders it filled: who, which copy, which pressing, a price
  // both accepted and a grade the buyer accepted.
  tradesMatchOrders: {
    sql: `SELECT t.id
            FROM trades t
            JOIN orders b ON b.id = t.bid_order_id
            JOIN orders a ON a.id = t.ask_order_id
           WHERE b.side <> 'bid' OR a.side <> 'ask'
              OR b.user_id <> t.buyer_id OR a.user_id <> t.seller_id OR a.copy_id <> t.copy_id
              OR b.release_id <> t.release_id OR a.release_id <> t.release_id
              OR t.price_cents < a.price_cents OR t.price_cents > b.price_cents
              OR t.grade < b.min_grade
           ORDER BY t.id LIMIT ${MAX_EXAMPLES}`,
    describe: (row) =>
      `Trade ${row.id} doesn't match its orders (people, copy, pressing, price or grade).`,
  },

  // Matching happens the moment an order arrives, so no open WANTED ad could take an open
  // FOR SALE ad from someone else: the book is never "crossed".
  uncrossed: {
    sql: `SELECT b.id AS bid_id, a.id AS ask_id
            FROM orders b
            JOIN orders a ON a.release_id = b.release_id AND a.side = 'ask' AND a.status = 'open'
            JOIN copies c ON c.id = a.copy_id
           WHERE b.side = 'bid' AND b.status = 'open'
             AND a.user_id <> b.user_id
             AND a.price_cents <= b.price_cents
             AND c.grade >= b.min_grade
           ORDER BY b.id, a.id LIMIT ${MAX_EXAMPLES}`,
    describe: (row) =>
      `Wanted ad ${row.bid_id} and FOR SALE ad ${row.ask_id} are both open but should have traded.`,
  },
};

/**
 * Check every rule. An empty list means the exchange adds up.
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @returns {Promise<BrokenRule[]>}
 */
export async function findBrokenRules(db) {
  // One at a time: a single client (inside a transaction) can't run queries side by side.
  const broken = [];
  for (const [rule, { sql, describe }] of Object.entries(RULES)) {
    const { rows } = await db.query(sql);
    broken.push(...rows.map((row) => ({ rule, detail: describe(row) })));
  }
  return broken;
}

// `npm run db:check`: exits with 1 if any rule is broken.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadConfig } = await import('../config.js');
  const { createPool } = await import('../db/pool.js');
  const pool = createPool(loadConfig().DATABASE_URL);
  try {
    const broken = await findBrokenRules(pool);
    for (const { rule, detail } of broken) console.error(`[${rule}] ${detail}`);
    console.log(broken.length ? `${broken.length} problems found.` : 'Everything adds up.');
    process.exitCode = broken.length ? 1 : 0;
  } catch (error) {
    console.error(`The check couldn't run: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
