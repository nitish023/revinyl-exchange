/**
 * What the sell forms and the Listening Room say about seller fees (Part 12). The numbers
 * come from shared/fees.js, the same code the server fixes each trade's fee with.
 */
import {
  formatCents,
  MAX_PRICE_CENTS,
  MIN_PRICE_CENTS,
  parseDollars,
  payoutFor,
  percentText,
} from '../../../shared/index.js';
import { api } from './api.js';

/**
 * "You get $35.20 after the 12% fee (level 1 seller)." for a price as typed, or '' while
 * the price isn't a valid one yet.
 * @param {string} priceText
 * @param {{ level: number } | null} standing null when it couldn't be read
 */
export function payoutLine(priceText, standing) {
  if (!standing) return '';
  const cents = parseDollars(priceText);
  if (cents === null || cents < MIN_PRICE_CENTS || cents > MAX_PRICE_CENTS) return '';
  const { payoutCents, feeBps } = payoutFor(cents, standing.level);
  return `You get $${formatCents(payoutCents)} after the ${percentText(feeBps)} fee (level ${standing.level} seller).`;
}

/** Your standing as a seller, or null if it can't be read: the forms work without it. */
export async function standingOrNull(signal) {
  try {
    return (await api.seller(signal)).standing;
  } catch {
    return null;
  }
}

/**
 * "Level 2 seller · 11.5% fee · 3 sales ($120.00) in the last 90 days. Level 3 (11% fee)
 * needs 7 more sales and $380.00 more in sales."
 * @param {object} standing what GET /api/seller returns
 */
export function standingText(standing) {
  const now = `Level ${standing.level} seller · ${standing.fee} fee · ${standing.sales90} ${
    standing.sales90 === 1 ? 'sale' : 'sales'
  } ($${standing.volume90}) in the last 90 days.`;
  const { next } = standing;
  if (!next) return `${now} That’s the top level.`;
  const needs = [];
  if (next.salesNeeded > 0) {
    needs.push(`${next.salesNeeded} more ${next.salesNeeded === 1 ? 'sale' : 'sales'}`);
  }
  if (next.volumeNeeded !== '0.00') needs.push(`$${next.volumeNeeded} more in sales`);
  if (next.reliabilityNeeded > 0) {
    needs.push(`a reliability score of ${Math.round(next.reliabilityNeeded * 100)}%`);
  }
  return `${now} Level ${next.level} (${next.fee} fee) needs ${needs.join(' and ')}.`;
}
