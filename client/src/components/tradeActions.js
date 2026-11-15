/**
 * The buttons on one trade in the Listening Room's ledger (Part 5). Spec:
 * docs/parts/part-5-trades.md.
 *   seller, awaiting shipment: "Ship it", "Cancel sale"
 *   buyer, shipped:            "It arrived", "Not as described"
 * Every trade in any other state, or on the other side, gets nothing. The money-moving
 * steps need a second press; shipping moves no money, so it doesn't.
 */
import { h } from '../dom.js';
import { api } from '../lib/api.js';
import { actionButton } from './actionButton.js';

/** The steps each side can take from each status, in the order the buttons appear. */
const STEPS = {
  seller: {
    awaiting_shipment: [
      { step: 'ship', label: 'Ship it', done: () => 'Marked as shipped. The buyer will check it.' },
      {
        step: 'cancel',
        label: 'Cancel sale',
        confirm: () => 'Refund the buyer?',
        done: () => 'Sale cancelled. The buyer has their money back and the copy is yours again.',
      },
    ],
  },
  buyer: {
    shipped: [
      {
        step: 'received',
        label: 'It arrived',
        confirm: (price) => `Pay the seller $${price}?`,
        done: (price) => `Done. The seller has been paid $${price} and the record is yours.`,
      },
      {
        step: 'refund',
        label: 'Not as described',
        confirm: () => 'Send it back for a refund?',
        done: (price) => `Refunded. $${price} is back in your cash.`,
      },
    ],
  },
};

/** The steps open to this side of the trade right now (empty when it's the other's turn). */
export function stepsFor(trade) {
  return STEPS[trade.role]?.[trade.status] ?? [];
}

/**
 * @param {{
 *   trade: { id: number, role: 'buyer' | 'seller', status: string, price: string,
 *     release: { id: number, title: string } },
 *   onDone: (message: string) => void,
 * }} options onDone: call after a change; the Listening Room reloads
 * @returns {HTMLElement | null}
 */
export function tradeActions({ trade, onDone }) {
  const steps = stepsFor(trade);
  if (steps.length === 0) return null;
  return h(
    'span',
    { class: 'trade-actions' },
    steps.map(({ step, label, confirm, done }) =>
      actionButton({
        label,
        confirm: confirm?.(trade.price),
        run: () => api.tradeStep(trade.id, step),
        done: done(trade.price),
        onDone,
      }),
    ),
  );
}
