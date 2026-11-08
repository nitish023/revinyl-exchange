/**
 * The clip-out forms at the bottom of a pressing's classifieds (Part 3, Sauransh):
 *   - "Add a copy to your crate" (grade, sleeve grade, condition flags, headline, notes)
 *   - "Sell your copy" (pick one of your copies of this pressing, set a price)
 *   - "Run your own ad" (a WANTED ad: lowest grade you'll take, most you'll pay, a note)
 * Logged out, it's one coupon that says to log in.
 *
 * The market section (Part 4, client/src/components/market.js) already calls this and
 * puts whatever it returns under the ads. Until Part 3 is built it returns null, and the
 * market page simply shows no forms.
 *
 * @param {{
 *   release: { id: number, title: string, artist: string },
 *   user: { id: number, displayName: string } | null,
 *   onPosted: () => void,
 * }} _options onPosted: call after an order is placed or cancelled; the market reloads
 *   your own ads (everyone else's tabs update over the WebSocket by themselves)
 * @returns {HTMLElement | null}
 */
export function adCoupons(_options) {
  return null;
}
