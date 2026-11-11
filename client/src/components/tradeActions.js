/**
 * The buttons on one trade in the Listening Room's ledger (Part 5, Sauransh). Spec:
 * docs/parts/part-5-trades.md.
 *   seller, awaiting shipment: "Ship it", "Cancel sale"
 *   buyer, shipped:            "It arrived", "Not as described"
 *
 * The ledger (Part 6, pages/room.js) calls this for every row and puts what it returns in
 * the status column. Until Part 5 is built it returns null, so the ledger only shows status.
 *
 * @param {{
 *   trade: { id: number, role: 'buyer' | 'seller', status: string, price: string,
 *     release: { id: number, title: string } },
 *   onDone: (message: string) => void,
 * }} _options onDone: call after a change; the Listening Room reloads
 * @returns {HTMLElement | null}
 */
export function tradeActions(_options) {
  return null;
}
