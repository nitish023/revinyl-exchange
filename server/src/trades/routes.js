import { Router } from 'express';
import { idParamSchema, tradesQuerySchema } from '../../../shared/index.js';
import { requireUser } from '../auth/middleware.js';
import { rateLimiter } from '../http/rateLimit.js';

/** The four steps a trade can take, each a method of TradeService. */
const STEPS = ['ship', 'cancel', 'received', 'refund'];

/**
 * GET  /api/trades?status=          my trades, newest first, with my role and the pressing
 * POST /api/trades/:id/ship         seller: awaiting_shipment -> shipped        -> { trade }
 * POST /api/trades/:id/cancel       seller: awaiting_shipment -> refunded
 * POST /api/trades/:id/received     buyer:  shipped -> completed (seller paid)
 * POST /api/trades/:id/refund       buyer:  shipped -> refunded (buyer repaid)
 */
export function tradesRouter(ctx, { rateLimit }) {
  const router = Router();
  const writes = rateLimiter({ enabled: rateLimit, windowMs: 60_000, limit: 30 });

  router.get('/trades', requireUser, async (req, res) => {
    const filters = tradesQuerySchema.parse(req.query);
    res.json({ trades: await ctx.trades.list(req.user, filters) });
  });

  for (const step of STEPS) {
    router.post(`/trades/:id/${step}`, requireUser, writes, async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      res.json({ trade: await ctx.trades[step](req.user, id) });
    });
  }

  return router;
}
