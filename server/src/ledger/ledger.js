/**
 * The double-entry ledger (migration 008). Spec: docs/parts/part-11-ledger.md.
 * Tests: ledger.test.js (the journals) and server/test/ledger.int.test.js (the database).
 *
 * Every movement of money goes through postJournal(): a journal is a few entries, one per
 * account it touches, that add up to exactly zero. Money is therefore only ever moved,
 * never made or lost, and every balance can be rebuilt from history. The database checks
 * the same thing again at COMMIT (a deferred trigger) and refuses to edit or delete entries.
 *
 * users.cash_cents stays as a cached copy of each user's `cash` balance, because the wallet
 * check (held <= cash) and every order read it. postJournal updates it in the same
 * transaction, so the two can't drift; exchangeRules.js checks they haven't.
 */
import { formatCents } from '../../../shared/index.js';

/** The accounts. Only `cash` belongs to a user; the others are reVINYL's own. */
export const ACCOUNTS = ['cash', 'escrow', 'fees', 'issued'];

/**
 * @typedef {object} Line one entry of a journal
 * @property {'cash' | 'escrow' | 'fees' | 'issued'} account
 * @property {number} [userId] required for `cash`, absent otherwise
 * @property {number} amountCents signed: positive adds to the account's balance
 */

/**
 * @typedef {object} Journal
 * @property {'trade_payment' | 'trade_payout' | 'trade_refund' | 'adjustment'} kind
 *   (signup grants are posted by a database trigger when a user is created)
 * @property {number} [tradeId] required for the trade_ kinds
 * @property {string} [memo]
 * @property {Date} [at] when it happened, if not now (the demo seed's past sales)
 * @property {Line[]} lines
 */

/**
 * Check a journal before it's saved. A mistake here is a bug in our code, so it throws a
 * plain Error (a 500), never a message for users.
 * @param {Journal} journal
 */
export function assertBalanced(journal) {
  const { kind, tradeId, lines } = journal;
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error(`Journal ${kind} needs at least two entries`);
  }
  let total = 0;
  for (const line of lines) {
    if (!ACCOUNTS.includes(line.account)) throw new Error(`Unknown account ${line.account}`);
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents === 0) {
      throw new Error(`Journal ${kind}: amounts must be whole, non-zero cents`);
    }
    if ((line.account === 'cash') !== Number.isSafeInteger(line.userId)) {
      throw new Error(`Journal ${kind}: a cash entry needs a user, and only a cash entry`);
    }
    total += line.amountCents;
  }
  if (total !== 0) throw new Error(`Journal ${kind} doesn't balance (off by ${total} cents)`);
  if (kind.startsWith('trade_') !== Number.isSafeInteger(tradeId)) {
    throw new Error(`Journal ${kind}: trade journals name their trade, and only they do`);
  }
}

/**
 * Save a journal and update the cached cash of every user it touches, inside the caller's
 * transaction. The users rows must already be locked by the caller (FOR NO KEY UPDATE) if
 * it read their balance to decide anything; the updates here lock them anyway.
 * A user taken below their held cash fails users_wallet_check, rolling everything back.
 * @param {import('pg').PoolClient} client
 * @param {Journal} journal
 * @returns {Promise<number>} the journal id
 */
export async function postJournal(client, journal) {
  assertBalanced(journal);
  const { kind, tradeId = null, memo = '', at = null, lines } = journal;
  const { rows } = await client.query(
    `INSERT INTO ledger_journals (kind, trade_id, memo, created_at)
     VALUES ($1, $2, $3, coalesce($4, now())) RETURNING id`,
    [kind, tradeId, memo, at],
  );
  const journalId = rows[0].id;
  await client.query(
    `INSERT INTO ledger_entries (journal_id, account, user_id, amount_cents)
     SELECT $1, account, user_id, amount
       FROM unnest($2::text[], $3::bigint[], $4::bigint[]) AS e(account, user_id, amount)`,
    [
      journalId,
      lines.map((line) => line.account),
      lines.map((line) => line.userId ?? null),
      lines.map((line) => line.amountCents),
    ],
  );
  // One update per user, in id order (the lock order everywhere else), with each user's
  // entries added together.
  const byUser = new Map();
  for (const line of lines) {
    if (line.account === 'cash') {
      byUser.set(line.userId, (byUser.get(line.userId) ?? 0) + line.amountCents);
    }
  }
  for (const [userId, change] of [...byUser].sort(([a], [b]) => a - b)) {
    if (change !== 0) {
      await client.query('UPDATE users SET cash_cents = cash_cents + $2 WHERE id = $1', [
        userId,
        change,
      ]);
    }
  }
  return journalId;
}

