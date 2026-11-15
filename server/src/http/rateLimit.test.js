import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { rateLimiter } from './rateLimit.js';

/** An app where the "logged-in user" is whatever the X-Test-User header says. */
function app(options) {
  const server = express();
  server.use((req, _res, next) => {
    req.user = { id: Number(req.get('x-test-user')) };
    next();
  });
  server.get('/', rateLimiter({ enabled: true, windowMs: 60_000, ...options }), (_req, res) =>
    res.json({ ok: true }),
  );
  return server;
}

describe('rateLimiter', () => {
  it('counts each account separately with perUser, even from one address', async () => {
    const server = app({ limit: 2, perUser: true });
    for (let i = 0; i < 2; i += 1)
      await request(server).get('/').set('x-test-user', '1').expect(200);
    const blocked = await request(server).get('/').set('x-test-user', '1').expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    await request(server).get('/').set('x-test-user', '2').expect(200);
  });

  it('counts by address otherwise', async () => {
    const server = app({ limit: 1 });
    await request(server).get('/').set('x-test-user', '1').expect(200);
    await request(server).get('/').set('x-test-user', '2').expect(429);
  });
});
