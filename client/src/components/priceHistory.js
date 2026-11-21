/**
 * "Price history" and "The book" on a pressing's page (Part 14): daily candles in VG+ terms
 * with each day's sales underneath, and the open ads as a depth chart. Plain SVG in the
 * paper's one ink: an up day is a hollow candle, a down day a filled one; wanted ads are a
 * shaded staircase and copies for sale a hatched one. Spec: docs/parts/part-14-history.md.
 */
import { h, replaceChildren } from '../dom.js';
import { api, isAbortError } from '../lib/api.js';
import {
  bookSentence,
  busiestGrade,
  CANDLE_FRAME,
  candleLayout,
  DEPTH_FRAME,
  depthLayout,
  historySummary,
  shortDay,
} from '../lib/charts.js';

const SVG = 'http://www.w3.org/2000/svg';

/** Like h(), for SVG elements. */
function s(tag, attrs = {}, ...children) {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) element.setAttribute(name, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

const copies = (count) => `${count} ${count === 1 ? 'copy' : 'copies'}`;

const dollars = (cents) => `$${(cents / 100).toFixed(cents >= 10_000 ? 0 : 2)}`;

function candleChart(history) {
  const frame = CANDLE_FRAME;
  const { candles, priceTicks } = candleLayout(history.candles, frame);
  const edge = frame.width - frame.right;
  return s(
    'svg',
    {
      class: 'chart',
      viewBox: `0 0 ${frame.width} ${frame.height}`,
      role: 'img',
      'aria-label': `Daily prices in VG+ terms. ${historySummary(history)}`,
    },
    priceTicks.map((tick) =>
      s(
        'g',
        { class: 'chart-grid' },
        s('line', { x1: frame.left, x2: edge, y1: tick.y, y2: tick.y }),
        s('text', { x: frame.width - 2, y: tick.y + 4, 'text-anchor': 'end' }, dollars(tick.cents)),
      ),
    ),
    candles.map((candle) =>
      s(
        'g',
        { class: candle.up ? 'candle candle-up' : 'candle candle-down' },
        s('line', { x1: candle.x, x2: candle.x, y1: candle.wickTop, y2: candle.wickBottom }),
        s('rect', {
          x: candle.x - candle.width / 2,
          y: candle.bodyTop,
          width: candle.width,
          height: candle.bodyHeight,
        }),
        s('rect', {
          class: 'chart-volume',
          x: candle.x - candle.width / 2,
          y: candle.volumeTop,
          width: candle.width,
          height: frame.volumeBottom - candle.volumeTop,
        }),
      ),
    ),
    s('line', {
      class: 'chart-axis',
      x1: frame.left,
      x2: edge,
      y1: frame.volumeBottom,
      y2: frame.volumeBottom,
    }),
    s(
      'text',
      { class: 'chart-label', x: frame.width - 2, y: frame.volumeTop + 10, 'text-anchor': 'end' },
      'sales',
    ),
    [candles[0], candles.at(-1)].map((candle, i) =>
      s(
        'text',
        {
          class: 'chart-label',
          x: candle.x,
          y: frame.height - 10,
          'text-anchor': i === 0 ? 'start' : 'end',
        },
        shortDay(candle.day),
      ),
    ),
  );
}

function depthChart(book) {
  const frame = DEPTH_FRAME;
  const layout = depthLayout(book, frame);
  const spreadText = book.spread
    ? `Spread $${book.spread.amount} (${Math.round(book.spread.share * 100)}% of the cheapest copy)`
    : 'No spread: one side of the book is empty';
  return s(
    'svg',
    {
      class: 'chart',
      viewBox: `0 0 ${frame.width} ${frame.height}`,
      role: 'img',
      'aria-label': `The book for a ${book.code} copy: ${copies(book.bids.at(-1)?.copies ?? 0)} wanted, ${
        book.asks.at(-1)?.copies ?? 0
      } for sale. ${spreadText}.`,
    },
    s(
      'defs',
      {},
      s(
        'pattern',
        {
          id: 'hatch',
          width: 6,
          height: 6,
          patternUnits: 'userSpaceOnUse',
          patternTransform: 'rotate(45)',
        },
        s('line', { class: 'chart-hatch', x1: 0, y1: 0, x2: 0, y2: 6 }),
      ),
    ),
    s('path', { class: 'depth-bids', d: layout.bidPath }),
    s('path', { class: 'depth-asks', d: layout.askPath, fill: 'url(#hatch)' }),
    s('line', {
      class: 'chart-axis',
      x1: frame.left,
      x2: frame.width - frame.right,
      y1: frame.bottom,
      y2: frame.bottom,
    }),
    s('text', { class: 'chart-label', x: frame.left, y: frame.top }, 'WANTED'),
    s(
      'text',
      { class: 'chart-label', x: frame.width - frame.right, y: frame.top, 'text-anchor': 'end' },
      'FOR SALE',
    ),
    [layout.xMin, (layout.xMin + layout.xMax) / 2, layout.xMax].map((cents, i) =>
      s(
        'text',
        {
          class: 'chart-label',
          x: layout.x(cents),
          y: frame.height - 10,
          'text-anchor': ['start', 'middle', 'end'][i],
        },
        dollars(Math.round(cents)),
      ),
    ),
  );
}

/**
 * @param {{ releaseId: number, signal: AbortSignal }} options
 * @returns {{ element: HTMLElement, refresh: () => void }} refresh when the market changes
 */
export function priceHistorySection({ releaseId, signal }) {
  const body = h('div', { class: 'history-body' });
  const element = h(
    'section',
    { class: 'appraisal history', 'aria-labelledby': 'history-title' },
    h(
      'div',
      { class: 'section-head section-head--small' },
      h('h2', { id: 'history-title' }, 'Price history'),
      h('p', {}, 'Every sale restated as a VG+ copy'),
    ),
    body,
  );

  /** The grade whose book is showing; kept when the data refreshes. */
  let chosen = null;

  /** One grade's book: copies of that grade for sale, and the ads that would take them. */
  function bookPanel(books) {
    const panel = h('div', { class: 'book-panel' });
    const show = () => {
      const book = books.find((candidate) => candidate.grade === chosen);
      replaceChildren(
        panel,
        h(
          'div',
          { class: 'book-grades', role: 'group', 'aria-label': 'Show the book for a grade' },
          books.map((candidate) =>
            h(
              'button',
              {
                type: 'button',
                class: 'price-chip',
                'aria-pressed': String(candidate.grade === chosen),
                onclick: () => {
                  chosen = candidate.grade;
                  show();
                },
              },
              candidate.code,
            ),
          ),
        ),
        depthChart(book),
        h('p', { class: 'statement-books' }, bookSentence(book)),
      );
    };
    show();
    return panel;
  }

  async function refresh() {
    try {
      const { history } = await api.history(releaseId, signal);
      if (signal.aborted) return;
      const books = history.depth;
      if (!books.some((book) => book.grade === chosen)) chosen = busiestGrade(books);
      replaceChildren(
        body,
        h('p', { class: 'statement-books history-summary' }, historySummary(history)),
        history.candles.length ? candleChart(history) : null,
        h('h3', { class: 'history-subhead' }, 'The book'),
        books.length ? bookPanel(books) : h('p', { class: 'room-none' }, 'No open ads.'),
      );
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return;
      replaceChildren(
        body,
        h('p', { class: 'room-none' }, 'The history isn’t available right now.'),
      );
    }
  }

  void refresh();
  return { element, refresh: () => void refresh() };
}
