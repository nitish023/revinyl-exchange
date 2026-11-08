/**
 * Words for the market page: how ads, traders, prices and the report are written.
 * Pure functions, tested in market.test.js; components/market.js lays them out.
 */
import { conditionFlagLabel, gradeByRank } from '../../../shared/index.js';

/** What each grade means, in the words a record shop would use. Shown under each section. */
const GRADE_MEANINGS = {
  8: 'Never played. Perfect.',
  7: 'Looks and plays like new.',
  6: 'Light marks you can see but not hear.',
  5: 'Some surface noise in quiet parts.',
  4: 'Noisy, but plays all the way through.',
  3: 'Noisy, but it plays.',
  2: 'Heavy noise. For the music, not the shelf.',
  1: 'Barely plays. Mostly for the sleeve.',
};

/** @param {number} grade */
export function gradeSection(grade) {
  const { code, label } = gradeByRank(grade);
  return { code, name: label.toUpperCase(), meaning: GRADE_MEANINGS[grade] };
}

/** "42.00" -> "$42.00" */
export const money = (price) => `$${price}`;

/** "42.00" -> "$42", "42.50" -> "$42.50": the big report numbers drop zero cents. */
export function shortMoney(price) {
  return price.endsWith('.00') ? `$${price.slice(0, -3)}` : `$${price}`;
}

/** "3.00" -> "▲ $3", "-2.50" -> "▼ $2.50", "0.00" -> "Even", null -> "" */
export function priceChange(change) {
  if (change === null) return '';
  if (Number(change) === 0) return 'Even';
  return change.startsWith('-') ? `▼ ${shortMoney(change.slice(1))}` : `▲ ${shortMoney(change)}`;
}

const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/** Sellers sign their ads: "groovegarden, 54 trades." A first-timer says so. */
export function sellerLine(seller) {
  return seller.trades === 0
    ? `${seller.name}, new to reVINYL.`
    : `${seller.name}, ${plural(seller.trades, 'trade')}.`;
}

/** Buyers are never named: "Buyer, 9 trades." */
export function buyerLine(buyer) {
  return buyer.trades === 0 ? 'New buyer.' : `Buyer, ${plural(buyer.trades, 'trade')}.`;
}

/** The bold start of an ad: the seller's headline, or the condition if they didn't write one. */
export function adLead(ad) {
  const lead = ad.copy.headline.trim() || ad.copy.condition;
  return /[.!?]$/.test(lead) ? lead.toUpperCase() : `${lead.toUpperCase()}.`;
}

/**
 * The rest of an ad: condition (when the lead didn't already say it), the seller's notes,
 * the condition flags as a sentence, and the photo count.
 */
export function adText(ad) {
  const parts = [];
  if (ad.copy.headline.trim()) parts.push(`${ad.copy.condition}.`);
  const notes = ad.copy.notes.trim();
  if (notes) parts.push(/[.!?]$/.test(notes) ? notes : `${notes}.`);
  const flags = ad.copy.flags.map(conditionFlagLabel).filter(Boolean);
  if (flags.length) parts.push(`Known issues: ${flags.join(', ').toLowerCase()}.`);
  if (ad.copy.photos) parts.push(`${plural(ad.copy.photos, 'photo')}.`);
  return parts.join(' ');
}

/** "NM OR BETTER." / "MINT ONLY." */
export function wantedLead(minGrade) {
  const { code, label } = gradeByRank(minGrade);
  return minGrade === 8 ? `${label.toUpperCase()} ONLY.` : `${code} OR BETTER.`;
}

const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit' });

/** "2026-11-01T…" -> "Nov 01" */
export const shortDate = (iso) => SHORT_DATE.format(new Date(iso));

/** How many ads are running, for the line under the section head. */
export function adCount(market) {
  const copies = market.forSale.reduce((total, group) => total + group.ads.length, 0);
  const wanted = market.wanted.length;
  if (copies === 0 && wanted === 0) return 'No ads running';
  return `${plural(copies, 'copy', 'copies')} for sale · ${plural(wanted, 'wanted ad')}`;
}

/** Every order id on the page, to spot ads that are new since the last update. */
export function orderIds(market) {
  return new Set([
    ...market.forSale.flatMap((group) => group.ads.map((ad) => ad.orderId)),
    ...market.wanted.map((ad) => ad.orderId),
  ]);
}
