/**
 * The buttons on one ad in the classifieds (Part 5): "Buy this copy" on a FOR SALE ad, "Sell
 * to them" on a WANTED ad, or a "Log in" link when logged out. Spec: docs/parts/part-5-trades.md.
 *
 * The market section (components/market.js) calls this for every ad and puts what it returns
 * next to the ad's price. Both actions move money, so each needs a second press. The request
 * only names the ad (and, to sell, your copy): the server takes the price from the ad.
 */
import { gradeByRank } from '../../../shared/index.js';
import { h, replaceChildren } from '../dom.js';
import { api } from '../lib/api.js';
import { errorsFromUnknown } from '../lib/forms.js';
import { actionButton } from './actionButton.js';

/** Copies you could sell to this WANTED ad: yours, free to sell, and good enough. */
export function copiesThatFit(copies, minGrade) {
  return copies.filter(
    (copy) => (copy.status === 'in_crate' || copy.status === 'listed') && copy.grade >= minGrade,
  );
}

/** How a copy reads in the "Sell to them" list. */
export function copyChoiceLabel(copy) {
  return copy.ask ? `${copy.condition} (listed at $${copy.ask.price})` : copy.condition;
}

function loginLink(release, kind) {
  const next = encodeURIComponent(`/release/${release.id}`);
  return h(
    'a',
    { class: 'ad-login', href: `/login?next=${next}` },
    kind === 'forSale' ? 'Log in to buy' : 'Log in to sell',
  );
}

function buyButton(ad, onDone) {
  return actionButton({
    label: 'Buy this copy',
    confirm: `Pay $${ad.price}?`,
    run: () => api.buy(ad.orderId),
    done: `Bought for $${ad.price}. It’s in your Listening Room until the seller ships it.`,
    onDone,
  });
}

/**
 * "Sell to them": the first press looks up your copies of this pressing, then offers the
 * ones that fit with a confirm button. A listed copy can be chosen; its FOR SALE ad is
 * cancelled when it sells.
 */
function sellPicker(release, ad, onDone) {
  const root = h('span', { class: 'ad-sell' });
  const start = h('button', { class: 'button button--quiet', type: 'button' }, 'Sell to them');
  const say = (text) => h('span', { class: 'field-hint' }, text);

  start.addEventListener('click', async () => {
    start.disabled = true;
    replaceChildren(root, say('Checking your crate…'));
    let copies;
    try {
      copies = copiesThatFit((await api.crate(release.id)).copies, ad.minGrade);
    } catch (failure) {
      start.disabled = false;
      const message = errorsFromUnknown(failure).message ?? 'Couldn’t read your crate.';
      replaceChildren(root, start, h('span', { class: 'field-error', role: 'alert' }, message));
      return;
    }
    if (copies.length === 0) {
      const lowest = gradeByRank(ad.minGrade)?.code ?? 'the grade they asked for';
      replaceChildren(root, say(`You have no copy of this pressing at ${lowest} or better.`));
      return;
    }
    const choice = h(
      'select',
      { class: 'input ad-sell-copy', 'aria-label': 'Which copy to sell' },
      copies.map((copy) => h('option', { value: String(copy.id) }, copyChoiceLabel(copy))),
    );
    replaceChildren(
      root,
      choice,
      actionButton({
        label: `Sell for $${ad.price}`,
        confirm: `Sell it for $${ad.price}?`,
        run: () => api.sellTo(ad.orderId, Number(choice.value)),
        done: `Sold for $${ad.price}. Ship it from your Listening Room.`,
        onDone,
      }),
    );
    choice.focus();
  });

  root.append(start);
  return root;
}

/**
 * @param {{
 *   release: { id: number, title: string, artist: string },
 *   ad: import('../../../shared/market.js').MarketAd | import('../../../shared/market.js').WantedAd,
 *   kind: 'forSale' | 'wanted',
 *   user: { id: number, displayName: string } | null,
 *   mine: boolean,
 *   onDone: (message: string) => void,
 * }} options
 * @returns {HTMLElement | null}
 */
export function adActions({ release, ad, kind, user, mine, onDone }) {
  if (mine) return null;
  if (!user) return loginLink(release, kind);
  return kind === 'forSale' ? buyButton(ad, onDone) : sellPicker(release, ad, onDone);
}
