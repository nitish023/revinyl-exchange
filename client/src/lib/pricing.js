/**
 * What the appraisal and the sell form say about prices (Part 13). The numbers come from
 * GET /api/releases/:id/pricing and shared/pricing.js.
 */
import {
  aChance,
  chanceOfSale,
  chanceText,
  formatCents,
  MAX_PRICE_CENTS,
  MIN_PRICE_CENTS,
  parseDollars,
  suggestPrices,
} from '../../../shared/index.js';
import { api } from './api.js';

/** A pressing's pricing, or null if it can't be read: the sell form works without it. */
export async function pricingOrNull(releaseId, signal) {
  try {
    return (await api.pricing(releaseId, signal)).pricing;
  } catch {
    return null;
  }
}

/** The fair value row for a grade, with its cents, or null without an appraisal. */
export function fairFor(pricing, grade) {
  const row = pricing?.fairValue?.grades.find((candidate) => candidate.grade === grade);
  return row ? { ...row, fairCents: parseDollars(row.fair) } : null;
}

/** "Fair value for VG+: $38.00 (likely $31.00 to $46.00)." */
export function fairLine(row) {
  return `Fair value for ${row.code}: $${row.fair} (likely $${row.low} to $${row.high}).`;
}

/**
 * "At $40.50: a 48% chance it sells within a week, 93% within a month." or '' while the
 * price isn't valid yet.
 */
export function chanceLine(priceText, pricing, row) {
  if (!row || !pricing?.odds) return '';
  const cents = parseDollars(priceText);
  if (cents === null || cents < MIN_PRICE_CENTS || cents > MAX_PRICE_CENTS) return '';
  const week = chanceOfSale(pricing.odds, cents, row.fairCents, 7);
  const month = chanceOfSale(pricing.odds, cents, row.fairCents, 30);
  return `At $${formatCents(cents)}: ${aChance(week)} it sells within a week, ${chanceText(month)} within a month.`;
}

/**
 * The three suggested prices as button labels and the price each fills in.
 * @returns {{ label: string, price: string }[]}
 */
export function suggestionChips(pricing, row) {
  if (!row || !pricing?.odds) return [];
  const suggestions = suggestPrices(pricing.odds, row.fairCents);
  if (!suggestions) return [];
  const { quick, fair, patient } = suggestions;
  return [
    { name: 'Quick sale', s: quick, when: `${chanceText(quick.week)} within a week` },
    { name: 'Fair value', s: fair, when: `${chanceText(fair.week)} within a week` },
    { name: 'Patient', s: patient, when: `${chanceText(patient.month)} within a month` },
  ].map(({ name, s, when }) => ({
    label: `${name} $${formatCents(s.priceCents)} · ${when}`,
    price: formatCents(s.priceCents),
  }));
}

/** The footnote under the appraisal table. */
export function appraisalNote(fairValue) {
  const step = Math.round(fairValue.gradeStep * 100);
  const sales = `${fairValue.salesUsed} ${fairValue.salesUsed === 1 ? 'sale' : 'sales'}`;
  const outliers =
    fairValue.outliers > 0
      ? ` ${fairValue.outliers} unusual ${fairValue.outliers === 1 ? 'sale was' : 'sales were'} set aside.`
      : '';
  return (
    `Each grade up adds about ${step}%. From ${sales}, recent ones counting most (a sale’s weight ` +
    `halves every ${fairValue.halfLifeDays} days).${outliers} Eight in ten sales should land in the range.`
  );
}
