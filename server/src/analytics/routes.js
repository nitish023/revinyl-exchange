import { Router } from 'express';
import { releaseIdParamSchema } from '../../../shared/index.js';

/**
 * GET /api/releases/:id/pricing   what a copy is worth in each grade (with an 80% range),
 *                                 and the time-to-sale model the sell form uses to say how
 *                                 likely a price is to sell -> { pricing }
 * GET /api/releases/:id/history   daily candles in VG+ terms, volatility, the 30-day change,
 *                                 the 52-week range, and the book as depth -> { history }
 */
export function analyticsRouter(ctx) {
  const router = Router();
  router.get('/releases/:id/pricing', async (req, res) => {
    const { id } = releaseIdParamSchema.parse(req.params);
    res.json({ pricing: await ctx.pricing.pricing(id) });
  });
  router.get('/releases/:id/history', async (req, res) => {
    const { id } = releaseIdParamSchema.parse(req.params);
    res.json({ history: await ctx.pricing.history(id) });
  });
  return router;
}
