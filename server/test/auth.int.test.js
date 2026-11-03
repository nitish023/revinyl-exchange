import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createTestContext, resetDatabase } from './helpers.js';

const ctx = createTestContext();
const app = createApp(ctx, { rateLimit: false });

const alice = { email: 'Alice@Example.com', displayName: 'alice', password: 'correct horse' };

beforeEach(() => resetDatabase(ctx.pool));
afterAll(() => ctx.pool.end());

function sessionCookie(response) {
  const cookie = response.headers['set-cookie']?.find((c) => c.startsWith('revinyl_session='));
  return cookie?.split(';')[0];
}

describe('sign up', () => {
  it('creates an account, logs you in with an httpOnly cookie, and never returns the hash', async () => {
    const response = await request(app).post('/api/auth/register').send(alice).expect(201);
    expect(response.body.user).toEqual({ id: 1, email: 'alice@example.com', displayName: 'alice' });
    const setCookie = response.headers['set-cookie'][0];
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);

    const me = await request(app).get('/api/auth/me').set('Cookie', sessionCookie(response));
    expect(me.body.user.displayName).toBe('alice');

    const { rows } = await ctx.pool.query('SELECT password_hash FROM users');
    expect(rows[0].password_hash).toMatch(/^scrypt\$/);
    expect(rows[0].password_hash).not.toContain('correct horse');
  });

  it('stores only a hash of the session token', async () => {
    const response = await request(app).post('/api/auth/register').send(alice).expect(201);
    const token = sessionCookie(response).split('=')[1];
    const { rows } = await ctx.pool.query('SELECT token_hash FROM sessions');
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
  });

  it('says which field is taken', async () => {
    await request(app).post('/api/auth/register').send(alice).expect(201);
    const sameEmail = await request(app)
      .post('/api/auth/register')
      .send({ ...alice, email: 'alice@example.com', displayName: 'other' })
      .expect(409);
    expect(sameEmail.body.error.fields).toHaveProperty('email');
    const sameName = await request(app)
      .post('/api/auth/register')
      .send({ ...alice, email: 'new@example.com', displayName: 'ALICE' })
      .expect(409);
    expect(sameName.body.error.fields).toHaveProperty('displayName');
  });

  it('validates every field', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'x', displayName: '!', password: '1' })
      .expect(400);
    expect(Object.keys(response.body.error.fields).sort()).toEqual([
      'displayName',
      'email',
      'password',
    ]);
  });
});

describe('log in and log out', () => {
  beforeEach(() => request(app).post('/api/auth/register').send(alice).expect(201));

  it('logs in with the right password, any email case', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ALICE@example.com', password: 'correct horse' })
      .expect(200);
    expect(response.body.user.displayName).toBe('alice');
    expect(sessionCookie(response)).toBeTruthy();
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'nope nope' })
      .expect(401);
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bob@example.com', password: 'nope nope' })
      .expect(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('logs out: the old cookie stops working', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'correct horse' });
    const cookie = sessionCookie(login);
    await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(204);
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.user).toBeNull();
  });

  it('ignores expired sessions', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'correct horse' });
    await ctx.pool.query("UPDATE sessions SET expires_at = now() - interval '1 minute'");
    const me = await request(app).get('/api/auth/me').set('Cookie', sessionCookie(login));
    expect(me.body.user).toBeNull();
  });
});

describe('protection', () => {
  it('refuses changes sent from another website', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'https://evil.example')
      .send(alice)
      .expect(403);
    expect(response.body.error.code).toBe('CROSS_SITE');
    // A browser on our own page says same-origin, even behind the dev proxy.
    await request(app)
      .post('/api/auth/register')
      .set('Origin', 'http://localhost:5173')
      .set('Sec-Fetch-Site', 'same-origin')
      .send(alice)
      .expect(201);
    await request(app).post('/api/auth/logout').set('Sec-Fetch-Site', 'cross-site').expect(403);
  });

  it('answers unknown API paths and bad JSON in the standard error shape', async () => {
    const missing = await request(app).get('/api/nope').expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    const bad = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{not json')
      .expect(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');
  });

  it('reports database health', async () => {
    await request(app).get('/api/health').expect(200, { ok: true, database: true });
  });
});
