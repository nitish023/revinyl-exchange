/**
 * Sealed-bid second-price auctions (Part 16). Spec: docs/parts/part-16-auctions.md.
 * Tests: server/test/auctions.int.test.js. Who wins and what they pay is
 * shared/auctions.js (settleAuction).
 *
 * Money: a sealed bid holds its amount from the bidder's cash (held_cents), exactly like a
 * WANTED ad, so a winner can always pay and nobody can bid the same dollars twice. At the
 * end every hold is released and the winner pays the clearing price into escrow; from there
 * it's an ordinary trade (ship, check, payout less the seller's fee, ledger journals).
 *
 * The result is recorded the way every trade is: as the two orders that met (a filled ask
 * at the reserve for the seller's copy and a filled bid at the winner's sealed amount for its
 * grade) and the trade between them at the clearing price, so the exchange's rules and the
 * Listening Room's ledger need nothing special.
 *
 * Locks, in this order everywhere: the auction row, then wallets in id order, then the
 * copy. Order transactions lock at most one wallet and then a listed copy, never a copy up
 * for auction, so the two can't wait on each other.
 */
import {
  auctionBidSchema,
  formatCents,
  settleAuction,
  startAuctionSchema,
} from '../../../shared/index.js';
import { withTransaction } from '../db/pool.js';
import { AppError, notFound } from '../errors.js';
import { postJournal, tradeJournals } from '../ledger/ledger.js';
import { sellerFeeFor } from '../sellers/sellerRecord.js';

const closed = () => new AppError(409, 'AUCTION_CLOSED', 'That auction has ended.');

/** An auction as the API shows it. Bids are sealed: their count is public, amounts aren't. */
function toAuctionView(row, viewerId) {
  return {
    id: row.id,
    releaseId: row.release_id,
    copy: {
      id: row.copy_id,
      grade: row.grade,
      sleeveGrade: row.sleeve_grade,
      headline: row.headline ?? '',
    },
    seller: { name: row.seller_name },
    mine: row.seller_id === viewerId,
    reserve: formatCents(row.reserve_cents),
    status: row.status,
    endsAt: row.ends_at.toISOString(),
    bids: row.bid_count ?? 0,
    myBid: row.my_bid === null || row.my_bid === undefined ? null : formatCents(row.my_bid),
    price:
      row.trade_price === null || row.trade_price === undefined
        ? null
        : formatCents(row.trade_price),
  };
}

const AUCTION_SELECT = `
  SELECT a.*, c.grade, c.sleeve_grade, c.headline, u.display_name AS seller_name,
         (SELECT count(*) FROM auction_bids b WHERE b.auction_id = a.id) AS bid_count,
         (SELECT b.amount_cents FROM auction_bids b WHERE b.auction_id = a.id AND b.bidder_id = $2) AS my_bid,
         t.price_cents AS trade_price
    FROM auctions a
    JOIN copies c ON c.id = a.copy_id
    JOIN users u ON u.id = a.seller_id
    LEFT JOIN trades t ON t.id = a.trade_id`;

export class AuctionService {
  /** @param {{ pool: import('pg').Pool, live: import('../market/live.js').LiveUpdates }} deps */
  constructor({ pool, live }) {
    this.pool = pool;
    this.live = live;
  }

