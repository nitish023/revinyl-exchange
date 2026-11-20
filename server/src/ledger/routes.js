import { Router } from 'express';
import { statementQuerySchema } from '../../../shared/index.js';
import { requireUser } from '../auth/middleware.js';
import { loadHouseBooks, loadStatement } from './ledger.js';

/**
 * GET /api/wallet/statement?before=   my cash, line by line, newest first, with the balance
 *                                     after each line -> { lines, more }
 * GET /api/books                      reVINYL's books for anyone: money issued, in wallets,
 *                                     in escrow and taken in fees -> { books }
 */
export function ledgerRouter(ctx) {
  const router = Router();
  router.get('/wallet/statement', requireUser, async (req, res) => {
    const { before } = statementQuerySchema.parse(req.query);
    res.json(await loadStatement(ctx.pool, req.user.id, { before }));
  });
  router.get('/books', async (_req, res) => {
    res.json({ books: await loadHouseBooks(ctx.pool) });
  });
  return router;
}
