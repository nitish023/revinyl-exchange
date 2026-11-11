/**
 * The buttons on one ad in the classifieds (Part 5, Sauransh): "Buy this copy" on a FOR SALE
 * ad, "Sell to them" on a WANTED ad, or a "Log in to buy" link when logged out. Spec:
 * docs/parts/part-5-trades.md.
 *
 * The market section (Part 4, components/market.js) calls this for every ad that isn't
 * yours and puts what it returns next to the ad's price. Until Part 5 is built it returns
 * null, so the ads show no buttons.
 *
 * @param {{
 *   release: { id: number, title: string, artist: string },
 *   ad: import('../../../shared/market.js').MarketAd | import('../../../shared/market.js').WantedAd,
 *   kind: 'forSale' | 'wanted',
 *   user: { id: number, displayName: string } | null,
 *   mine: boolean,
 *   onDone: (message: string) => void,
 * }} _options
 * @returns {HTMLElement | null}
 */
export function adActions(_options) {
  return null;
}
