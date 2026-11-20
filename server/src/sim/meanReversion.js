/**
 * The mean-reversion trader's rule (Part 19), used by a live bot and the simulation.
 * Spec: docs/parts/part-19-market-makers.md. Tests: meanReversion.test.js.
 *
 * Where the market maker earns the spread by always quoting both sides, this trader bets
 * that a price which strays far from fair value comes back. It measures how far the last
 * sale is from fair value in standard deviations of the market's scatter,
 *     z = ln(last / fair) ÷ σ,
 * and acts only on big moves:
 *   z ≤ −entry   the last sale was well under fair: bid a little above it to buy the dip
 *                (until it holds maxStock copies)
 *   z ≥ +entry   well over fair, and it has stock: ask a little under it, selling the spike
 *   otherwise    with stock in hand, offer it at fair value: the price came back, take
 *                the profit
 * Buying low and selling back near fair value pulls prices towards fair value, which the
 * simulation measures.
 */

export const REVERSION_PARAMS = Object.freeze({
  /** How many standard deviations from fair value count as a big move. */
  entry: 1,
  /** How far past the last sale it bids or asks, to be the one that trades. */
  edge: 0.02,
  /** The most copies it will hold. */
  maxStock: 3,
});

/**
 * @param {{ fairCents: number, lastCents: number, sigma: number, stock: number }} market
 * @param {typeof REVERSION_PARAMS} [params]
 * @returns {{ z: number, bidCents: number | null, askCents: number | null }}
 */
export function reversionOrders({ fairCents, lastCents, sigma, stock }, params = REVERSION_PARAMS) {
  const z = Math.log(lastCents / fairCents) / Math.max(sigma, 0.01);
  const cents = (value) => Math.min(1_000_000, Math.max(100, Math.round(value)));
  if (z <= -params.entry) {
    return {
      z,
      bidCents:
        stock < params.maxStock ? cents(Math.min(lastCents * (1 + params.edge), fairCents)) : null,
      askCents: null,
    };
  }
  if (z >= params.entry) {
    return {
      z,
      bidCents: null,
      askCents: stock > 0 ? cents(Math.max(lastCents * (1 - params.edge), fairCents)) : null,
    };
  }
  return { z, bidCents: null, askCents: stock > 0 ? cents(fairCents) : null };
}
