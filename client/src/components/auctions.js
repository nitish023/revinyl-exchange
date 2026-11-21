/**
 * "Auctions" on a pressing's page (Part 16): its open sealed-bid auctions, each with a bid
 * form, and its last few results. Spec: docs/parts/part-16-auctions.md.
 */
import { conditionText } from '../../../shared/index.js';
import { h, replaceChildren } from '../dom.js';
import { api, isAbortError } from '../lib/api.js';
import { errorsFromUnknown } from '../lib/forms.js';
import { actionButton } from './actionButton.js';

const ENDS = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "3 sealed bids", "1 sealed bid", "No bids yet". */
export const bidCount = (count) =>
  count === 0 ? 'No bids yet' : `${count} sealed ${count === 1 ? 'bid' : 'bids'}`;

/** How a finished auction reads. */
export function resultLine(auction) {
  return auction.status === 'sold'
    ? `Sold for $${auction.price} after ${bidCount(auction.bids).toLowerCase()}.`
    : 'Ended unsold: no bid met the reserve.';
}

function bidForm(auction, onDone) {
  const amount = h('input', {
    class: 'input ad-sell-copy',
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: auction.myBid ?? auction.reserve,
    'aria-label': 'Your sealed bid ($)',
  });
  const error = h('span', { class: 'field-error', role: 'alert' });
  const submit = h(
    'button',
    { class: 'button', type: 'submit' },
    auction.myBid ? 'Raise my bid' : 'Place a sealed bid',
  );
  return h(
    'form',
    {
      class: 'auction-bid',
      onsubmit: async (event) => {
        event.preventDefault();
        submit.disabled = true;
        error.textContent = '';
        try {
          await api.auctionBid(auction.id, amount.value);
          onDone(`Your sealed bid of $${amount.value} is in. It’s held until the auction ends.`);
        } catch (failure) {
          const { fields, message } = errorsFromUnknown(failure);
          error.textContent = fields.amount ?? message ?? 'That bid didn’t go through.';
          submit.disabled = false;
        }
      },
    },
    amount,
    submit,
    error,
  );
}

function auctionCard(auction, user, onDone) {
  const facts = [
    `Reserve $${auction.reserve}`,
    `ends ${ENDS.format(new Date(auction.endsAt))}`,
    bidCount(auction.bids),
  ].join(' · ');
  let action;
  if (auction.mine) {
    action =
      auction.bids === 0
        ? actionButton({
            label: 'Take it down',
            confirm: 'Take your auction down?',
            run: () => api.cancelAuction(auction.id),
            done: 'Auction taken down. The copy is back in your crate.',
            onDone,
          })
        : h(
            'span',
            { class: 'ledger-side' },
            'Your auction: it runs its course now that people have bid.',
          );
  } else if (!user) {
    action = h(
      'a',
      {
        class: 'ad-login',
        href: `/login?next=${encodeURIComponent(`/release/${auction.releaseId}`)}`,
      },
      'Log in to bid',
    );
  } else {
    action = bidForm(auction, onDone);
  }
  return h(
    'li',
    { class: 'auction-card' },
    h(
      'p',
      { class: 'auction-lead' },
      h('b', {}, conditionText(auction.copy.grade, auction.copy.sleeveGrade)),
      auction.copy.headline ? ` · ${auction.copy.headline}` : '',
      ` · ${auction.seller.name}`,
    ),
    h('p', { class: 'ledger-side' }, facts),
    auction.myBid ? h('p', { class: 'ledger-side' }, `Your sealed bid: $${auction.myBid}.`) : null,
    action,
  );
}

/**
 * @param {{ releaseId: number, user: () => object | null, signal: AbortSignal }} options
 * @returns {{ element: HTMLElement, refresh: () => void }}
 */
export function auctionsSection({ releaseId, user, signal }) {
  const flash = h('p', { class: 'coupon-flash', role: 'status' });
  const body = h('div');
  const element = h(
    'section',
    { class: 'appraisal auctions', 'aria-labelledby': 'auctions-title' },
    h(
      'div',
      { class: 'section-head section-head--small' },
      h('h2', { id: 'auctions-title' }, 'Auctions'),
      h('p', {}, 'Sealed bids, second price'),
    ),
    h(
      'p',
      { class: 'statement-books' },
      'Nobody sees anyone else’s bid. When an auction ends, the highest bid wins and pays the second-highest bid (or the reserve, if that’s more). So bid the most the copy is worth to you: you’ll never pay more than you have to.',
    ),
    flash,
    body,
  );

  const done = (message) => {
    flash.textContent = message;
    void refresh();
  };

  async function refresh() {
    try {
      const { auctions } = await api.auctions(releaseId, signal);
      if (signal.aborted) return;
      replaceChildren(
        body,
        auctions.open.length
          ? h(
              'ul',
              { class: 'auction-list' },
              auctions.open.map((a) => auctionCard(a, user(), done)),
            )
          : h(
              'p',
              { class: 'room-none' },
              'No copies up for auction. Put one up with the coupon above.',
            ),
        auctions.results.length
          ? [
              h('h3', { class: 'history-subhead' }, 'Recent results'),
              h(
                'ul',
                { class: 'auction-list' },
                auctions.results.map((a) =>
                  h(
                    'li',
                    { class: 'auction-card' },
                    h('b', {}, conditionText(a.copy.grade, a.copy.sleeveGrade)),
                    ` · ${resultLine(a)}`,
                  ),
                ),
              ),
            ]
          : null,
      );
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return;
      replaceChildren(body, h('p', { class: 'room-none' }, 'Auctions aren’t available right now.'));
    }
  }

  void refresh();
  return { element, refresh: () => void refresh() };
}
