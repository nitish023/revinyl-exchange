/**
 * "Your portfolio" in the Listening Room (Part 18): what your records are worth at fair
 * value, what you paid for them, and what you've made selling. Spec:
 * docs/parts/part-18-index-portfolio.md.
 */
import { h, replaceChildren } from '../dom.js';
import { api, isAbortError } from '../lib/api.js';
import { releasePath } from '../lib/records.js';
import { signedAmount } from './statement.js';

const STATUS_WORDS = {
  in_crate: 'in your crate',
  listed: 'for sale',
  in_auction: 'up for auction',
  in_trade: 'sold, on its way',
  on_its_way: 'bought, on its way to you',
};

/** "+12.80" style money, or "—" when there's nothing to say (no cost basis, no fair value). */
const signedOrDash = (amount) => (amount === null ? '—' : signedAmount(amount));

/** The totals in a sentence. */
export function portfolioSummary(totals) {
  const parts = [
    `Net worth $${totals.netWorth}: $${totals.cash} cash and $${totals.holdings} of records at fair value.`,
  ];
  if (totals.returnShare !== null) {
    parts.push(
      `On the $${totals.invested} you’ve put into records here, you’re ${signedAmount(totals.unrealized)} on paper and ${signedAmount(totals.realized)} from sales: ${totals.returnShare >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(totals.returnShare * 1000) / 10)}%.`,
    );
  }
  if (totals.unpriced > 0) {
    parts.push(
      `${totals.unpriced} ${totals.unpriced === 1 ? 'record has' : 'records have'} no fair value yet (never sold here).`,
    );
  }
  return parts.join(' ');
}

const record = (item) =>
  h(
    'td',
    {},
    h('a', { href: releasePath(item.release.id) }, item.release.title ?? 'A pressing'),
    h(
      'span',
      { class: 'ledger-side' },
      `${item.code}${item.status ? `, ${STATUS_WORDS[item.status] ?? item.status}` : ''}`,
    ),
  );

function table(caption, headings, rows) {
  return h(
    'table',
    { class: 'ledger-table statement-table' },
    h('caption', { class: 'visually-hidden' }, caption),
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        headings.map((name) => h('th', { scope: 'col' }, name)),
      ),
    ),
    h('tbody', {}, rows),
  );
}

/** @param {{ signal: AbortSignal }} options */
export function portfolioSection({ signal }) {
  const body = h('div');
  const element = h(
    'section',
    { class: 'room-statement', 'aria-labelledby': 'portfolio-title' },
    h(
      'div',
      { class: 'section-head section-head--small' },
      h('h2', { id: 'portfolio-title' }, 'Your portfolio'),
      h('p', {}, 'Marked to fair value'),
    ),
    body,
  );

  void (async () => {
    try {
      const { portfolio } = await api.portfolio(signal);
      if (signal.aborted) return;
      replaceChildren(
        body,
        h('p', { class: 'room-standing-text' }, portfolioSummary(portfolio.totals)),
        portfolio.holdings.length
          ? table(
              'Your records at fair value, with what each cost you',
              ['Record', 'Cost', 'Fair value', 'Gain'],
              portfolio.holdings.map((holding) =>
                h(
                  'tr',
                  {},
                  record(holding),
                  h(
                    'td',
                    { class: 'ledger-amount' },
                    holding.cost ? `$${holding.cost}` : 'added by you',
                  ),
                  h('td', { class: 'ledger-amount' }, holding.fair ? `$${holding.fair}` : '—'),
                  h('td', { class: 'ledger-amount' }, signedOrDash(holding.unrealized)),
                ),
              ),
            )
          : null,
        portfolio.realized.length
          ? [
              h('h3', { class: 'history-subhead' }, 'Sold'),
              table(
                'Your sales: what each paid you after the fee, and your gain',
                ['Record', 'Paid you', 'It cost you', 'Gain'],
                portfolio.realized.map((sale) =>
                  h(
                    'tr',
                    {},
                    record({ ...sale, status: null }),
                    h('td', { class: 'ledger-amount' }, `$${sale.proceeds}`),
                    h(
                      'td',
                      { class: 'ledger-amount' },
                      sale.cost ? `$${sale.cost}` : 'added by you',
                    ),
                    h('td', { class: 'ledger-amount' }, signedOrDash(sale.gain)),
                  ),
                ),
              ),
            ]
          : null,
      );
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return;
      replaceChildren(
        body,
        h('p', { class: 'room-none' }, 'Your portfolio isn’t available right now.'),
      );
    }
  })();
  return element;
}
