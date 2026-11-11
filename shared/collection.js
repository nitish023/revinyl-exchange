/**
 * Discogs collection import (Part 6): the rules the import form and the server share.
 *
 * Discogs collections can have "Media Condition" and "Sleeve Condition" fields, filled in
 * with the same Goldmine grades we use, written like "Very Good Plus (VG+)". When a record
 * has them, the import starts from those grades; otherwise the person picks.
 */
import { z } from 'zod';
import { gradeByCode } from './grades.js';
import { gradeRankSchema, idSchema } from './orders.js';

/** The contract says "import up to 100 records from Discogs". */
export const MAX_IMPORT = 100;

/** Discogs usernames are letters, numbers, dots, dashes and underscores. */
export const discogsUsernameSchema = z
  .string({ error: 'Enter your Discogs username' })
  .trim()
  .min(1, 'Enter your Discogs username')
  .max(64, 'That username is too long for Discogs')
  .regex(/^[A-Za-z0-9._-]+$/, 'Discogs usernames only have letters, numbers, dots, dashes and _');

/** GET /api/collection/discogs?username= */
export const collectionPreviewQuerySchema = z.object({ username: discogsUsernameSchema });

/** POST /api/collection/discogs: the records to bring in, with the grades the person chose. */
export const collectionImportSchema = z.object({
  username: discogsUsernameSchema,
  items: z
    .array(
      z.object({
        instanceId: idSchema('That record isn’t in the preview'),
        grade: gradeRankSchema('Grade', 'Pick a grade for every record you bring in'),
        sleeveGrade: gradeRankSchema('Sleeve grade', 'Pick the sleeve’s grade').nullable(),
      }),
      { error: 'Pick the records to bring in' },
    )
    .min(1, 'Tick at least one record to bring in')
    .max(MAX_IMPORT, `You can bring in up to ${MAX_IMPORT} records at a time`)
    .refine(
      (items) => new Set(items.map((item) => item.instanceId)).size === items.length,
      'The same record is listed twice',
    ),
});

/** The code in brackets at the end of a Discogs grade: "Near Mint (NM or M-)" -> "NM or M-". */
const BRACKETED = /\(([^)]+)\)\s*$/;

/** How Discogs writes the codes we call NM. Everything else matches our codes exactly. */
const DISCOGS_CODES = { 'NM or M-': 'NM', 'M-': 'NM' };

/**
 * A Discogs media or sleeve condition as our grade rank.
 *   "Very Good Plus (VG+)" -> 6, "Near Mint (NM or M-)" -> 7
 *   "Generic" or "No Cover" (sleeves only) -> null: a generic or missing sleeve
 *   anything else, or nothing -> undefined: not graded, the person picks
 * @param {unknown} value
 * @returns {number | null | undefined}
 */
export function gradeFromDiscogs(value) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (/^(generic|no cover)$/i.test(text)) return null;
  const match = BRACKETED.exec(text);
  if (!match) return undefined;
  const code = DISCOGS_CODES[match[1].trim()] ?? match[1].trim();
  return gradeByCode(code)?.rank;
}
