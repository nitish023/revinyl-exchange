import { Router } from 'express';
import { loginSchema, registerSchema } from '../../../shared/index.js';
import { AppError } from '../errors.js';
import { rateLimiter } from '../http/rateLimit.js';
import { DUMMY_HASH, verifyPassword } from './passwords.js';
import {
  createSession,
  deleteSession,
  SESSION_COOKIE,
  sessionCookieOptions,
  sessionIdFor,
} from './sessions.js';
import { findUserByEmail, registerUser } from './users.js';

/**
 * POST /api/auth/register  { email, displayName, password } -> 201 { user }
 * POST /api/auth/login     { email, password }              -> 200 { user }
 * POST /api/auth/logout                                     -> 204
 * GET  /api/auth/me                                         -> 200 { user | null }
 */
export function authRouter(ctx, { rateLimit }) {
  const router = Router();
  // Slow down password guessing and account spam: 10 tries per 15 minutes per visitor.
  const tries = rateLimiter({ enabled: rateLimit, windowMs: 15 * 60_000, limit: 10 });
  const secure = ctx.config.isProduction;

  async function startSession(res, user) {
    const { token, expiresAt } = await createSession(ctx.pool, user.id);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(secure, expiresAt));
  }

  router.post('/auth/register', tries, async (req, res) => {
    const input = registerSchema.parse(req.body ?? {});
    const user = await registerUser(ctx.pool, input);
    await startSession(res, user);
    res.status(201).json({ user });
  });

  router.post('/auth/login', tries, async (req, res) => {
    const { email, password } = loginSchema.parse(req.body ?? {});
    const found = await findUserByEmail(ctx.pool, email);
    // Check a password either way, so a missing account takes as long as a wrong password.
    const ok = await verifyPassword(password, found?.passwordHash ?? DUMMY_HASH);
    if (!found || !ok) {
      throw new AppError(401, 'BAD_LOGIN', 'That email and password don’t match');
    }
    const user = { id: found.id, email: found.email, displayName: found.displayName };
    await startSession(res, user);
    res.json({ user });
  });

  router.post('/auth/logout', async (req, res) => {
    await deleteSession(ctx.pool, req.sessionToken);
    // Other tabs share the cookie: close their live connections so their private updates stop.
    if (req.sessionToken) ctx.live.sessionEnded(sessionIdFor(req.sessionToken));
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(secure));
    res.status(204).end();
  });

  router.get('/auth/me', (req, res) => {
    res.json({ user: req.user ?? null });
  });

  return router;
}
