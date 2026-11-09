/**
 * Crate rules shared by the "Add a copy" form and the server: what a new copy needs,
 * and how to tell a real photo from a file that only claims to be one.
 */
import { z } from 'zod';
import {
  CONDITION_FLAG_CODES,
  MAX_HEADLINE_LENGTH,
  MAX_NOTES_LENGTH,
  PHOTO_TYPES,
} from './copies.js';
import { gradeRankSchema, idSchema, storedTextSchema } from './orders.js';

/**
 * Active copies one person can have. Far more than a real collection on the demo, and it
 * stops one account filling the free database (each copy can carry 6 photos of 2 MB).
 */
export const MAX_COPIES_PER_USER = 300;

/** Empty query-string values ("?releaseId=") mean "no filter". */
const blankAsMissing = (value) => (value === '' ? undefined : value);

/** The body of POST /api/crate. A null sleeveGrade means a generic or missing sleeve. */
export const addCopySchema = z.object({
  releaseId: idSchema('Pick a pressing'),
  grade: gradeRankSchema('Grade', 'Pick the record’s grade'),
  sleeveGrade: gradeRankSchema(
    'Sleeve grade',
    'Pick the sleeve’s grade, or choose generic sleeve',
  ).nullable(),
  flags: z
    .array(z.enum(CONDITION_FLAG_CODES, { error: 'That condition isn’t one we list' }), {
      error: 'Conditions must be a list',
    })
    .default([])
    // Ticking the same box twice means the same thing; keep the form's order.
    .transform((flags) => CONDITION_FLAG_CODES.filter((code) => flags.includes(code))),
  headline: storedTextSchema('headline', MAX_HEADLINE_LENGTH),
  notes: storedTextSchema('notes', MAX_NOTES_LENGTH),
});

/** GET /api/crate?releaseId= */
export const crateQuerySchema = z.object({
  releaseId: z.preprocess(
    blankAsMissing,
    z.coerce.number().pipe(idSchema('Release ID must be a positive whole number')).optional(),
  ),
});

/** A path id like /api/crate/:id. */
export const idParamSchema = z.object({
  id: z.coerce.number().pipe(idSchema('That id is not valid')),
});

/** /api/copies/:id/photos/:position */
export const photoParamSchema = idParamSchema.extend({
  position: z.coerce
    .number()
    .pipe(z.number().int().min(1, 'No such photo').max(6, 'No such photo')),
});

const startsWith = (bytes, signature, offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text) => [...text].map((char) => char.charCodeAt(0));

/**
 * The image type a file really is, read from its first bytes, or null. The Content-Type a
 * browser sends is only a claim; a photo is stored and served with the type found here,
 * so a script renamed to .png is refused.
 * @param {Uint8Array} bytes
 * @returns {'image/jpeg' | 'image/png' | 'image/webp' | null}
 */
export function photoTypeFromBytes(bytes) {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

/** True for the content types we accept, so the form can refuse other files early. */
export function isPhotoType(type) {
  return PHOTO_TYPES.includes(type);
}
