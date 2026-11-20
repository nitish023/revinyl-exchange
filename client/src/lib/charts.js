/**
 * The geometry of the price history and depth charts (Part 14): scales, tick marks and the
 * shapes, as plain numbers and SVG path strings, so they can be tested without drawing.
 * components/priceHistory.js turns them into SVG.
 */
import { parseDollars } from '../../../shared/index.js';

const DAY_MS = 86_400_000;

/**
 * "Nice" round tick values covering [min, max]: steps of 1, 2 or 5 times a power of ten.
 * @returns {number[]}
 */
export function niceTicks(min, max, count = 4) {
  if (!(max > min)) return [min];
  const rough = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((candidate) => candidate >= rough);
  const ticks = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + step * 1e-9; tick += step) {
    ticks.push(Number(tick.toFixed(10)));
  }
  return ticks;
}

/** A linear scale from [d0, d1] onto [r0, r1]. */
export const scale = (d0, d1, r0, r1) => (value) =>
  d1 === d0 ? (r0 + r1) / 2 : r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);

const cents = (price) => parseDollars(price);
const dayMs = (day) => Date.parse(`${day}T00:00:00Z`);

/** The candle chart's frame. */
export const CANDLE_FRAME = Object.freeze({
  width: 720,
  height: 300,
  left: 8,
  right: 80,
  top: 14,
  priceBottom: 214,
  volumeTop: 228,
  volumeBottom: 270,
});

/**
 * Where each candle goes, on a time axis (so gaps between trading days show as gaps).
 * @param {{ day: string, open: string, high: string, low: string, close: string, sales: number }[]} candles
 */
export function candleLayout(candles, frame = CANDLE_FRAME) {
  const first = dayMs(candles[0].day);
  const last = dayMs(candles.at(-1).day);
  const spanDays = Math.max(1, (last - first) / DAY_MS);
  const plotWidth = frame.width - frame.left - frame.right;
  const slot = plotWidth / (spanDays + 1);
  const candleWidth = Math.max(3, Math.min(16, slot * 0.6));
  const lows = candles.map((c) => cents(c.low));
  const highs = candles.map((c) => cents(c.high));
  const pad = Math.max(50, (Math.max(...highs) - Math.min(...lows)) * 0.08);
  const priceMin = Math.max(0, Math.min(...lows) - pad);
  const priceMax = Math.max(...highs) + pad;
  const y = scale(priceMin, priceMax, frame.priceBottom, frame.top);
  const x = (day) => frame.left + slot / 2 + ((dayMs(day) - first) / DAY_MS) * slot;
  const maxSales = Math.max(...candles.map((c) => c.sales));
  const volume = scale(0, maxSales, frame.volumeBottom, frame.volumeTop);
  return {
    candles: candles.map((candle) => {
      const [open, close] = [cents(candle.open), cents(candle.close)];
      const top = y(Math.max(open, close));
      return {
        day: candle.day,
        x: x(candle.day),
        width: candleWidth,
        wickTop: y(cents(candle.high)),
        wickBottom: y(cents(candle.low)),
        bodyTop: top,
        bodyHeight: Math.max(1.5, y(Math.min(open, close)) - top),
        up: close >= open,
        volumeTop: volume(candle.sales),
      };
    }),
    priceTicks: niceTicks(priceMin, priceMax).map((tickCents) => ({
      cents: tickCents,
      y: y(tickCents),
    })),
  };
}

/** The depth chart's frame. */
export const DEPTH_FRAME = Object.freeze({
  width: 720,
  height: 220,
  left: 8,
  right: 8,
  top: 20,
  bottom: 188,
});

/**
 * The two staircases as SVG paths. Bids step down from the best bid towards cheaper prices
 * (copies wanted at that price or more); asks step up from the best ask towards dearer ones.
 * @param {{ bids: { price: string, copies: number }[], asks: { price: string, copies: number }[] }} book
 * @returns {null | { bidPath: string, askPath: string, xMin: number, xMax: number,
 *   maxCopies: number, x: (cents: number) => number }}
 */
export function depthLayout(book, frame = DEPTH_FRAME) {
  const bids = book.bids.map((step) => ({ cents: cents(step.price), copies: step.copies }));
  const asks = book.asks.map((step) => ({ cents: cents(step.price), copies: step.copies }));
  const all = [...bids, ...asks];
  if (all.length === 0) return null;
  const lowest = Math.min(...all.map((s) => s.cents));
  const highest = Math.max(...all.map((s) => s.cents));
  const pad = Math.max(100, (highest - lowest) * 0.1);
  const xMin = Math.max(0, lowest - pad);
  const xMax = highest + pad;
  const maxCopies = Math.max(...all.map((s) => s.copies));
  const x = scale(xMin, xMax, frame.left, frame.width - frame.right);
  const y = scale(0, maxCopies * 1.15, frame.bottom, frame.top);
  const f = (n) => n.toFixed(1);

  // From the best price outwards: rise to each step's copies, then run to the next price.
  const staircase = (steps, edge) => {
    if (steps.length === 0) return '';
    let path = `M${f(x(steps[0].cents))},${f(y(0))}`;
    steps.forEach((step, i) => {
      path += ` V${f(y(step.copies))}`;
      const next = steps[i + 1];
      path += ` H${f(next ? x(next.cents) : edge)}`;
    });
    return `${path} V${f(y(0))} Z`;
  };
  return {
    bidPath: staircase(bids, frame.left),
    askPath: staircase(asks, frame.width - frame.right),
    xMin,
    xMax,
    maxCopies,
    x,
  };
}

/** The grade whose book has the most ads (the best grade on a tie): the one to show first. */
export function busiestGrade(books) {
  const size = (book) => (book.bids.at(-1)?.copies ?? 0) + (book.asks.at(-1)?.copies ?? 0);
  return (
    books.reduce((best, book) => (size(book) >= size(best) ? book : best), books[0])?.grade ?? null
  );
}

/** What one grade's book says, in a sentence under its chart. */
export function bookSentence(book) {
  const forSale = book.asks.at(-1)?.copies ?? 0;
  const wanted = book.bids.at(-1)?.copies ?? 0;
  const counts = `${forSale} ${book.code} ${forSale === 1 ? 'copy' : 'copies'} for sale; ${wanted} wanted ${
    wanted === 1 ? 'ad takes' : 'ads take'
  } that grade.`;
  if (!book.spread) return `${counts} One side is empty, so there’s no spread.`;
  return `${counts} Best wanted ad $${book.spread.bid}, cheapest copy $${book.spread.ask}: a spread of $${book.spread.amount}.`;
}

/** "Nov 20" for a candle's day. */
export const shortDay = (day) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );

/** "+12%" or "−8%" for a fraction. */
export const signedPercent = (fraction) =>
  `${fraction >= 0 ? '+' : '−'}${Math.abs(Math.round(fraction * 100))}%`;

/**
 * The line over the chart, and the sentence a screen reader hears instead of it.
 * @param {{ candles: object[], stats: object }} history
 */
export function historySummary({ candles, stats }) {
  if (candles.length === 0) return 'No sales yet, so no price history.';
  const parts = [`Last sale $${stats.lastClose} in VG+ terms`];
  if (stats.change30 !== null) parts.push(`${signedPercent(stats.change30)} over 30 days`);
  if (stats.monthlyVolatility !== null) {
    parts.push(`volatility ±${Math.round(stats.monthlyVolatility * 100)}% a month`);
  }
  parts.push(`52-week range $${stats.low52} to $${stats.high52}`);
  return `${parts.join(' · ')}.`;
}
