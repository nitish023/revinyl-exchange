/**
 * Trades (Part 5): the requests for "Sell to them" and the ledger, shared by the browser and
 * the server. A trade goes awaiting_shipment -> shipped -> completed, or ends refunded.
 */
import { z } from 'zod';
import { blankAsMissing, idSchema } from './orders.js';

export const TRADE_STATUSES = Object.freeze([
  'awaiting_shipment',
  'shipped',
  'completed',
  'refunded',
]);

/** The body of POST /api/orders/:id/sell: which of your copies answers the WANTED ad. */
export const sellToSchema = z.object({
  copyId: idSchema('Pick the copy you’re selling'),
});

/** GET /api/trades?status= (an empty value means every status). */
export const tradesQuerySchema = z.object({
  status: z.preprocess(
    blankAsMissing,
    z
      .enum(TRADE_STATUSES, {
        error: 'Status must be awaiting_shipment, shipped, completed or refunded',
      })
      .optional(),
  ),
});
