/**
 * Order rules, shared by the forms and the server so both give the same messages.
 * Money is whole cents everywhere (4050 = $40.50), so no float rounding can creep in.
 */
import { z } from 'zod';
import { MAX_ORDER_NOTE_LENGTH } from './copies.js';
import { gradeByRank, MAX_GRADE_RANK, MIN_GRADE_RANK } from './grades.js';

export const MIN_PRICE_CENTS = 100;
export const MAX_PRICE_CENTS = 1_000_000;

const PRICE_LIMITS_MESSAGE = 'Price must be between $1.00 and $10,000.00';
const DOLLARS_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Turns what someone typed into whole cents: "40.5" -> 4050. Returns null if it isn't a
 * plain dollar amount. Null, rather than an error, because a bad price is ordinary user
 * input, and validateOrder still rejects a null price if a caller forgets to check.
 * Range limits are validateOrder's job, so "0" parses to 0.
 *
 * The two halves are read as whole numbers because parseFloat would be wrong:
 * parseFloat("19.99") * 100 is 1998.9999999999998.
 *
 * @param {unknown} text
 * @returns {number | null}
 */
export function parseDollars(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!DOLLARS_PATTERN.test(trimmed)) return null;
  const [dollars, cents = ''] = trimmed.split('.');
  const total = Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
  // A long run of digits would otherwise be silently rounded to a different amount.
  return Number.isSafeInteger(total) ? total : null;
}

/**
 * Turns whole cents into the string the API sends: 4050 -> "40.50". A value that isn't
 * whole cents is a bug in our code rather than bad user input, so it throws.
 *
 * @param {number} cents
 * @returns {string}
 */
export function formatCents(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`formatCents needs a whole number of cents, got ${cents}`);
  }
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const remainder = String(absolute % 100).padStart(2, '0');
  return `${sign}${dollars}.${remainder}`;
}

/**
 * A grade rank from 1 (Poor) to 8 (Mint), with messages that name the field.
 * @param {string} label e.g. "Minimum grade"
 * @param {string} missingMessage shown when it's left out or isn't a number
 */
export function gradeRankSchema(label, missingMessage) {
  const lowest = `${MIN_GRADE_RANK} (${gradeByRank(MIN_GRADE_RANK).label})`;
  const highest = `${MAX_GRADE_RANK} (${gradeByRank(MAX_GRADE_RANK).label})`;
  const outOfRange = `${label} must be from ${lowest} to ${highest}`;
  return z
    .number({ error: missingMessage })
    .int(outOfRange)
    .min(MIN_GRADE_RANK, outOfRange)
    .max(MAX_GRADE_RANK, outOfRange);
}

/** A positive whole-number id (a pressing, copy or order), as sent in a JSON body. */
export function idSchema(message) {
  return z
    .number({ error: message })
    .int(message)
    .positive(message)
    .max(Number.MAX_SAFE_INTEGER, message);
}

/**
 * Free text we store in Postgres: trimmed, length-limited, and without NUL characters,
 * which Postgres can't store in a text column (without this they'd be a 500).
 * @param {string} name how the message names the field, e.g. "headline"
 * @param {number} max
 */
export function storedTextSchema(name, max) {
  return z
    .string({ error: `The ${name} must be text` })
    .trim()
    .max(max, `Keep the ${name} under ${max} characters`)
    .refine((text) => !text.includes('\u0000'), `The ${name} has a character we can’t store`)
    .default('');
}

export const priceCentsSchema = z
  .number({ error: 'Enter a price like 40.50' })
  .int('Price must be in whole cents')
  .min(MIN_PRICE_CENTS, PRICE_LIMITS_MESSAGE)
  .max(MAX_PRICE_CENTS, PRICE_LIMITS_MESSAGE);

const orderFields = {
  priceCents: priceCentsSchema,
  targetOrderId: z
    .number({ error: 'That order is not valid' })
    .int('That order is not valid')
    .positive('That order is not valid')
    .optional(),
};

const MIN_GRADE_FIELD = gradeRankSchema('Minimum grade', 'Pick the lowest grade you’ll accept');

export const orderSchema = z.discriminatedUnion(
  'side',
  [
    z.object({
      side: z.literal('bid'),
      ...orderFields,
      minGrade: MIN_GRADE_FIELD,
    }),
    z.object({
      side: z.literal('ask'),
      ...orderFields,
      grade: gradeRankSchema('Grade', 'Pick the copy’s grade'),
      copyId: z
        .number({ error: 'Pick the copy you’re selling' })
        .int('Pick the copy you’re selling')
        .positive('Pick the copy you’re selling'),
    }),
  ],
  { error: 'An order must be a bid or an ask' },
);

/**
 * Checks the rules a person can break, and returns just the checked fields. Throws a
 * ZodError, because errorHandler answers that with a 400 and per-field messages (any other
 * error becomes a generic 500), and forms read it with fieldErrors().
 * The server fills in id, userId and createdAt itself, so they aren't checked here.
 *
 * @param {unknown} order
 */
export function validateOrder(order) {
  return orderSchema.parse(order);
}

/** A price typed by a person ("40.50"), read into whole cents and range-checked. */
const priceText = z
  .string({ error: 'Enter a price like 40.50' })
  .transform((text) => parseDollars(text))
  .pipe(priceCentsSchema);

/**
 * The body of POST /api/orders, shared with the forms. `price` comes out in cents.
 * An ask names only the copy: its pressing and grade are read from the copy on the server,
 * never trusted from the request.
 */
export const placeOrderSchema = z.discriminatedUnion(
  'side',
  [
    z.object({
      side: z.literal('bid'),
      releaseId: idSchema('Pick a pressing'),
      price: priceText,
      minGrade: MIN_GRADE_FIELD,
      note: storedTextSchema('note', MAX_ORDER_NOTE_LENGTH),
    }),
    z.object({
      side: z.literal('ask'),
      copyId: idSchema('Pick the copy you’re selling'),
      price: priceText,
    }),
  ],
  { error: 'An order must be a bid or an ask' },
);

export const ORDER_STATUSES = Object.freeze(['open', 'filled', 'cancelled']);

/** Empty query-string values ("?status=") mean "no filter". */
const blankAsMissing = (value) => (value === '' ? undefined : value);

/** GET /api/orders?status=&releaseId= */
export const ordersQuerySchema = z.object({
  status: z.preprocess(
    blankAsMissing,
    z.enum(ORDER_STATUSES, { error: 'Status must be open, filled or cancelled' }).optional(),
  ),
  releaseId: z.preprocess(
    blankAsMissing,
    z.coerce.number().pipe(idSchema('Release ID must be a positive whole number')).optional(),
  ),
});
