import { Router } from 'express';
import { requireUser } from '../auth/middleware.js';
import { loadRoom } from './roomRepo.js';

/** GET /api/room: your Listening Room (wallet, shelf, wanted ads, ledger, counter, value). */
export function roomRouter(ctx) {
  const router = Router();
  router.get('/room', requireUser, async (req, res) => {
    res.json({ room: await loadRoom(ctx.pool, req.user.id) });
  });
  return router;
}
