/**
 * Your Crate (/crate): your money, the copies you own, and your open wanted ads.
 * Copies are added and listed from a pressing's page; here you can remove a copy that's
 * sitting in the crate, or cancel an ad.
 */
import { conditionFlagLabel } from '../../../shared/index.js';
import { adLine } from '../components/adCoupons.js';
import { cover } from '../components/cover.js';
import { emptyState, errorState, loadingState } from '../components/states.js';
import { h, replaceChildren } from '../dom.js';
import { api, isAbortError } from '../lib/api.js';
import { errorsFromUnknown } from '../lib/forms.js';
import { session } from '../session.js';

const STATUS_TEXT = {
  in_crate: 'In your crate',
  listed: 'For sale',
  in_trade: 'In a trade: waiting to ship',
};

/** @type {import('./page.js').Page} */
export const cratePage = (ctx) => {
  document.title = 'Your Crate | reVINYL';
  const root = h('main', { class: 'page crate-page' });
  if (!session.user) {
    return replaceAndReturn(
      root,
      h(
        'div',
        { class: 'state state-empty' },
        h('p', { class: 'state-title' }, 'Your crate is behind the counter.'),
        h(
          'p',
          { class: 'state-hint' },
          h('a', { href: '/login?next=%2Fcrate' }, 'Log in'),
          ' to see your records and your money.',
        ),
      ),
    );
  }

  const flash = h('p', { class: 'coupon-flash', role: 'status' });
  const body = h('div', {}, loadingState('Opening your crate…'));
  replaceChildren(
    root,
    h(
      'header',
      { class: 'page-head' },
      h('p', { class: 'kicker' }, 'Your Crate'),
      h('h1', { class: 'headline' }, 'Records you own'),
      h('p', { class: 'deck' }, 'Add copies and run ads from any pressing’s page.'),
    ),
    flash,
    body,
  );

  async function load() {
    try {
      const [{ wallet }, { copies }, { orders }] = await Promise.all([
        api.wallet(ctx.signal),
        api.crate(undefined, ctx.signal),
        api.orders({ status: 'open' }, ctx.signal),
      ]);
      if (ctx.signal.aborted) return;
      const wanted = orders.filter((order) => order.side === 'bid');
      replaceChildren(body, walletStrip(wallet), copiesSection(copies), wantedSection(wanted));
    } catch (error) {
      if (isAbortError(error) || ctx.signal.aborted) return;
      replaceChildren(
        body,
        errorState(errorsFromUnknown(error).message ?? 'We couldn’t open your crate.', () => {
          replaceChildren(body, loadingState('Opening your crate…'));
          void load();
        }),
      );
    }
  }

  /**
   * Run an action from a button; on success show its message and reload. With `confirm`,
   * the first press only changes the button to that text and the second press runs it.
   */
  function action(button, run, message, confirm) {
    const error = h('span', { class: 'field-error', role: 'alert' });
    let armed = !confirm;
    button.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        button.textContent = confirm;
        return;
      }
      button.disabled = true;
      error.textContent = '';
      try {
        await run();
        flash.textContent = message;
        await load();
      } catch (failure) {
        error.textContent = errorsFromUnknown(failure).message ?? 'That didn’t work. Try again.';
        button.disabled = false;
      }
    });
    return [button, error];
  }

  function copiesSection(copies) {
    return h(
      'section',
      { class: 'crate-section', 'aria-labelledby': 'crate-copies' },
      h(
        'div',
        { class: 'section-head' },
        h('h2', { id: 'crate-copies' }, 'Your copies'),
        h('p', {}, copies.length === 1 ? '1 record' : `${copies.length} records`),
      ),
      copies.length === 0
        ? emptyState(
            'Nothing in your crate yet',
            'Find a pressing you own and use “Add a copy to your crate” on its page.',
          )
        : h('ul', { class: 'crate-list' }, copies.map(copyRow)),
    );
  }

  function copyRow(copy) {
    const title = `${copy.release.title} by ${copy.release.artist}`;
    const flags = copy.flags.map(conditionFlagLabel).join(', ');
    const status = copy.ask
      ? `${STATUS_TEXT.listed} at $${copy.ask.price}`
      : (STATUS_TEXT[copy.status] ?? copy.status);
    return h(
      'li',
      { class: 'crate-item' },
      h(
        'a',
        { href: `/release/${copy.releaseId}`, class: 'crate-cover' },
        cover(copy.release.thumbUrl, `Cover of ${title}`, { size: 'thumb' }),
      ),
      h(
        'div',
        { class: 'crate-text' },
        h('a', { href: `/release/${copy.releaseId}`, class: 'crate-title' }, copy.release.title),
        h('p', { class: 'byline' }, copy.release.artist),
        h('p', {}, h('b', {}, copy.condition), copy.headline ? ` · ${copy.headline}` : ''),
        flags ? h('p', { class: 'field-hint' }, flags) : null,
        copy.notes ? h('p', { class: 'crate-notes' }, copy.notes) : null,
        copy.photos.length
          ? h(
              'div',
              { class: 'photo-strip' },
              copy.photos.map((photo) =>
                h('img', {
                  src: photo.url,
                  alt: `Photo ${photo.position} of your copy of ${copy.release.title}`,
                  loading: 'lazy',
                }),
              ),
            )
          : null,
      ),
      h('div', { class: 'crate-actions' }, h('p', { class: 'label' }, status), copyAction(copy)),
    );
  }

  function copyAction(copy) {
    if (copy.ask) {
      return action(
        h('button', { class: 'button button--quiet', type: 'button' }, 'Cancel FOR SALE ad'),
        () => api.cancelOrder(copy.ask.orderId),
        'FOR SALE ad cancelled. The copy is back in your crate.',
      );
    }
    if (copy.status !== 'in_crate') return null;
    // Removing can't be undone, so the first press asks and the second removes.
    return action(
      h('button', { class: 'button button--quiet', type: 'button' }, 'Remove'),
      () => api.removeCopy(copy.id),
      'Copy removed from your crate.',
      'Press again to remove',
    );
  }

  function wantedSection(wanted) {
    return h(
      'section',
      { class: 'crate-section', 'aria-labelledby': 'crate-wanted' },
      h(
        'div',
        { class: 'section-head' },
        h('h2', { id: 'crate-wanted' }, 'Your wanted ads'),
        h('p', {}, 'Your money is held while they run'),
      ),
      wanted.length === 0
        ? emptyState('No wanted ads running', 'Run one from any pressing’s page.')
        : h(
            'ul',
            { class: 'crate-list' },
            wanted.map((order) => {
              const { text, price } = adLine(order);
              return h(
                'li',
                { class: 'crate-item crate-item--ad' },
                h(
                  'div',
                  { class: 'crate-text' },
                  h(
                    'a',
                    { href: `/release/${order.releaseId}`, class: 'crate-title' },
                    order.release.title,
                  ),
                  h('p', { class: 'byline' }, order.release.artist),
                  h('p', {}, `${text}, ${price}`),
                  order.note ? h('p', { class: 'crate-notes' }, `“${order.note}”`) : null,
                ),
                h(
                  'div',
                  { class: 'crate-actions' },
                  action(
                    h('button', { class: 'button button--quiet', type: 'button' }, 'Cancel'),
                    () => api.cancelOrder(order.id),
                    `Wanted ad cancelled. $${order.price} is back in your spendable cash.`,
                  ),
                ),
              );
            }),
          ),
    );
  }

  void load();
  return root;
};

function walletStrip(wallet) {
  const figure = (label, value, hint) =>
    h(
      'div',
      { class: 'wallet-figure' },
      h('p', { class: 'label' }, label),
      h('p', { class: 'wallet-amount' }, `$${value}`),
      h('p', { class: 'field-hint' }, hint),
    );
  return h(
    'section',
    { class: 'wallet-strip', 'aria-label': 'Your money' },
    figure('Cash', wallet.cash, 'Everything you have'),
    figure('Held', wallet.held, 'Set aside for your wanted ads'),
    figure('To spend', wallet.spendable, 'Cash minus held'),
  );
}

function replaceAndReturn(root, child) {
  replaceChildren(root, child);
  return root;
}
