/**
 * The Part 15 fields both ad forms share: how long the ad runs, and an optional "stay on
 * top" rule. Spec: docs/parts/part-15-expiry-repricing.md.
 */
import { DEFAULT_BID_EXPIRY_DAYS, EXPIRY_DAYS } from '../../../shared/index.js';
import { h } from '../dom.js';

const UNTIL_CANCELLED = '';

/** The words for each side's rule. */
const WORDS = {
  ask: {
    step: 'Stay the cheapest: go this much under a cheaper copy ($, optional)',
    stepHint: 'When another seller lists this grade for less, your ad drops below them.',
    limit: '…but never below ($)',
  },
  bid: {
    step: 'Stay the best offer: go this much over a higher one ($, optional)',
    stepHint: 'When another buyer offers more for this grade, your ad rises above them.',
    limit: '…but never above ($)',
  },
};

/**
 * @param {'bid' | 'ask'} side
 * @returns {{ fields: import('./couponForm.js').CouponField[], collect: () => object }}
 *   fields to add to the coupon, and the values they give its request
 */
export function adSettings(side) {
  const runsFor = h(
    'select',
    { class: 'input' },
    EXPIRY_DAYS.map((days) => h('option', { value: String(days) }, `${days} days`)),
    h('option', { value: UNTIL_CANCELLED }, 'Until I cancel it'),
  );
  // WANTED ads start at 30 days, FOR SALE ads at "until I cancel it".
  runsFor.value = side === 'bid' ? String(DEFAULT_BID_EXPIRY_DAYS) : UNTIL_CANCELLED;
  const step = h('input', {
    class: 'input',
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: '1.00',
  });
  const limit = h('input', {
    class: 'input',
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: side === 'ask' ? '30.00' : '60.00',
  });
  const words = WORDS[side];
  return {
    fields: [
      { name: 'expiresInDays', label: 'The ad runs for', control: runsFor },
      { name: 'repriceStep', label: words.step, control: step, hint: words.stepHint },
      { name: 'repriceLimit', label: words.limit, control: limit },
    ],
    collect: () => ({
      expiresInDays: runsFor.value === UNTIL_CANCELLED ? null : Number(runsFor.value),
      repriceStep: step.value,
      repriceLimit: limit.value,
    }),
  };
}

/** How an ad of yours describes its expiry and rule: "Runs to Dec 20 · stays $1.00 under rivals, to $30.00". */
export function adSettingsLine(order) {
  const parts = [];
  if (order.expiresAt) {
    const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
      new Date(order.expiresAt),
    );
    parts.push(`Runs to ${day}`);
  }
  if (order.reprice) {
    parts.push(
      order.side === 'ask'
        ? `stays $${order.reprice.step} under cheaper copies, down to $${order.reprice.limit}`
        : `stays $${order.reprice.step} over higher offers, up to $${order.reprice.limit}`,
    );
  }
  const line = parts.join(' · ');
  return line && line.charAt(0).toUpperCase() + line.slice(1);
}
