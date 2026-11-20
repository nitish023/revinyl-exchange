/**
 * The double-entry ledger against the real database: what each step of a trade posts, the
 * statement and the house books, and what the database itself refuses. Every test also ends
 * with the exchange's rules (expectExchangeConsistent), which include the ledger's.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { withTransaction } from '../src/db/pool.js';
import { loadStatement, postJournal, tradeJournals } from '../src/ledger/ledger.js';
import { createTestContext, expectExchangeConsistent, resetDatabase } from './helpers.js';
import { traders } from './traders.js';

const ctx = createTestContext();
const app = createApp(ctx, { rateLimit: false });
const { query, signUp, listCopy } = traders(ctx, app);

beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.orders.books.clear();
});
afterEach(() => expectExchangeConsistent(ctx));
afterAll(() => ctx.pool.end());

const buy = (user, orderId) => user.post(`/api/orders/${orderId}/buy`, {});
const step = (user, tradeId, name) => user.post(`/api/trades/${tradeId}/${name}`, {});
const statementOf = async (user) => (await user.get('/api/wallet/statement').expect(200)).body;
const lineSummary = (line) => [line.kind, line.amount, line.balance];

/** A seller lists a $40 copy and a buyer buys it. */
async function sale() {
  const [seller, buyer] = [await signUp('sella'), await signUp('buyer')];
  const { order } = await listCopy(seller, '40.00');
  const { trade } = (await buy(buyer, order.id).expect(201)).body;
  return { seller, buyer, trade };
}

describe('what each step posts', () => {
  it('signing up posts the $2,000 grant', async () => {
    const alice = await signUp('alice');
    const { lines, more } = await statementOf(alice);
    expect(lines.map(lineSummary)).toEqual([['signup_grant', '2000.00', '2000.00']]);
    expect(lines[0].description).toBe('Starting play money');
    expect(more).toBe(false);
  });

  it('a sale: the buyer pays into escrow, then the seller is paid out of it', async () => {
    const { seller, buyer, trade } = await sale();
    expect((await statementOf(buyer)).lines.map(lineSummary)).toEqual([
      ['trade_payment', '-40.00', '1960.00'],
      ['signup_grant', '2000.00', '2000.00'],
    ]);
    expect((await request(app).get('/api/books').expect(200)).body.books).toEqual({
      issued: '4000.00',
      inWallets: '3960.00',
      inEscrow: '40.00',
      fees: '0.00',
    });

    await step(seller, trade.id, 'ship').expect(200);
    await step(buyer, trade.id, 'received').expect(200);
    const { lines } = await statementOf(seller);
    expect(lines.map(lineSummary)[0]).toEqual(['trade_payout', '40.00', '2040.00']);
    expect(lines[0]).toMatchObject({
      description: 'Sold Never Gonna Give You Up',
      tradeId: trade.id,
      releaseId: trade.releaseId,
    });
    expect((await request(app).get('/api/books').expect(200)).body.books).toMatchObject({
      inWallets: '4000.00',
      inEscrow: '0.00',
    });
  });

  it('a refund: escrow gives the buyer everything back', async () => {
    const { seller, buyer, trade } = await sale();
    await step(seller, trade.id, 'cancel').expect(200);
    const { lines } = await statementOf(buyer);
    expect(lines.map(lineSummary).slice(0, 2)).toEqual([
      ['trade_refund', '40.00', '2000.00'],
      ['trade_payment', '-40.00', '1960.00'],
    ]);
    expect(lines[0].description).toBe('Refund for Never Gonna Give You Up');
    // The seller's cash never moved.
    expect((await statementOf(seller)).lines).toHaveLength(1);
  });

  it('a WANTED ad’s hold isn’t money moving: nothing is posted until it fills', async () => {
    const alice = await signUp('alice');
    await alice
      .post('/api/orders', { side: 'bid', releaseId: 249504, price: '25', minGrade: 1 })
      .expect(201);
    expect((await statementOf(alice)).lines).toHaveLength(1);
  });
});

describe('the statement', () => {
  it('pages backwards from the newest line', async () => {
    const { seller, buyer, trade } = await sale();
    await step(seller, trade.id, 'ship').expect(200);
    await step(buyer, trade.id, 'refund').expect(200);
    const first = await loadStatement(ctx.pool, buyer.id, { limit: 2 });
    expect(first.lines.map((line) => line.kind)).toEqual(['trade_refund', 'trade_payment']);
    expect(first.more).toBe(true);
    const next = await loadStatement(ctx.pool, buyer.id, {
      limit: 2,
      before: first.lines.at(-1).journalId,
    });
    expect(next.lines.map(lineSummary)).toEqual([['signup_grant', '2000.00', '2000.00']]);
    expect(next.more).toBe(false);
  });

  it('needs a login, and refuses a bad page', async () => {
    await request(app).get('/api/wallet/statement').expect(401);
    const alice = await signUp('alice');
    await alice.get('/api/wallet/statement?before=abc').expect(400);
    await alice.get('/api/wallet/statement?before=').expect(200);
  });
});

describe('what the database refuses', () => {
  it('a journal that doesn’t add up to zero, at COMMIT', async () => {
    const alice = await signUp('alice');
    const attempt = withTransaction(ctx.pool, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO ledger_journals (kind, memo) VALUES ('adjustment', 'free money') RETURNING id`,
      );
      await client.query(
        `INSERT INTO ledger_entries (journal_id, account, user_id, amount_cents)
         VALUES ($1, 'cash', $2, 100)`,
        [rows[0].id, alice.id],
      );
      await client.query('UPDATE users SET cash_cents = cash_cents + 100 WHERE id = $1', [
        alice.id,
      ]);
    });
    await expect(attempt).rejects.toThrow(/does not balance \(off by 100 cents\)/);
    expect(await query('SELECT cash_cents FROM users WHERE id = $1', [alice.id])).toEqual([
      { cash_cents: 200_000 },
    ]);
  });

  it('changing or deleting history: the ledger is append-only', async () => {
    await signUp('alice');
    await expect(query('UPDATE ledger_entries SET amount_cents = 1')).rejects.toThrow(
      /append-only/,
    );
    await expect(query('DELETE FROM ledger_entries')).rejects.toThrow(/append-only/);
    await expect(query(`UPDATE ledger_journals SET memo = 'x'`)).rejects.toThrow(/append-only/);
  });

  it('paying for a trade twice, or settling it twice', async () => {
    const { seller, trade } = await sale();
    const post = (journal) => withTransaction(ctx.pool, (client) => postJournal(client, journal));
    const row = async () => (await query('SELECT * FROM trades WHERE id = $1', [trade.id]))[0];
    await expect(post(tradeJournals.payment(await row()))).rejects.toThrow(
      /ledger_journals_one_payment/,
    );
    await step(seller, trade.id, 'cancel').expect(200); // settled: refunded
    await expect(post(tradeJournals.payout(await row()))).rejects.toThrow(
      /ledger_journals_one_settlement/,
    );
  });

  it('a payment from a wallet that would end up below its held cash', async () => {
    const alice = await signUp('alice');
    await alice
      .post('/api/orders', { side: 'bid', releaseId: 249504, price: '1990', minGrade: 1 })
      .expect(201);
    const attempt = withTransaction(ctx.pool, (client) =>
      postJournal(client, {
        kind: 'adjustment',
        lines: [
          { account: 'cash', userId: alice.id, amountCents: -2000 },
          { account: 'issued', amountCents: 2000 },
        ],
      }),
    );
    await expect(attempt).rejects.toThrow(/users_wallet_check/);
  });
});
