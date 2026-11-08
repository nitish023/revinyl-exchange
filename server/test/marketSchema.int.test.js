/**
 * The shared market tables (migration 003) and the demo data (npm run db:seed).
 * The seed is checked against the same rules the real order code must keep, so it
 * doubles as an example of what "a consistent market" means.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_TRADERS, FIXTURE_RELEASE_ID, seedDemo } from '../src/db/seed.js';
import { OrderBook } from '../src/market/orderBook.js';
import { createTestContext, resetDatabase } from './helpers.js';

const ctx = createTestContext();
afterAll(() => ctx.pool.end());
beforeEach(() => resetDatabase(ctx.pool));

const query = async (sql, params) => (await ctx.pool.query(sql, params)).rows;

describe('demo seed', () => {
  it('seeds the fixture pressing once', async () => {
    expect(await seedDemo(ctx.pool)).toEqual([FIXTURE_RELEASE_ID]);
    expect(await seedDemo(ctx.pool)).toEqual([]);
    const [{ count }] = await query('SELECT count(*) FROM users');
    expect(count).toBe(DEMO_TRADERS.length);
  });

  it('reads ids and money back as numbers', async () => {
    await seedDemo(ctx.pool);
    const [order] = await query('SELECT id, user_id, price_cents FROM orders LIMIT 1');
    expect(typeof order.id).toBe('number');
    expect(typeof order.user_id).toBe('number');
    const [user] = await query('SELECT cash_cents FROM users LIMIT 1');
    expect(typeof user.cash_cents).toBe('number');
  });

  it('holds exactly the open bids for each buyer', async () => {
    await seedDemo(ctx.pool);
    const rows = await query(`
      SELECT u.id, u.held_cents,
             coalesce((SELECT sum(price_cents)::bigint FROM orders o
                        WHERE o.user_id = u.id AND o.side = 'bid' AND o.status = 'open'), 0) AS open_bids
        FROM users u`);
    for (const row of rows) expect(row.held_cents).toBe(row.open_bids);
  });

  it('only moves money between traders', async () => {
    await seedDemo(ctx.pool);
    const [{ total }] = await query('SELECT sum(cash_cents)::bigint AS total FROM users');
    expect(total).toBe(DEMO_TRADERS.length * 200_000);
  });

  it('gives every listed copy one open ask from its owner, and no other copy any', async () => {
    await seedDemo(ctx.pool);
    const rows = await query(`
      SELECT c.status, c.owner_id,
             array_agg(o.user_id) FILTER (WHERE o.id IS NOT NULL) AS askers
        FROM copies c
        LEFT JOIN orders o ON o.copy_id = c.id AND o.side = 'ask' AND o.status = 'open'
       GROUP BY c.id`);
    for (const row of rows) {
      if (row.status === 'listed') expect(row.askers).toEqual([row.owner_id]);
      else expect(row.askers).toBeNull();
    }
  });

  it('leaves no open orders that should already have matched', async () => {
    await seedDemo(ctx.pool);
    const rows = await query(
      `
      SELECT o.id, o.user_id, o.side, o.price_cents, o.min_grade, o.copy_id, c.grade, o.created_at
        FROM orders o LEFT JOIN copies c ON c.id = o.copy_id
       WHERE o.release_id = $1 AND o.status = 'open'`,
      [FIXTURE_RELEASE_ID],
    );
    const book = new OrderBook(FIXTURE_RELEASE_ID);
    const orders = rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      side: row.side,
      priceCents: row.price_cents,
      createdAt: row.created_at.getTime(),
      ...(row.side === 'bid'
        ? { minGrade: row.min_grade }
        : { copyId: row.copy_id, grade: row.grade }),
    }));
    for (const order of orders) book.add(order);
    expect(book.asks()).toHaveLength(5);
    expect(book.bids()).toHaveLength(3);
    // Take each order out and offer it again: if anything matched, the seed was inconsistent.
    for (const order of orders) {
      book.remove(order.id);
      expect(book.match(order).trade).toBeNull();
      book.add(order);
    }
  });
});

describe('market tables', () => {
  async function demoIds() {
    await seedDemo(ctx.pool);
    const [copy] = await query(`SELECT id, owner_id FROM copies WHERE status = 'listed' LIMIT 1`);
    return { copyId: copy.id, ownerId: copy.owner_id };
  }

  it('refuses a second open ask for the same copy', async () => {
    const { copyId, ownerId } = await demoIds();
    await expect(
      ctx.pool.query(
        `INSERT INTO orders (user_id, release_id, side, price_cents, copy_id)
         VALUES ($1, $2, 'ask', 5000, $3)`,
        [ownerId, FIXTURE_RELEASE_ID, copyId],
      ),
    ).rejects.toThrow(/orders_one_open_ask_per_copy/);
  });

  it('refuses a bid without a minimum grade, and an ask without a copy', async () => {
    const { ownerId } = await demoIds();
    for (const sql of [
      `INSERT INTO orders (user_id, release_id, side, price_cents) VALUES ($1, $2, 'bid', 5000)`,
      `INSERT INTO orders (user_id, release_id, side, price_cents) VALUES ($1, $2, 'ask', 5000)`,
    ]) {
      await expect(ctx.pool.query(sql, [ownerId, FIXTURE_RELEASE_ID])).rejects.toThrow(
        /orders_side_fields/,
      );
    }
  });

  it('refuses a condition flag that is not on the list', async () => {
    const { copyId } = await demoIds();
    await expect(
      ctx.pool.query(`UPDATE copies SET flags = '{scratched}' WHERE id = $1`, [copyId]),
    ).rejects.toThrow(/copies_flags_check/);
  });

  it('never lets held cash go above the balance', async () => {
    const { ownerId } = await demoIds();
    await expect(
      ctx.pool.query('UPDATE users SET held_cents = cash_cents + 1 WHERE id = $1', [ownerId]),
    ).rejects.toThrow(/users_wallet_check/);
  });

  it('gives new accounts $2,000', async () => {
    const [user] = await query(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ('new@example.com', 'newbie', 'x') RETURNING cash_cents, held_cents`,
    );
    expect(user).toEqual({ cash_cents: 200_000, held_cents: 0 });
  });
});
