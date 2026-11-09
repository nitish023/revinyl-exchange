/**
 * SQL reads and the shapes the API sends for orders, trades and wallets. The order service
 * does the writing, because those writes must happen inside its transactions.
 */
import { formatCents } from '../../../shared/index.js';

/**
 * @param {object} row an `orders` row
 * @returns {import('./orderService.js').PlacedOrder}
 */
export function toPlacedOrder(row) {
  return {
    id: row.id,
    releaseId: row.release_id,
    side: row.side,
    price: formatCents(row.price_cents),
    ...(row.side === 'bid' ? { minGrade: row.min_grade } : { copyId: row.copy_id }),
    note: row.note,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
  };
}

/**
 * An `orders` row in the shape the matching engine takes. Asks need their copy's grade,
 * which lives on `copies`.
 * @param {object} row
 * @param {number} [grade]
 * @returns {import('../market/orderBook.js').Order}
 */
export function toEngineOrder(row, grade) {
  const base = {
    id: row.id,
    userId: row.user_id,
    side: row.side,
    priceCents: row.price_cents,
    createdAt: row.created_at.getTime(),
  };
  return row.side === 'bid'
    ? { ...base, minGrade: row.min_grade }
    : { ...base, copyId: row.copy_id, grade };
}

/**
 * A trade as one of its two people sees it. The other person's id isn't sent: buyers and
 * sellers only ever show up as "Buyer, 9 trades" (docs/PROJECT.md).
 * @param {object} row a `trades` row
 * @param {number} viewerId
 */
export function toTradeView(row, viewerId) {
  return {
    id: row.id,
    releaseId: row.release_id,
    copyId: row.copy_id,
    grade: row.grade,
    price: formatCents(row.price_cents),
    status: row.status,
    role: row.buyer_id === viewerId ? 'buyer' : 'seller',
    createdAt: row.created_at.toISOString(),
  };
}

/** Every open order for a pressing, with each ask's grade: what the book is built from. */
export async function loadOpenOrders(db, releaseId) {
  const { rows } = await db.query(
    `SELECT o.*, c.grade
       FROM orders o LEFT JOIN copies c ON c.id = o.copy_id
      WHERE o.release_id = $1 AND o.status = 'open'
      ORDER BY o.id`,
    [releaseId],
  );
  return rows.map((row) => toEngineOrder(row, row.grade ?? undefined));
}

/** @returns {Promise<{ cash: string, held: string, spendable: string }>} */
export async function loadWallet(db, userId) {
  const { rows } = await db.query('SELECT cash_cents, held_cents FROM users WHERE id = $1', [
    userId,
  ]);
  const { cash_cents: cash, held_cents: held } = rows[0];
  return { cash: formatCents(cash), held: formatCents(held), spendable: formatCents(cash - held) };
}

/**
 * A user's own orders, newest first, with enough about the pressing (and an ask's copy)
 * to list them on the crate page.
 * @param {{ status?: string, releaseId?: number }} filters
 */
export async function listMyOrders(db, userId, { status, releaseId } = {}) {
  const { rows } = await db.query(
    `SELECT o.*, r.title, r.artist, r.thumb_url, c.grade, c.sleeve_grade
       FROM orders o
       JOIN releases r ON r.id = o.release_id
       LEFT JOIN copies c ON c.id = o.copy_id
      WHERE o.user_id = $1
        AND ($2::text IS NULL OR o.status = $2)
        AND ($3::bigint IS NULL OR o.release_id = $3)
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT 200`,
    [userId, status ?? null, releaseId ?? null],
  );
  return rows.map((row) => ({
    ...toPlacedOrder(row),
    release: { id: row.release_id, title: row.title, artist: row.artist, thumbUrl: row.thumb_url },
    ...(row.side === 'ask' ? { copy: { grade: row.grade, sleeveGrade: row.sleeve_grade } } : {}),
  }));
}
