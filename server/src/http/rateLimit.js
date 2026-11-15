import { rateLimit } from 'express-rate-limit';

const passThrough = (_req, _res, next) => next();

/**
 * Per-visitor rate limit that answers in our error shape. Tests turn it off so a
 * suite can make many requests quickly.
 * With `perUser`, a logged-in visitor is counted by account rather than by address (put it
 * after requireUser), so one person can't get around it from a new address, and a class
 * sharing campus Wi-Fi doesn't share one allowance.
 * @param {{ enabled: boolean, windowMs: number, limit: number, perUser?: boolean }} options
 * @returns {import('express').RequestHandler}
 */
export function rateLimiter({ enabled, windowMs, limit, perUser = false }) {
  if (!enabled) return passThrough;
  return rateLimit({
    windowMs,
    limit,
    ...(perUser ? { keyGenerator: (req) => `user:${req.user.id}` } : {}),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many tries. Please wait a moment and try again.',
        },
      });
    },
  });
}