  /**
   * Put a copy from your crate up for auction.
   * @param {{ id: number }} user
   * @param {unknown} input { copyId, reserve: "20.00", days: 1 | 3 | 7 }
   */
  async start(user, input) {
    const { copyId, reserve, days } = startAuctionSchema.parse(input ?? {});
    const auction = await withTransaction(this.pool, async (client) => {
      const { rows: copies } = await client.query(
        `SELECT id, release_id, status FROM copies
          WHERE id = $1 AND owner_id = $2 AND removed_at IS NULL FOR NO KEY UPDATE`,
        [copyId, user.id],
      );
      if (copies.length === 0) throw notFound('Copy');
      if (copies[0].status !== 'in_crate') {
        const message = 'Only a copy in your crate can go up for auction.';
        throw new AppError(409, 'COPY_NOT_AVAILABLE', message, { copyId: message });
      }
      await client.query(`UPDATE copies SET status = 'in_auction' WHERE id = $1`, [copyId]);
      const { rows } = await client.query(
        `INSERT INTO auctions (seller_id, release_id, copy_id, reserve_cents, ends_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(days => $5)) RETURNING id`,
        [user.id, copies[0].release_id, copyId, reserve, days],
      );
      return rows[0].id;
    });
    const view = await this.get(auction, user.id);
    this.#announce(view.releaseId, (live) =>
      live.notifyUser(user.id, { type: 'auction', auctionId: auction }),
    );
    return view;
  }

  /**
   * Place a sealed bid, or raise yours. The amount is held from your cash until the end.
   * @param {{ id: number }} user
   * @param {number} auctionId
   * @param {unknown} input { amount: "40.00" }
   */
  async bid(user, auctionId, input) {
    const { amount } = auctionBidSchema.parse(input ?? {});
    const releaseId = await withTransaction(this.pool, async (client) => {
      const auction = await lockAuction(client, auctionId);
      if (auction.status !== 'open' || auction.ends_at <= new Date()) throw closed();
      if (auction.seller_id === user.id) {
        throw new AppError(400, 'OWN_AUCTION', 'You can’t bid on your own auction.');
      }
      if (amount < auction.reserve_cents) {
        const message = `The reserve is $${formatCents(auction.reserve_cents)}: bid at least that.`;
        throw new AppError(400, 'BELOW_RESERVE', message, { amount: message });
      }
      const { rows: mine } = await client.query(
        'SELECT amount_cents FROM auction_bids WHERE auction_id = $1 AND bidder_id = $2',
        [auctionId, user.id],
      );
      const previous = mine[0]?.amount_cents ?? 0;
      if (amount <= previous) {
        const message = `Your bid is already $${formatCents(previous)}: a new one must be higher.`;
        throw new AppError(400, 'BID_NOT_HIGHER', message, { amount: message });
      }
      const { rows: wallets } = await client.query(
        'SELECT cash_cents, held_cents FROM users WHERE id = $1 FOR NO KEY UPDATE',
        [user.id],
      );
      // Raising a bid holds only the difference: the old amount is already held.
      const spendable = wallets[0].cash_cents - wallets[0].held_cents + previous;
      if (spendable < amount) {
        const message = `This bid needs $${formatCents(amount)} held, and you have $${formatCents(spendable)} to spend.`;
        throw new AppError(400, 'INSUFFICIENT_FUNDS', message, { amount: message });
      }
      await client.query('UPDATE users SET held_cents = held_cents + $2 WHERE id = $1', [
        user.id,
        amount - previous,
      ]);
      await client.query(
        `INSERT INTO auction_bids (auction_id, bidder_id, amount_cents) VALUES ($1, $2, $3)
         ON CONFLICT (auction_id, bidder_id)
         DO UPDATE SET amount_cents = EXCLUDED.amount_cents, updated_at = now()`,
        [auctionId, user.id, amount],
      );
      return auction.release_id;
    });
    this.#announce(releaseId, (live) => live.notifyUser(user.id, { type: 'wallet', releaseId }));
    return this.get(auctionId, user.id);
  }

  /** The seller takes an auction down, while nobody has bid. The copy goes back to the crate. */
  async cancel(user, auctionId) {
    const releaseId = await withTransaction(this.pool, async (client) => {
      const auction = await lockAuction(client, auctionId);
      if (auction.seller_id !== user.id) throw notFound('Auction');
      if (auction.status !== 'open') throw closed();
      const { rows } = await client.query('SELECT 1 FROM auction_bids WHERE auction_id = $1', [
        auctionId,
      ]);
      if (rows.length > 0) {
        throw new AppError(
          409,
          'AUCTION_HAS_BIDS',
          'Someone has bid, so the auction must run its course.',
        );
      }
      await client.query(
        `UPDATE auctions SET status = 'cancelled', closed_at = now() WHERE id = $1`,
        [auctionId],
      );
      await client.query(`UPDATE copies SET status = 'in_crate' WHERE id = $1`, [auction.copy_id]);
      return auction.release_id;
    });
    this.#announce(releaseId, () => {});
    return this.get(auctionId, user.id);
  }

  /**
   * Settle every auction whose time is up. The server runs it with the expiry sweep, once a
   * minute; settling is idempotent, so two processes doing it at once is fine.
   * @returns {Promise<number>} how many settled
   */
  async settleDue() {
    const { rows } = await this.pool.query(
      `SELECT id FROM auctions WHERE status = 'open' AND ends_at <= now() ORDER BY ends_at, id`,
    );
    let settled = 0;
    for (const { id } of rows) if (await this.settle(id)) settled += 1;
    return settled;
  }

  /**
   * Settle one ended auction: release every hold, and if a bid met the reserve, the winner
   * pays the clearing price into escrow and a trade awaiting shipment is made.
   * @returns {Promise<boolean>} false if it wasn't due (or was already settled)
   */
  async settle(auctionId) {
    const outcome = await withTransaction(this.pool, async (client) => {
      const auction = await lockAuction(client, auctionId);
      if (auction.status !== 'open' || auction.ends_at > new Date()) return null;
      const { rows: bids } = await client.query(
        `SELECT * FROM auction_bids WHERE auction_id = $1 AND status = 'active' ORDER BY id`,
        [auctionId],
      );
      const people = [...new Set([auction.seller_id, ...bids.map((b) => b.bidder_id)])].sort(
        (a, b) => a - b,
      );
      await client.query(
        'SELECT id FROM users WHERE id = ANY($1::bigint[]) ORDER BY id FOR NO KEY UPDATE',
        [people],
      );
      for (const bid of bids) {
        await client.query('UPDATE users SET held_cents = held_cents - $2 WHERE id = $1', [
          bid.bidder_id,
          bid.amount_cents,
        ]);
      }
      const result = settleAuction(
        bids.map((bid) => ({
          id: bid.id,
          bidderId: bid.bidder_id,
          amountCents: bid.amount_cents,
          at: bid.created_at.getTime(),
        })),
        auction.reserve_cents,
      );
      if (!result) {
        await client.query(
          `UPDATE auctions SET status = 'unsold', closed_at = now() WHERE id = $1`,
          [auctionId],
        );
        await client.query(`UPDATE auction_bids SET status = 'lost' WHERE auction_id = $1`, [
          auctionId,
        ]);
        await client.query(`UPDATE copies SET status = 'in_crate' WHERE id = $1`, [
          auction.copy_id,
        ]);
        return { auction, bids, trade: null };
      }
      await client.query(
        `UPDATE auction_bids SET status = CASE WHEN id = $2 THEN 'won' ELSE 'lost' END
          WHERE auction_id = $1`,
        [auctionId, result.winner.id],
      );
      const { rows: copies } = await client.query(
        `UPDATE copies SET status = 'in_trade' WHERE id = $1 AND status = 'in_auction'
         RETURNING grade`,
        [auction.copy_id],
      );
      if (copies.length !== 1)
        throw new Error(`Copy ${auction.copy_id} of auction ${auctionId} isn't up for auction`);
      const grade = copies[0].grade;
      // The two orders that met: the seller's at the reserve, the winner's at their bid.
      const { rows: asks } = await client.query(
        `INSERT INTO orders (user_id, release_id, side, price_cents, copy_id, status, closed_at)
         VALUES ($1, $2, 'ask', $3, $4, 'filled', now()) RETURNING id`,
        [auction.seller_id, auction.release_id, auction.reserve_cents, auction.copy_id],
      );
      const { rows: bidOrders } = await client.query(
        `INSERT INTO orders (user_id, release_id, side, price_cents, min_grade, status, closed_at)
         VALUES ($1, $2, 'bid', $3, $4, 'filled', now()) RETURNING id`,
        [result.winner.bidderId, auction.release_id, result.winner.amountCents, grade],
      );
      const { rows: trades } = await client.query(
        `INSERT INTO trades (release_id, copy_id, grade, price_cents, bid_order_id, ask_order_id,
                             buyer_id, seller_id, seller_fee_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          auction.release_id,
          auction.copy_id,
          grade,
          result.priceCents,
          bidOrders[0].id,
          asks[0].id,
          result.winner.bidderId,
          auction.seller_id,
          await sellerFeeFor(client, auction.seller_id, result.priceCents),
        ],
      );
      await postJournal(client, tradeJournals.payment(trades[0]));
      await client.query(
        `UPDATE auctions SET status = 'sold', closed_at = now(), trade_id = $2 WHERE id = $1`,
        [auctionId, trades[0].id],
      );
      return { auction, bids, trade: trades[0] };
    });
    if (!outcome) return false;

    const { auction, bids, trade } = outcome;
    this.#announce(auction.release_id, (live) => {
      const releaseId = auction.release_id;
      for (const bid of bids) live.notifyUser(bid.bidder_id, { type: 'wallet', releaseId });
      for (const userId of [auction.seller_id, ...bids.map((bid) => bid.bidder_id)]) {
        live.notifyUser(userId, { type: 'auction', releaseId, auctionId: auction.id });
      }
      if (trade) {
        for (const userId of [trade.buyer_id, trade.seller_id]) {
          live.notifyUser(userId, {
            type: 'trade',
            releaseId,
            tradeId: trade.id,
            status: trade.status,
          });
        }
      }
    });
    return true;
  }

  /** One auction, as `viewerId` sees it. */
  async get(auctionId, viewerId = null) {
    const { rows } = await this.pool.query(`${AUCTION_SELECT} WHERE a.id = $1`, [
      auctionId,
      viewerId,
    ]);
    if (rows.length === 0) throw notFound('Auction');
    return toAuctionView(rows[0], viewerId);
  }

  /**
   * A pressing's open auctions, ending soonest first, and its last few results.
   * @param {number} releaseId
   * @param {number | null} viewerId
   */
  async forRelease(releaseId, viewerId = null) {
    const [open, done] = await Promise.all([
      this.pool.query(
        `${AUCTION_SELECT} WHERE a.release_id = $1 AND a.status = 'open' ORDER BY a.ends_at, a.id`,
        [releaseId, viewerId],
      ),
      this.pool.query(
        `${AUCTION_SELECT} WHERE a.release_id = $1 AND a.status IN ('sold', 'unsold')
          ORDER BY a.closed_at DESC, a.id DESC LIMIT 5`,
        [releaseId, viewerId],
      ),
    ]);
    return {
      open: open.rows.map((row) => toAuctionView(row, viewerId)),
      results: done.rows.map((row) => toAuctionView(row, viewerId)),
    };
  }

  /** Tell browsers; the change is saved, so a live-update failure must not fail it. */
  #announce(releaseId, notify) {
    try {
      this.live.marketChanged(releaseId);
      notify(this.live);
    } catch (error) {
      console.error('[auctions] live update failed:', error);
    }
  }
}

/** Lock an auction row, or 404. */
async function lockAuction(client, auctionId) {
  const { rows } = await client.query('SELECT * FROM auctions WHERE id = $1 FOR NO KEY UPDATE', [
    auctionId,
  ]);
  if (rows.length === 0) throw notFound('Auction');
  return rows[0];
}
