import { Router } from 'express';
import { idParamSchema, releaseIdParamSchema } from '../../../shared/index.js';
import { requireUser } from '../auth/middleware.js';
import { rateLimiter } from '../http/rateLimit.js';

/**
 * Sealed-bid second-price auctions (Part 16).
 * GET    /api/releases/:id/auctions   open auctions (ending soonest first) and recent results
 * POST   /api/auctions                { copyId, reserve, days } put a copy from your crate up
 * GET    /api/auctions/:id            one auction (bids sealed: a count, and your own bid)
 * POST   /api/auctions/:id/bids       { amount } a sealed bid, or a higher one to replace yours
 * DELETE /api/auctions/:id            the seller takes it down, while nobody has bid
 */
export function auctionsRouter(ctx, { rateLimit }) {
  const router = Router();
  const writes = rateLimiter({ enabled: rateLimit, windowMs: 60_000, limit: 30 });

  router.get('/releases/:id/auctions', async (req, res) => {
    const { id } = releaseIdParamSchema.parse(req.params);
    res.json({ auctions: await ctx.auctions.forRelease(id, req.user?.id ?? null) });
  });
  router.post('/auctions', requireUser, writes, async (req, res) => {
    res.status(201).json({ auction: await ctx.auctions.start(req.user, req.body) });
  });
  router.get('/auctions/:id', async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json({ auction: await ctx.auctions.get(id, req.user?.id ?? null) });
  });
  router.post('/auctions/:id/bids', requireUser, writes, async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.status(201).json({ auction: await ctx.auctions.bid(req.user, id, req.body) });
  });
  router.delete('/auctions/:id', requireUser, writes, async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json({ auction: await ctx.auctions.cancel(req.user, id) });
  });
  return router;
}
