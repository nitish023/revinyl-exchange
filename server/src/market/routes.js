import { Router } from 'express';
import { releaseIdParamSchema } from '../../../shared/index.js';
import { loadMarket, myOpenOrderIds } from './marketRepo.js';

/**
 * GET /api/releases/:id/market: the pressing's ads, wanted ads and Market Report, plus
 * which of the open orders are yours. The page loads this once, then the WebSocket keeps
 * the shared part up to date. A pressing nobody has traded is an empty market, not a 404.
 */
export function marketRouter(ctx) {
  const router = Router();
  router.get('/releases/:id/market', async (req, res) => {
    const { id } = releaseIdParamSchema.parse(req.params);
    const [market, orderIds] = await Promise.all([
      loadMarket(ctx.pool, id),
      req.user ? myOpenOrderIds(ctx.pool, id, req.user.id) : Promise.resolve([]),
    ]);
    res.json({ market, mine: { orderIds } });
  });
  return router;
}
