/**
 * `npm run simulate [-- seeds]`: the same market with no bots, a market maker, a
 * mean-reversion trader, and both, side by side, averaged over many random seeds
 * (Part 19). See simulation.js for the world it simulates.
 */
import { simulateMarket } from './simulation.js';

const seeds = Number(process.argv[2]) || 50;
const setups = [
  ['no bots', { marketMaker: false }],
  ['maker', { marketMaker: true }],
  ['reverter', { marketMaker: false, meanReverter: true }],
  ['both', { marketMaker: true, meanReverter: true }],
];
const results = setups.map(([label, options]) => [
  label,
  Array.from({ length: seeds }, (_, i) => simulateMarket({ seed: i + 1, ...options }).metrics),
]);
const average = (runs, pick) => runs.reduce((sum, m) => sum + pick(m), 0) / runs.length;
const money = (cents) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;

const rows = [
  ['Trades in 120 days', (m) => m.trades, (v) => v.toFixed(1)],
  ['Quoted spread', (m) => m.meanSpread, (v) => `${(v * 100).toFixed(1)}%`],
  ['Days an order waits to fill', (m) => m.meanDaysToFill, (v) => v.toFixed(2)],
  ['Trade price vs true value', (m) => m.trackingError, (v) => `${(v * 100).toFixed(2)}%`],
];

console.log(`A pressing's market over 120 days, averaged over ${seeds} random seeds.\n`);
console.log(''.padEnd(30) + results.map(([label]) => label.padStart(11)).join(''));
for (const [label, pick, show] of rows) {
  console.log(
    label.padEnd(30) + results.map(([, runs]) => show(average(runs, pick)).padStart(11)).join(''),
  );
}
console.log('');
for (const [label, runs] of results) {
  for (const bot of ['maker', 'reverter']) {
    if (!runs[0][bot]) continue;
    const profitable = runs.filter((m) => m[bot].profitCents > 0).length;
    const stock = Math.max(...runs.map((m) => m[bot].maxStock));
    console.log(
      `${label}: the ${bot === 'maker' ? 'market maker' : 'mean-reversion trader'} made ${money(average(runs, (m) => m[bot].profitCents))} on average (profitable in ${profitable} of ${seeds}), holding at most ${stock} copies.`,
    );
  }
}
