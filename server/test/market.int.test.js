/**
 * Part 4: the market API against the demo data, and the live hub reading the real
 * database. The demo market for release 249504 is in src/db/seed.js.
 */
import { createServer } from 'node:http';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { sessionFromCookie, sessionIdFor } from '../src/auth/sessions.js';
import { DEMO_PASSWORD, FIXTURE_RELEASE_ID, seedDemo } from '../src/db/seed.js';
import { MarketHub } from '../src/market/hub.js';
import { loadMarket } from '../src/market/marketRepo.js';
import { createTestContext, resetDatabase } from './helpers.js';

const ctx = createTestContext();
const app = createApp(ctx, { rateLimit: false });

beforeEach(async () => {
  await resetDatabase(ctx.pool);
  await seedDemo(ctx.pool);
});
afterAll(() => ctx.pool.end());

const marketPath = `/api/releases/${FIXTURE_RELEASE_ID}/market`;

async function logIn(name) {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: `${name}@example.com`, password: DEMO_PASSWORD })
    .expect(200);
  return response.headers['set-cookie'][0].split(';')[0];
}

describe('GET /api/releases/:id/market', () => {
  it('lists the copies for sale by grade, best first, cheapest first in each grade', async () => {
    const { body } = await request(app).get(marketPath).expect(200);
    const { forSale } = body.market;
    expect(forSale.map((group) => group.grade)).toEqual([7, 6, 5, 4]);
    const vgPlus = forSale.find((group) => group.grade === 6).ads;
    expect(vgPlus).toHaveLength(2);
    expect(Number(vgPlus[0].price)).toBeLessThan(Number(vgPlus[1].price));
    expect(vgPlus[1].copy).toMatchObject({ condition: 'VG+/VG', flags: ['seam_split'] });
  });

  it('signs FOR SALE ads with the seller and their completed trades, and never names buyers', async () => {
    const { body } = await request(app).get(marketPath).expect(200);
    const nearMint = body.market.forSale[0].ads[0];
    expect(nearMint.seller).toEqual({ name: 'secondspin', trades: 2 });
    for (const ad of body.market.wanted) expect(Object.keys(ad.buyer)).toEqual(['trades']);
    expect(JSON.stringify(body)).not.toContain('@example.com');
  });

  it('lists WANTED ads highest first, and the report agrees', async () => {
    const { body } = await request(app).get(marketPath).expect(200);
    const prices = body.market.wanted.map((ad) => Number(ad.price));
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    expect(body.market.report.highestBid.price).toBe(body.market.wanted[0].price);
  });

  it('reports the month of sales by grade', async () => {
    const { body } = await request(app).get(marketPath).expect(200);
    const { byGrade, recentSales, lastSale } = body.market.report;
    expect(byGrade.map((row) => row.grade)).toEqual([7, 6, 5]);
    expect(byGrade.find((row) => row.grade === 6).sales).toBe(3);
    expect(recentSales).toHaveLength(6);
    expect(lastSale).toEqual(recentSales[0]);
  });

  it('leaves refunded trades out of the report', async () => {
    await ctx.pool.query(
      `UPDATE trades SET status = 'refunded'
        WHERE id = (SELECT id FROM trades ORDER BY created_at DESC LIMIT 1)`,
    );
    const { body } = await request(app).get(marketPath).expect(200);
    expect(body.market.report.recentSales).toHaveLength(5);
  });

  it('marks which open orders are mine, only when logged in', async () => {
    const guest = await request(app).get(marketPath).expect(200);
    expect(guest.body.mine).toEqual({ orderIds: [] });

    const cookie = await logIn('secondspin');
    const { body } = await request(app).get(marketPath).set('Cookie', cookie).expect(200);
    const nearMintAd = body.market.forSale[0].ads[0].orderId;
    const wantedAd = body.market.wanted.find((ad) => ad.minGrade === 6).orderId;
    expect(body.mine.orderIds.sort()).toEqual([nearMintAd, wantedAd].sort());
  });

  it('is an empty market for a pressing nobody has traded', async () => {
    const { body } = await request(app).get('/api/releases/12345/market').expect(200);
    expect(body.market).toMatchObject({ releaseId: 12345, forSale: [], wanted: [] });
  });

  it('rejects an id that is not a number', async () => {
    await request(app).get('/api/releases/abc/market').expect(400);
  });
});

describe('live updates from the database', () => {
  let server;
  let hub;
  const sockets = [];

  beforeEach(async () => {
    hub = new MarketHub({
      loadMarket: (releaseId) => loadMarket(ctx.pool, releaseId),
      authenticate: sessionFromCookie(ctx.pool),
      coalesceMs: 10,
      log: () => {},
    });
    server = createServer();
    hub.attach(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    hub.close();
    await new Promise((resolve) => server.close(resolve));
  });

  async function connect(cookie) {
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, {
      headers: cookie ? { cookie } : {},
    });
    sockets.push(socket);
    socket.received = [];
    socket.on('message', (data) => socket.received.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return socket;
  }

  async function nextMessages(socket, count) {
    const deadline = Date.now() + 2000;
    while (socket.received.length < count) {
      if (Date.now() > deadline) throw new Error('timed out waiting for a message');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return socket.received;
  }

  it('sends the same market the API does, then the new one after a change', async () => {
    const socket = await connect();
    socket.send(JSON.stringify({ type: 'subscribe', releaseId: FIXTURE_RELEASE_ID }));
    const [first] = await nextMessages(socket, 1);
    const { body } = await request(app).get(marketPath);
    expect(first.market.forSale).toEqual(body.market.forSale);

    // Someone cancels the cheapest copy (Part 3 will do this through OrderService).
    const cheapest = first.market.forSale.at(-1).ads[0];
    await ctx.pool.query(
      `UPDATE orders SET status = 'cancelled', closed_at = now() WHERE id = $1`,
      [cheapest.orderId],
    );
    hub.marketChanged(FIXTURE_RELEASE_ID);
    const [, second] = await nextMessages(socket, 2);
    const orderIds = second.market.forSale.flatMap((group) => group.ads.map((ad) => ad.orderId));
    expect(orderIds).not.toContain(cheapest.orderId);
  });

  it('knows who is logged in from the session cookie', async () => {
    const cookie = await logIn('latenight');
    const { rows } = await ctx.pool.query(`SELECT id FROM users WHERE display_name = 'latenight'`);
    const mine = await connect(cookie);
    const guest = await connect();
    hub.notifyUser(rows[0].id, { type: 'wallet' });
    await nextMessages(mine, 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(guest.received).toEqual([]);
  });

  it('closes this session’s connections when it logs out', async () => {
    const cookie = await logIn('latenight');
    const socket = await connect(cookie);
    const closed = new Promise((resolve) => socket.once('close', resolve));
    // The app under test uses ctx.live (a recorder); hand what logout announced to the hub.
    await request(app).post('/api/auth/logout').set('Cookie', cookie).send({}).expect(204);
    const [ended] = ctx.live.endedSessions.splice(0);
    expect(ended).toBe(sessionIdFor(decodeURIComponent(cookie.split('=')[1])));
    hub.sessionEnded(ended);
    expect(await closed).toBe(4001);
  });
});
