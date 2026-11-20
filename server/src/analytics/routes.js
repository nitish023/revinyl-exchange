import { Router } from 'express';
import { releaseIdParamSchema } from '../../../shared/index.js';

/**
 * GET /api/releases/:id/pricing   what a copy is worth in each grade (with an 80% range),
 *                                 and the time-to-sale model the sell form uses to say how
 *                                 likely a price is to sell -> { pricing }
 */
export function analyticsRouter(ctx) {
  const router = Router();
  router.get('/releases/:id/pricing', async (req, res) => {
    const { id } = releaseIdParamSchema.parse(req.params);
    res.json({ pricing: await ctx.pricing.pricing(id) });
  });
  return router;
}
