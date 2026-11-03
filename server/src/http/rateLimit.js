import { rateLimit } from 'express-rate-limit';

const passThrough = (_req, _res, next) => next();

/**
 * Per-visitor rate limit that answers in our error shape. Tests turn it off so a
 * suite can make many requests quickly.
 * @param {{ enabled: boolean, windowMs: number, limit: number }} options
 * @returns {import('express').RequestHandler}
 */
export function rateLimiter({ enabled, windowMs, limit }) {
  if (!enabled) return passThrough;
  return rateLimit({
    windowMs,
    limit,
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
