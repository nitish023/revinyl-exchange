import { Router } from 'express';
import { idParamSchema, ordersQuerySchema } from '../../../shared/index.js';
import { requireUser } from '../auth/middleware.js';
import { rateLimiter } from '../http/rateLimit.js';
import { listMyOrders, loadWallet } from './orderRows.js';

/**
 * GET    /api/wallet                       { cash, held, spendable } as "2000.00" strings
 * GET    /api/orders?status=&releaseId=    my orders
 * POST   /api/orders                       place a bid or an ask -> 201 { order, trade }
 * DELETE /api/orders/:id                   cancel -> { order }
 */
export function ordersRouter(ctx, { rateLimit }) {
  const router = Router();
  // Every order takes a turn in its pressing's queue; one visitor shouldn't hog it.
  const orderWrites = rateLimiter({ enabled: rateLimit, windowMs: 60_000, limit: 60 });

  router.get('/wallet', requireUser, async (req, res) => {
    res.json({ wallet: await loadWallet(ctx.pool, req.user.id) });
  });

  router.get('/orders', requireUser, async (req, res) => {
    const filters = ordersQuerySchema.parse(req.query);
    res.json({ orders: await listMyOrders(ctx.pool, req.user.id, filters) });
  });

  router.post('/orders', requireUser, orderWrites, async (req, res) => {
    res.status(201).json(await ctx.orders.place(req.user, req.body));
  });

  router.delete('/orders/:id', requireUser, orderWrites, async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json({ order: await ctx.orders.cancel(req.user, id) });
  });

  return router;
}
