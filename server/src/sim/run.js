/**
 * `npm run simulate [-- seeds]`: the market with and without a market maker, side by side,
 * averaged over many random seeds (Part 19). See simulation.js for the world it simulates.
 */
import { simulateMarket } from './simulation.js';

const seeds = Number(process.argv[2]) || 50;
const runs = (marketMaker) =>
  Array.from({ length: seeds }, (_, i) => simulateMarket({ seed: i + 1, marketMaker }).metrics);
const average = (list, pick) => list.reduce((sum, m) => sum + pick(m), 0) / list.length;

const without = runs(false);
const withMaker = runs(true);
const rows = [
  ['Trades in 120 days', (m) => m.trades, (v) => v.toFixed(1)],
  ['Quoted spread', (m) => m.meanSpread, (v) => `${(v * 100).toFixed(1)}%`],
  ['Days an order waits to fill', (m) => m.meanDaysToFill, (v) => v.toFixed(2)],
  ['Trade price vs true value', (m) => m.trackingError, (v) => `${(v * 100).toFixed(1)}%`],
];

console.log(`A pressing's market over 120 days, averaged over ${seeds} random seeds.\n`);
console.log(`${''.padEnd(30)}${'without'.padStart(10)}${'with a maker'.padStart(15)}`);
for (const [label, pick, show] of rows) {
  console.log(
    `${label.padEnd(30)}${show(average(without, pick)).padStart(10)}${show(average(withMaker, pick)).padStart(15)}`,
  );
}
const profit = average(withMaker, (m) => m.maker.profitCents) / 100;
const profitable = withMaker.filter((m) => m.maker.profitCents > 0).length;
const stock = Math.max(...withMaker.map((m) => m.maker.maxStock));
console.log(
  `\nThe market maker made $${profit.toFixed(2)} on average (profitable in ${profitable} of ${seeds}), never holding more than ${stock} copies.`,
);
