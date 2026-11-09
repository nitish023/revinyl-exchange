/**
 * The clip-out forms at the bottom of a pressing's classifieds (Part 3, Sauransh):
 *   - "Add a copy to your crate" (grade, sleeve grade, condition flags, headline, notes)
 *   - "Sell your copy" (pick one of your copies of this pressing, set a price)
 *   - "Run your own ad" (a WANTED ad: lowest grade you'll take, most you'll pay, a note)
 *   - your open ads on this pressing, each with a Cancel button
 * Logged out, it's one coupon that says to log in.
 *
 * The market section (Part 4, client/src/components/market.js) calls this and puts
 * whatever it returns under the ads.
 */
import { conditionText } from '../../../shared/index.js';
import { h, replaceChildren } from '../dom.js';
import { api, ApiError } from '../lib/api.js';
import { errorsFromUnknown } from '../lib/forms.js';
import { addCopyForm, minGradeText, sellForm, wantedForm } from './adForms.js';
import { errorState, loadingState } from './states.js';

/**
 * @param {{
 *   release: { id: number, title: string, artist: string },
 *   user: { id: number, displayName: string } | null,
 *   onPosted: () => void,
 * }} options onPosted: call after an order is placed or cancelled; the market reloads
 *   your own ads (everyone else's tabs update over the WebSocket by themselves)
 * @returns {HTMLElement | null}
 */
export function adCoupons({ release, user, onPosted }) {
  if (!user) return loginCoupon(release);

  const flash = h('p', { class: 'coupon-flash', role: 'status' });
  const body = h('div', {}, loadingState('Fetching your crate…'));
  const root = h(
    'section',
    { class: 'ad-coupons', 'aria-labelledby': 'ad-coupons-title' },
    h(
      'div',
      { class: 'section-head' },
      h('h2', { id: 'ad-coupons-title' }, 'Run an ad'),
      h('p', {}, 'Clip, fill in, send'),
    ),
    flash,
    body,
  );

  async function refresh() {
    try {
      const [{ copies }, { wallet }, { orders }] = await Promise.all([
        api.crate(release.id),
        api.wallet(),
        api.orders({ status: 'open', releaseId: release.id }),
      ]);
      replaceChildren(
        body,
        h(
          'div',
          { class: 'ad-coupon-grid' },
          addCopyForm({ release, onDone: (message) => finish(message, false) }),
          sellForm({
            copies: copies.filter((copy) => copy.status === 'in_crate'),
            onDone: (message) => finish(message, true),
          }),
          wantedForm({ release, wallet, onDone: (message) => finish(message, true) }),
        ),
        yourAds(orders, (message) => finish(message, true)),
      );
    } catch (error) {
      replaceChildren(
        body,
        errorState(
          errorsFromUnknown(error).message ?? 'We couldn’t load your crate.',
          () => void refresh(),
        ),
      );
    }
  }

  /** After something changed: show what happened, redraw with fresh data, tell the market. */
  async function finish(message, marketChanged) {
    flash.textContent = message;
    await refresh();
    if (marketChanged) onPosted();
  }

  void refresh();
  return root;
}

function loginCoupon(release) {
  const next = encodeURIComponent(`/release/${release.id}`);
  return h(
    'section',
    { class: 'coupon ad-coupon ad-coupon--login' },
    h('h3', { class: 'coupon-title' }, 'Run your own ad'),
    h(
      'p',
      { class: 'coupon-intro' },
      'Have a copy to sell, or want one in a certain grade? ',
      h('a', { href: `/login?next=${next}` }, 'Log in'),
      ' or ',
      h('a', { href: `/register?next=${next}` }, 'sign up'),
      ' to run an ad. Every new account starts with $2,000 of play money.',
    ),
  );
}

/** Describe one of your open orders in a line: what it is and its price. */
export function adLine(order) {
  if (order.side === 'ask') {
    const condition = order.copy ? conditionText(order.copy.grade, order.copy.sleeveGrade) : 'Copy';
    return { kind: 'FOR SALE', text: condition, price: `$${order.price}` };
  }
  return { kind: 'WANTED', text: minGradeText(order.minGrade), price: `up to $${order.price}` };
}

/** Your open ads on this pressing, each with a Cancel button. */
function yourAds(orders, onDone) {
  if (orders.length === 0) return null;
  return h(
    'div',
    { class: 'your-ads' },
    h('h3', { class: 'label' }, 'Your ads on this pressing'),
    h(
      'ul',
      {},
      orders.map((order) => {
        const { kind, text, price } = adLine(order);
        const error = h('span', { class: 'field-error', role: 'alert' });
        const cancel = h('button', { class: 'button button--quiet', type: 'button' }, 'Cancel');
        cancel.addEventListener('click', async () => {
          cancel.disabled = true;
          error.textContent = '';
          try {
            await api.cancelOrder(order.id);
            await onDone(
              order.side === 'bid'
                ? `Wanted ad cancelled. $${order.price} is back in your spendable cash.`
                : 'FOR SALE ad cancelled. The copy is back in your crate.',
            );
          } catch (failure) {
            // 409: it filled or was cancelled elsewhere first. Redraw so the list is current.
            if (failure instanceof ApiError && failure.status === 409) {
              await onDone(failure.message);
              return;
            }
            error.textContent = errorsFromUnknown(failure).message ?? 'Couldn’t cancel that ad.';
            cancel.disabled = false;
          }
        });
        return h(
          'li',
          {},
          h('span', { class: 'label' }, kind),
          h('span', {}, text),
          h('span', { class: 'your-ad-price' }, price),
          cancel,
          error,
        );
      }),
    ),
  );
}
