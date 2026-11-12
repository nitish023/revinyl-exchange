/**
 * The Listening Room (Part 6): one person's own edition. Everything on it is read here, in
 * a handful of queries:
 *
 *   wallet    cash, held and spendable
 *   shelf     your copies (in the crate, listed, or sold and waiting to ship) and records
 *             you bought that are on their way to you
 *   wanted    your open WANTED ads, each with how the market looks for it
 *   ledger    every trade you were in, newest first
 *   counter   the best WANTED ad from someone else that a copy on your shelf could fill
 *   value     what your shelf would fetch at today's best offers
 *
 * Other people are never named: a buyer or seller only appears as a count of trades.
 */
import { conditionText, formatCents } from '../../../shared/index.js';

const LEDGER_LIMIT = 50;

const releaseOf = (row) => ({
  id: row.release_id,
  title: row.title,
  artist: row.artist,
  year: row.year,
  thumbUrl: row.thumb_url,
});

/**
 * @param {import('pg').Pool} db
 * @param {number} userId
 */
export async function loadRoom(db, userId) {
  const [user, shelf, incoming, wanted, ledger, counter, value] = await Promise.all([
    db.query('SELECT display_name, created_at, cash_cents, held_cents FROM users WHERE id = $1', [
      userId,
    ]),
    // My copies, with an open FOR SALE ad's price and a trade I'm selling it in.
    db.query(
      `SELECT c.id, c.release_id, c.grade, c.sleeve_grade, c.status, c.source, c.headline,
              r.title, r.artist, r.year, r.thumb_url,
              (SELECT count(*) FROM copy_photos p WHERE p.copy_id = c.id) AS photos,
              ask.id AS ask_id, ask.price_cents AS ask_price_cents,
              t.id AS trade_id, t.status AS trade_status
         FROM copies c
         JOIN releases r ON r.id = c.release_id
         LEFT JOIN orders ask ON ask.copy_id = c.id AND ask.side = 'ask' AND ask.status = 'open'
         LEFT JOIN trades t ON t.copy_id = c.id AND t.seller_id = c.owner_id
                           AND t.status IN ('awaiting_shipment', 'shipped')
        WHERE c.owner_id = $1 AND c.removed_at IS NULL
        ORDER BY c.created_at DESC, c.id DESC`,
      [userId],
    ),
    // Records I bought that haven't arrived yet (they're still the seller's copy until then).
    db.query(
      `SELECT t.id AS trade_id, t.status AS trade_status, t.grade, t.price_cents, t.release_id,
              c.sleeve_grade, r.title, r.artist, r.year, r.thumb_url
         FROM trades t
         JOIN copies c ON c.id = t.copy_id
         JOIN releases r ON r.id = t.release_id
        WHERE t.buyer_id = $1 AND t.status IN ('awaiting_shipment', 'shipped')
        ORDER BY t.created_at DESC, t.id DESC`,
      [userId],
    ),
    // My WANTED ads, with the cheapest copy from someone else that's good enough, and how
    // many other people want the same pressing.
    db.query(
      `SELECT o.id, o.release_id, o.price_cents, o.min_grade, o.note, o.created_at,
              r.title, r.artist, r.year, r.thumb_url,
              (SELECT min(a.price_cents) FROM orders a JOIN copies c ON c.id = a.copy_id
                WHERE a.release_id = o.release_id AND a.side = 'ask' AND a.status = 'open'
                  AND a.user_id <> o.user_id AND c.grade >= o.min_grade) AS cheapest_cents,
              (SELECT count(*) FROM orders b
                WHERE b.release_id = o.release_id AND b.side = 'bid' AND b.status = 'open'
                  AND b.user_id <> o.user_id) AS other_buyers
         FROM orders o
         JOIN releases r ON r.id = o.release_id
        WHERE o.user_id = $1 AND o.side = 'bid' AND o.status = 'open'
        ORDER BY o.created_at DESC, o.id DESC`,
      [userId],
    ),
    db.query(
      `SELECT t.id, t.release_id, t.grade, t.price_cents, t.status, t.created_at,
              CASE WHEN t.buyer_id = $1 THEN 'buyer' ELSE 'seller' END AS role,
              r.title, r.artist, r.year, r.thumb_url
         FROM trades t
         JOIN releases r ON r.id = t.release_id
        WHERE t.buyer_id = $1 OR t.seller_id = $1
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ${LEDGER_LIMIT}`,
      [userId],
    ),
    // The best WANTED ad someone else is running that one of my copies (in the crate or
    // listed) is good enough for.
    db.query(
      `SELECT o.id AS order_id, o.release_id, o.price_cents, o.min_grade, r.title, r.artist,
              r.year, r.thumb_url, max(c.grade) AS my_grade
         FROM orders o
         JOIN copies c ON c.release_id = o.release_id AND c.owner_id = $1
                      AND c.removed_at IS NULL AND c.status IN ('in_crate', 'listed')
                      AND c.grade >= o.min_grade
         JOIN releases r ON r.id = o.release_id
        WHERE o.side = 'bid' AND o.status = 'open' AND o.user_id <> $1
        GROUP BY o.id, r.id
        ORDER BY o.price_cents DESC, o.created_at, o.id
        LIMIT 1`,
      [userId],
    ),
    // Each of my copies at the best WANTED ad it's good enough for. Two copies can count
    // the same ad, so this is "about" what the shelf is worth, not a promise.
    db.query(
      `SELECT coalesce(sum(best), 0)::bigint AS cents, count(best)::int AS copies
         FROM (SELECT (SELECT max(o.price_cents) FROM orders o
                        WHERE o.release_id = c.release_id AND o.side = 'bid' AND o.status = 'open'
                          AND o.user_id <> c.owner_id AND o.min_grade <= c.grade) AS best
                 FROM copies c
                WHERE c.owner_id = $1 AND c.removed_at IS NULL
                  AND c.status IN ('in_crate', 'listed')) AS valued`,
      [userId],
    ),
  ]);

  const me = user.rows[0];
  return {
    user: { displayName: me.display_name, memberSince: me.created_at.toISOString() },
    wallet: {
      cash: formatCents(me.cash_cents),
      held: formatCents(me.held_cents),
      spendable: formatCents(me.cash_cents - me.held_cents),
    },
    shelf: [
      ...incoming.rows.map((row) => ({
        kind: 'incoming',
        release: releaseOf(row),
        grade: row.grade,
        condition: conditionText(row.grade, row.sleeve_grade),
        tradeId: row.trade_id,
        tradeStatus: row.trade_status,
        price: formatCents(row.price_cents),
      })),
      ...shelf.rows.map((row) => ({
        kind: 'copy',
        copyId: row.id,
        release: releaseOf(row),
        grade: row.grade,
        condition: conditionText(row.grade, row.sleeve_grade),
        status: row.status,
        imported: row.source === 'discogs_import',
        photos: row.photos,
        ask: row.ask_id ? { orderId: row.ask_id, price: formatCents(row.ask_price_cents) } : null,
        tradeId: row.trade_id,
        tradeStatus: row.trade_status,
      })),
    ],
    wanted: wanted.rows.map((row) => ({
      orderId: row.id,
      release: releaseOf(row),
      price: formatCents(row.price_cents),
      minGrade: row.min_grade,
      note: row.note,
      cheapest: row.cheapest_cents === null ? null : formatCents(row.cheapest_cents),
      otherBuyers: row.other_buyers,
    })),
    ledger: ledger.rows.map((row) => ({
      id: row.id,
      role: row.role,
      status: row.status,
      grade: row.grade,
      price: formatCents(row.price_cents),
      createdAt: row.created_at.toISOString(),
      release: releaseOf(row),
    })),
    counter: counter.rows[0]
      ? {
          orderId: counter.rows[0].order_id,
          release: releaseOf(counter.rows[0]),
          price: formatCents(counter.rows[0].price_cents),
          minGrade: counter.rows[0].min_grade,
          myGrade: counter.rows[0].my_grade,
        }
      : null,
    value: value.rows[0].copies
      ? { total: formatCents(value.rows[0].cents), copies: value.rows[0].copies }
      : null,
  };
}
