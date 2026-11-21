/**
 * The ledger (double-entry bookkeeping): the request for a page of your statement, shared
 * by the browser and the server. Spec: docs/parts/part-11-ledger.md.
 */
import { z } from 'zod';
import { blankAsMissing, idSchema } from './orders.js';

/** The kinds of journal, as the statement shows them. */
export const JOURNAL_KINDS = Object.freeze([
  'signup_grant',
  'trade_payment',
  'trade_payout',
  'trade_refund',
  'adjustment',
]);

/** GET /api/wallet/statement?before= (the journal id to page back from; empty for the newest). */
export const statementQuerySchema = z.object({
  before: z.preprocess(
    blankAsMissing,
    z.coerce.number().pipe(idSchema('“before” must be a positive whole number')).optional(),
  ),
});
