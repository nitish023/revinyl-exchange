/**
 * Helpers for the market tests (orders.int.test.js, trades.int.test.js): sign traders up,
 * add and list copies, place bids, read wallets, and make database queries fail or slow
 * down on purpose.
 */
import request from 'supertest';
import { vi } from 'vitest';
import { FIXTURE_RELEASE_ID } from '../src/db/seed.js';

export const RELEASE = FIXTURE_RELEASE_ID;
export const VG = 5;
export const VG_PLUS = 6;
export const NM = 7;

/**
 * @param {ReturnType<import('./helpers.js').createTestContext>} ctx
 * @param {import('express').Express} app
 */
export function traders(ctx, app) {
  const query = async (sql, params) => (await ctx.pool.query(sql, params)).rows;

  /** Sign up a trader and return small helpers that send requests as them. */
  async function signUp(name) {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: `${name}@example.com`, displayName: name, password: 'password123' })
      .expect(201);
    const cookie = response.headers['set-cookie'][0].split(';')[0];
    return {
      id: response.body.user.id,
      get: (path) => request(app).get(path).set('Cookie', cookie),
      post: (path, body) => request(app).post(path).set('Cookie', cookie).send(body),
      del: (path) => request(app).delete(path).set('Cookie', cookie),
      upload: (path, bytes, type) =>
        request(app).post(path).set('Cookie', cookie).set('Content-Type', type).send(bytes),
    };
  }

  async function addCopy(user, overrides = {}) {
    const response = await user
      .post('/api/crate', {
        releaseId: RELEASE,
        grade: VG_PLUS,
        sleeveGrade: VG_PLUS,
        ...overrides,
      })
      .expect(201);
    return response.body.copy;
  }

  /** List a new copy of the given grade for sale; returns the ask and the copy. */
  async function listCopy(user, price, grade = VG_PLUS) {
    const copy = await addCopy(user, { grade });
    const response = await user
      .post('/api/orders', { side: 'ask', copyId: copy.id, price })
      .expect(201);
    return { copy, ...response.body };
  }

  function placeBid(user, price, minGrade = VG_PLUS, extra = {}) {
    return user.post('/api/orders', { side: 'bid', releaseId: RELEASE, price, minGrade, ...extra });
  }

  async function walletOf(user) {
    return (await user.get('/api/wallet').expect(200)).body.wallet;
  }

  async function copyStatus(copyId) {
    return (await query('SELECT status FROM copies WHERE id = $1', [copyId]))[0].status;
  }

  /**
   * Make some database queries inside transactions fail or run slowly, to test what a
   * failure leaves behind and what happens when two requests overlap.
   * `decide(sql)` returns 'fail', a delay in milliseconds, or null to run the query normally.
   * Returns the spy; call mockRestore() to stop.
   * @param {(sql: string) => 'fail' | number | null} decide
   */
  function hookQueries(decide) {
    const connect = ctx.pool.connect.bind(ctx.pool);
    return vi.spyOn(ctx.pool, 'connect').mockImplementation(async (...args) => {
      // pool.query() calls connect(callback) internally; leave that path alone.
      if (args.length > 0) return connect(...args);
      const client = await connect();
      const realQuery = client.query;
      const realRelease = client.release;
      client.query = async function (sql, ...rest) {
        const action = typeof sql === 'string' ? decide(sql) : null;
        if (action === 'fail') throw new Error('simulated database failure');
        if (typeof action === 'number') await new Promise((resolve) => setTimeout(resolve, action));
        return realQuery.call(this, sql, ...rest);
      };
      client.release = function (...args) {
        client.query = realQuery; // the client goes back to the pool working normally
        client.release = realRelease;
        return realRelease.apply(this, args);
      };
      return client;
    });
  }

  return { query, signUp, addCopy, listCopy, placeBid, walletOf, copyStatus, hookQueries };
}
