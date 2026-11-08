/**
 * Facts about one physical copy that both the forms and the server need: the condition
 * flags a seller can tick, field limits, and how a copy's condition is written.
 * The database checks the same limits (migration 003), so keep the two in step.
 */
import { gradeByRank } from './grades.js';

/** Everyone starts with $2,000 of play money. Matches users.cash_cents DEFAULT. */
export const STARTING_CASH_CENTS = 200_000;

export const MAX_HEADLINE_LENGTH = 40; // the bold lead of an ad: "FIRST PRESS."
export const MAX_NOTES_LENGTH = 500; // the seller's description of the copy
export const MAX_ORDER_NOTE_LENGTH = 200; // a buyer's line on a WANTED ad
export const MAX_PHOTOS_PER_COPY = 6;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Problems a grade alone doesn't tell a buyer. Codes are stored in copies.flags.
 * Order is the order the form shows them in.
 */
export const CONDITION_FLAGS = Object.freeze([
  { code: 'warp', label: 'Warped' },
  { code: 'skips', label: 'Skips' },
  { code: 'groove_wear', label: 'Groove wear' },
  { code: 'ring_wear', label: 'Ring wear on the sleeve' },
  { code: 'seam_split', label: 'Split seam' },
  { code: 'label_writing', label: 'Writing on the label' },
]);

export const CONDITION_FLAG_CODES = CONDITION_FLAGS.map((flag) => flag.code);

/** @param {string} code */
export function conditionFlagLabel(code) {
  return CONDITION_FLAGS.find((flag) => flag.code === code)?.label ?? null;
}

/**
 * How record shops write condition: record grade, then sleeve grade.
 * conditionText(6, 5) -> "VG+/VG"; conditionText(6, null) -> "VG+, generic sleeve".
 * @param {number} grade
 * @param {number | null | undefined} sleeveGrade
 */
export function conditionText(grade, sleeveGrade) {
  const record = gradeByRank(grade);
  if (!record) throw new RangeError(`Unknown grade ${grade}`);
  if (sleeveGrade === null || sleeveGrade === undefined) return `${record.code}, generic sleeve`;
  const sleeve = gradeByRank(sleeveGrade);
  if (!sleeve) throw new RangeError(`Unknown sleeve grade ${sleeveGrade}`);
  return `${record.code}/${sleeve.code}`;
}
