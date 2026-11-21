/**
 * "The appraisal" on a pressing's page (Part 13): what a copy is worth in each grade, with
 * the range eight in ten sales land in, from every sale of the pressing. Spec:
 * docs/parts/part-13-fair-value.md.
 */
import { h, replaceChildren } from '../dom.js';
import { api, isAbortError } from '../lib/api.js';
import { appraisalNote } from '../lib/pricing.js';

function appraisalTable(fairValue) {
  return h(
    'table',
    { class: 'ledger-table appraisal-table' },
    h('caption', { class: 'visually-hidden' }, 'Fair value by grade, best grade first'),
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        ['Grade', 'Fair value', 'Likely range', 'Sales'].map((name) =>
          h('th', { scope: 'col' }, name),
        ),
      ),
    ),
    h(
      'tbody',
      {},
      [...fairValue.grades]
        .reverse()
        .map((row) =>
          h(
            'tr',
            { class: row.sales > 0 ? 'appraisal-sold' : null },
            h('td', {}, row.code),
            h('td', { class: 'ledger-amount' }, `$${row.fair}`),
            h('td', { class: 'ledger-amount' }, `$${row.low} to $${row.high}`),
            h('td', { class: 'ledger-amount' }, String(row.sales)),
          ),
        ),
    ),
  );
}

/** The reasons surveillance gives, in words. */
export const REASON_WORDS = {
  round_trip: 'the copy went back to someone who sold it',
  pair_churn: 'the same two traders kept trading with each other',
};

/**
 * Part 17: "Market integrity", under the appraisal: which sales were left out of these
 * numbers and why. Nothing is shown when nothing was set aside.
 */
export function integrityNote(integrity) {
  const { washTrades, outliers, checked } = integrity;
  if (washTrades.length === 0 && outliers.length === 0) {
    return checked > 0
      ? h(
          'p',
          { class: 'statement-books integrity-note' },
          `Market integrity: all ${checked} recent ${checked === 1 ? 'sale looks' : 'sales look'} like real trades.`,
        )
      : null;
  }
  const line = (sale, why) =>
    h(
      'li',
      {},
      `$${sale.price} (${sale.code}), ${new Date(sale.at).toISOString().slice(0, 10)}: ${why}`,
    );
  return h(
    'div',
    { class: 'integrity-note' },
    h(
      'p',
      { class: 'statement-books' },
      `Market integrity: ${washTrades.length + outliers.length} of ${checked} recent sales are left out of these numbers.`,
    ),
    h(
      'ul',
      { class: 'integrity-list' },
      washTrades.map((sale) =>
        line(
          sale,
          `possible wash trading (${sale.reasons.map((r) => REASON_WORDS[r]).join('; ')})`,
        ),
      ),
      outliers.map((sale) => line(sale, 'too far from every other sale to trust')),
    ),
  );
}

/**
 * @param {{ releaseId: number, signal: AbortSignal }} options
 * @returns {{ element: HTMLElement, refresh: () => void }} refresh after a sale
 */
export function appraisalSection({ releaseId, signal }) {
  const body = h('div', { class: 'appraisal-body' });
  const element = h(
    'section',
    { class: 'appraisal', 'aria-labelledby': 'appraisal-title' },
    h(
      'div',
      { class: 'section-head section-head--small' },
      h('h2', { id: 'appraisal-title' }, 'The appraisal'),
      h('p', {}, 'What a copy is worth, by grade'),
    ),
    body,
  );

  async function refresh() {
    try {
      const [{ pricing }, integrity] = await Promise.all([
        api.pricing(releaseId, signal),
        // Part 17: what surveillance set aside. A footnote: the appraisal stands without it.
        (async () => (await api.integrity(releaseId, signal)).integrity)().catch(() => null),
      ]);
      if (signal.aborted) return;
      replaceChildren(
        body,
        pricing.fairValue
          ? [
              appraisalTable(pricing.fairValue),
              h('p', { class: 'statement-books' }, appraisalNote(pricing.fairValue)),
            ]
          : h(
              'p',
              { class: 'room-none' },
              'No sales yet. The appraisal starts with the first one.',
            ),
        integrity ? integrityNote(integrity) : null,
      );
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return;
      replaceChildren(
        body,
        h('p', { class: 'room-none' }, 'The appraisal isn’t available right now.'),
      );
    }
  }

  void refresh();
  return { element, refresh: () => void refresh() };
}
