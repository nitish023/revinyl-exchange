/**
 * "The reVINYL 30" on the front page (Part 18): one number for the whole record market,
 * built like a stock index, its last 90 days as a line, and its biggest members.
 * Spec: docs/parts/part-18-index-portfolio.md.
 */
import { h, replaceChildren } from '../dom.js';
import { api, isAbortError } from '../lib/api.js';
import { signedPercent } from '../lib/charts.js';
import { releasePath } from '../lib/records.js';
import { lineChart } from './lineChart.js';

/** "1,042.17" */
export const levelText = (level) =>
  level.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function indexChart(index) {
  return lineChart({
    points: index.series.map((point) => ({ day: point.day, value: point.level })),
    format: (value) => levelText(value).replace(/\.00$/, ''),
    label: `The reVINYL 30 over ${index.series.length} days, now ${levelText(index.level)}.`,
  });
}

function membersTable(members) {
  return h(
    'table',
    { class: 'ledger-table index-members' },
    h('caption', { class: 'visually-hidden' }, 'The biggest members of the reVINYL 30'),
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        ['#', 'Record', 'Weight', 'VG+ price'].map((name) => h('th', { scope: 'col' }, name)),
      ),
    ),
    h(
      'tbody',
      {},
      members
        .slice(0, 10)
        .map((member, i) =>
          h(
            'tr',
            {},
            h('td', {}, String(i + 1)),
            h(
              'td',
              {},
              h(
                'a',
                { href: releasePath(member.release.id) },
                member.release.title ?? 'A pressing',
              ),
              member.release.artist
                ? h('span', { class: 'ledger-side' }, member.release.artist)
                : null,
            ),
            h('td', { class: 'ledger-amount' }, `${(member.weight * 100).toFixed(1)}%`),
            h('td', { class: 'ledger-amount' }, `$${member.price}`),
          ),
        ),
    ),
  );
}

/** @param {{ signal: AbortSignal }} options */
export function marketIndexSection({ signal }) {
  const body = h('div');
  const element = h(
    'section',
    { class: 'front-index', 'aria-labelledby': 'index-title' },
    h(
      'div',
      { class: 'section-head' },
      h('h2', { id: 'index-title' }, 'The reVINYL 30'),
      h('p', {}, 'The record market in one number'),
    ),
    body,
  );

  void (async () => {
    try {
      const { index } = await api.marketIndex(signal);
      if (signal.aborted) return;
      if (index.level === null) {
        replaceChildren(
          body,
          h('p', { class: 'room-none' }, 'The index starts with the first sale.'),
        );
        return;
      }
      replaceChildren(
        body,
        h(
          'p',
          { class: 'index-level' },
          h('span', { class: 'index-number' }, levelText(index.level)),
          index.change30 === null
            ? null
            : h('span', { class: 'index-change' }, ` ${signedPercent(index.change30)} in 30 days`),
        ),
        indexChart(index),
        membersTable(index.members),
        h(
          'p',
          { class: 'statement-books' },
          `The ${index.size} pressings with the most money traded in the last 90 days, each priced at its latest sale as a VG+ copy and weighted by what was traded in it. Rebalanced every ${index.rebalanceDays} days, with the divisor reset so a change of members never moves the index. Started at 1,000; trades flagged as possible wash trading don't count.`,
        ),
      );
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return;
      replaceChildren(body, h('p', { class: 'room-none' }, 'The index isn’t available right now.'));
    }
  })();
  return element;
}
