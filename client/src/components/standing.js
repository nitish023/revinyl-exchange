/**
 * "You as a seller" in the Listening Room (Part 12): your level and fee, how reliable buyers
 * have found you, and what the next level needs. Empty until it loads, and stays empty if
 * it can't: it's a footnote to the room, not something the room needs.
 */
import { percentText, SELLER_LEVELS, trustScoreText } from '../../../shared/index.js';
import { h, replaceChildren } from '../dom.js';
import { standingOrNull, standingText } from '../lib/fees.js';

/** "Levels: 1 · 12%  2 · 11.5% ..." so the whole ladder is visible. */
export function levelLadder(current) {
  return SELLER_LEVELS.map((tier) =>
    h(
      'li',
      { class: tier.level === current ? 'is-current' : null },
      h('b', {}, `Level ${tier.level}`),
      ` ${percentText(tier.transactionFeeBps + 300)}`,
    ),
  );
}

/** @param {{ signal: AbortSignal }} options */
export function standingBox({ signal }) {
  const root = h('aside', { class: 'room-standing', 'aria-labelledby': 'standing-title' });

  void standingOrNull(signal).then((standing) => {
    if (!standing || signal.aborted) return;
    const reliability =
      standing.completed + standing.refunded > 0
        ? trustScoreText(standing)
        : 'Your trust score starts with your first settled sale.';
    replaceChildren(
      root,
      h('p', { id: 'standing-title', class: 'label' }, 'You as a seller'),
      h('p', { class: 'room-standing-text' }, standingText(standing)),
      h('p', { class: 'room-standing-text' }, reliability),
      h(
        'ol',
        { class: 'level-ladder', 'aria-label': 'Seller levels and fees' },
        levelLadder(standing.level),
      ),
    );
  });
  return root;
}
