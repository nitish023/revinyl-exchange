import { Router } from 'express';
import { requireUser } from '../auth/middleware.js';
import { loadStanding } from './sellerRecord.js';

/**
 * GET /api/seller   your standing as a seller: level, fee, reliability, the last 90 days,
 *                   and what the next level needs -> { standing }
 */
export function sellersRouter(ctx) {
  const router = Router();
  router.get('/seller', requireUser, async (req, res) => {
    res.json({ standing: await loadStanding(ctx.pool, req.user.id) });
  });
  return router;
}
