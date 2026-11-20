/**
 * The market maker's quoting rule (Part 19), used by the live bots and the simulation.
 * Spec: docs/parts/part-19-market-makers.md. Tests: marketMaker.test.js.
 *
 * A market maker stands ready to buy and to sell, earning the gap between the two prices
 * (the spread) for taking the risk of holding records in between. This follows the idea of
 * Avellaneda and Stoikov's model ("High-frequency trading in a limit order book", 2008),
 * adapted to a market where every order is one copy:
 *
 *   reservation price  r = fair × e^(−κ·(q − target))
 *       the price the maker is indifferent at. With more copies than it wants (q above
 *       target) it shades both quotes down, to sell more and buy less; with fewer, up.
 *   spread             δ = fair × (s₀ + c·σ)
 *       wider when prices are more uncertain (σ, the log-price spread of recent sales),
 *       since a wrong price costs more there.
 *   quotes             bid = r − δ/2,  ask = r + δ/2  (whole cents, at least $1, bid < ask)
 */

export const DEFAULT_PARAMS = Object.freeze({
  /** How hard inventory skews the quotes: each copy over target lowers them ~4%. */
  inventoryAversion: 0.04,
  /** Copies the maker likes to hold per grade. */
  targetInventory: 1,
  /** The narrowest spread, as a share of fair value. */
  baseSpread: 0.08,
  /** How much each unit of σ widens it. */
  volatilitySpread: 0.5,
});

/**
 * @param {{ fairCents: number, sigma: number, inventory: number }} market
 *   sigma: the log-price spread of recent sales (Part 13's fit); inventory: copies held
 * @param {typeof DEFAULT_PARAMS} [params]
 * @returns {{ bidCents: number, askCents: number, reservationCents: number, spreadCents: number }}
 */
export function quote({ fairCents, sigma, inventory }, params = DEFAULT_PARAMS) {
  const skew = Math.exp(-params.inventoryAversion * (inventory - params.targetInventory));
  const reservation = fairCents * skew;
  const spread = fairCents * (params.baseSpread + params.volatilitySpread * Math.max(0, sigma));
  let bidCents = Math.max(100, Math.round(reservation - spread / 2));
  let askCents = Math.max(bidCents + 1, Math.round(reservation + spread / 2));
  // Keep inside the order limits.
  askCents = Math.min(askCents, 1_000_000);
  bidCents = Math.min(bidCents, askCents - 1);
  return {
    bidCents,
    askCents,
    reservationCents: Math.round(reservation),
    spreadCents: askCents - bidCents,
  };
}