/**
 * The journals a trade posts. Pure functions of the `trades` row, so they're easy to test
 * and the order and trade services can't disagree about who gets what.
 */
export const tradeJournals = {
  /** The buyer pays when the trade is made: their cash into escrow. */
  payment: (trade) => ({
    kind: 'trade_payment',
    tradeId: trade.id,
    lines: [
      { account: 'cash', userId: trade.buyer_id, amountCents: -trade.price_cents },
      { account: 'escrow', amountCents: trade.price_cents },
    ],
  }),

  /**
   * The buyer accepted the record: escrow pays the seller the price less the seller's fee
   * (fixed when the trade was made: trades.seller_fee_cents), and the fee goes to reVINYL.
   */
  payout: (trade) => {
    const fee = trade.seller_fee_cents ?? 0;
    const lines = [
      { account: 'escrow', amountCents: -trade.price_cents },
      { account: 'cash', userId: trade.seller_id, amountCents: trade.price_cents - fee },
    ];
    if (fee > 0) lines.push({ account: 'fees', amountCents: fee });
    return { kind: 'trade_payout', tradeId: trade.id, lines };
  },

  /** Cancelled or not as described: escrow gives the buyer everything back. */
  refund: (trade) => ({
    kind: 'trade_refund',
    tradeId: trade.id,
    lines: [
      { account: 'escrow', amountCents: -trade.price_cents },
      { account: 'cash', userId: trade.buyer_id, amountCents: trade.price_cents },
    ],
  }),
};

const STATEMENT_LIMIT = 50;

/** What a statement line says, from the journal's kind and which side of it you were on. */
function describe(row) {
  const record = row.title ? `${row.title}` : 'a record';
  switch (row.kind) {
    case 'signup_grant':
      return 'Starting play money';
    case 'trade_payment':
      return `Paid for ${record} (held until it arrives)`;
    case 'trade_payout':
      return row.fee_cents > 0
        ? `Sold ${record} (after a $${formatCents(row.fee_cents)} fee)`
        : `Sold ${record}`;
    case 'trade_refund':
      return `Refund for ${record}`;
    default:
      return row.memo || 'Adjustment';
  }
}

/**
 * A user's bank statement: their cash entries, newest first, each with the balance after
 * it. Pages go backwards: pass the last line's `journalId` as `before` for the next page.
 * @param {import('pg').Pool} db
 * @param {number} userId
 * @param {{ before?: number, limit?: number }} [page]
 */
export async function loadStatement(db, userId, { before, limit = STATEMENT_LIMIT } = {}) {
  const { rows } = await db.query(
    `WITH mine AS (
       SELECT e.journal_id, sum(e.amount_cents)::bigint AS amount_cents
         FROM ledger_entries e
        WHERE e.account = 'cash' AND e.user_id = $1
        GROUP BY e.journal_id
     ),
     running AS (
       SELECT journal_id, amount_cents,
              sum(amount_cents) OVER (ORDER BY journal_id)::bigint AS balance_cents
         FROM mine
     )
     SELECT r.journal_id, r.amount_cents, r.balance_cents, j.kind, j.memo, j.created_at,
            j.trade_id, t.release_id, rel.title, t.seller_fee_cents AS fee_cents
       FROM running r
       JOIN ledger_journals j ON j.id = r.journal_id
       LEFT JOIN trades t ON t.id = j.trade_id
       LEFT JOIN releases rel ON rel.id = t.release_id
      WHERE ($2::bigint IS NULL OR r.journal_id < $2)
      ORDER BY r.journal_id DESC
      LIMIT $3`,
    [userId, before ?? null, limit + 1],
  );
  const lines = rows.slice(0, limit).map((row) => ({
    journalId: row.journal_id,
    kind: row.kind,
    description: describe(row),
    amount: formatCents(row.amount_cents),
    balance: formatCents(row.balance_cents),
    tradeId: row.trade_id,
    releaseId: row.release_id,
    at: row.created_at.toISOString(),
  }));
  return { lines, more: rows.length > limit };
}

/**
 * reVINYL's own books, for anyone to see: how much play money exists, how much is waiting
 * in escrow, and how much has been taken in fees. They add up: issued = cash + escrow + fees.
 * @param {import('pg').Pool} db
 */
export async function loadHouseBooks(db) {
  const { rows } = await db.query(
    `SELECT account, coalesce(sum(amount_cents), 0)::bigint AS balance
       FROM ledger_entries GROUP BY account`,
  );
  const balance = Object.fromEntries(ACCOUNTS.map((account) => [account, 0]));
  for (const row of rows) balance[row.account] = row.balance;
  return {
    issued: formatCents(-balance.issued),
    inWallets: formatCents(balance.cash),
    inEscrow: formatCents(balance.escrow),
    fees: formatCents(balance.fees),
  };
}
