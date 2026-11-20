import { Router } from 'express';
import { releaseIdParamSchema } from '../../../shared/index.js';
import { requireUser } from '../auth/middleware.js';
import { loadMarketIndex, loadPortfolio } from './reports.js';

/**
 * GET /api/releases/:id/pricing   what a copy is worth in each grade (with an 80% range),
 *                                 and the time-to-sale model the sell form uses to say how
 *                                 likely a price is to sell -> { pricing }
 * GET /api/index                  the reVINYL 30: level over 90 days, members and weights
 * GET /api/portfolio              your holdings at fair value, cost basis, gains (user)
 * GET /api/releases/:id/integrity trades set aside as possible wash trading, and outlier
 *                                 sales (Part 17) -> { integrity }
 * GET /api/releases/:id/history   daily candles in VG+ terms, volatility, the 30-day change,
 *                                 the 52-week range, and the book as depth -> { history }
 */
export function analyticsRouter(ctx) {
  const router = Router();
  router.get('/releases/:id/pricing', async (req, res) => {
    const { id } = releaseIdParamSchema.parse(req.params);
    res.json({ pricing: await ctx.pricing.pricing(id) });
  });
  router.get('/index', async (_req, res) => {
    res.json({ index: await loadMarketIndex(ctx) });
  });
  router.get('/portfolio', requireUser, async (req, res) => {
    res.json({ portfolio: await loadPortfolio(ctx, req.user.id) });
  });
  router.get('/releases/:id/integrity', async (req, res) => {
    const { id } = releaseIdParamSchema.parse(req.params);
    res.json({ integrity: await ctx.pricing.integrity(id) });
  });
  router.get('/releases/:id/history', async (req, res) => {
    const { id } = releaseIdParamSchema.parse(req.params);
    res.json({ history: await ctx.pricing.history(id) });
  });
  return router;
}
