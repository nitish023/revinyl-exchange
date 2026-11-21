/**
 * The reVINYL 30 and portfolios as the API sends them (Part 18). The arithmetic is in
 * marketIndex.js and portfolio.js; fair values and clean sales come from the pricing service.
 */
import { formatCents, gradeByRank } from '../../../shared/index.js';
import { buildIndex, INDEX_SIZE, REBALANCE_DAYS } from './marketIndex.js';
import { buildPortfolio } from './portfolio.js';

const DAY_MS = 86_400_000;
const money = (cents) => (cents === null || cents === undefined ? null : formatCents(cents));

async function releasesById(db, ids) {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query(
    'SELECT id, title, artist, thumb_url FROM releases WHERE id = ANY($1::bigint[])',
    [ids],
  );
  return new Map(
    rows.map((row) => [
      row.id,
      { id: row.id, title: row.title, artist: row.artist, thumbUrl: row.thumb_url },
    ]),
  );
}

/**
 * The reVINYL 30: its level over the last 90 days, today's members and weights.
 * @param {import('../context.js').AppContext} ctx
 * @param {number} [now]
 */
export async function loadMarketIndex(ctx, now = Date.now()) {
  const index = buildIndex(await ctx.pricing.vgPlusSales(), { now });
  const releases = await releasesById(
    ctx.pool,
    index.members.map((member) => member.releaseId),
  );
  const level = index.series.at(-1)?.level ?? null;
  const monthAgo = index.series.at(-31)?.level ?? index.series[0]?.level ?? null;
  return {
    level: level === null ? null : Math.round(level * 100) / 100,
    change30: level === null || !monthAgo ? null : level / monthAgo - 1,
    series: index.series.map((point) => ({
      day: point.day,
      level: Math.round(point.level * 100) / 100,
    })),
    members: index.members.map((member) => ({
      release: releases.get(member.releaseId) ?? { id: member.releaseId },
      weight: member.weight,
      price: money(member.priceCents),
    })),
    size: INDEX_SIZE,
    rebalanceDays: REBALANCE_DAYS,
    rebalancedOn: index.rebalancedOn,
  };
}

/**
 * A trader's portfolio: holdings at fair value with cost basis, realized gains, totals.
 * @param {import('../context.js').AppContext} ctx
 * @param {number} userId
 */
export async function loadPortfolio(ctx, userId) {
  const [wallet, owned, incoming, sold] = await Promise.all([
    ctx.pool.query('SELECT cash_cents FROM users WHERE id = $1', [userId]),
    // My copies, each with what I paid for it if I bought it here (the latest purchase).
    ctx.pool.query(
      `SELECT c.id, c.release_id, c.grade, c.status,
              (SELECT t.price_cents FROM trades t
                WHERE t.copy_id = c.id AND t.buyer_id = $1 AND t.status = 'completed'
                ORDER BY t.settled_at DESC, t.id DESC LIMIT 1) AS cost
         FROM copies c
        WHERE c.owner_id = $1 AND c.removed_at IS NULL`,
      [userId],
    ),
    // Copies I've bought that are on their way: paid for, not mine yet.
    ctx.pool.query(
      `SELECT copy_id, release_id, grade, price_cents FROM trades
        WHERE buyer_id = $1 AND status IN ('awaiting_shipment', 'shipped')`,
      [userId],
    ),
    // My completed sales, each with what I'd paid for that copy if I bought it here first.
    ctx.pool.query(
      `SELECT t.id, t.release_id, t.grade, t.price_cents - t.seller_fee_cents AS proceeds,
              t.settled_at, bought.price_cents AS cost, bought.settled_at AS bought_at
         FROM trades t
         LEFT JOIN LATERAL (
           SELECT b.price_cents, b.settled_at FROM trades b
            WHERE b.copy_id = t.copy_id AND b.buyer_id = $1 AND b.status = 'completed'
              AND b.settled_at < t.settled_at
            ORDER BY b.settled_at DESC, b.id DESC LIMIT 1) bought ON true
        WHERE t.seller_id = $1 AND t.status = 'completed'
        ORDER BY t.settled_at DESC, t.id DESC
        LIMIT 100`,
      [userId],
    ),
  ]);

  const holdings = [
    ...owned.rows.map((row) => ({
      copyId: row.id,
      releaseId: row.release_id,
      grade: row.grade,
      status: row.status,
      costCents: row.cost,
    })),
    ...incoming.rows.map((row) => ({
      copyId: row.copy_id,
      releaseId: row.release_id,
      grade: row.grade,
      status: 'on_its_way',
      costCents: row.price_cents,
    })),
  ];
  const sales = sold.rows.map((row) => ({
    tradeId: row.id,
    releaseId: row.release_id,
    grade: row.grade,
    proceedsCents: row.proceeds,
    costCents: row.cost,
    heldDays: row.cost === null ? null : Math.round((row.settled_at - row.bought_at) / DAY_MS),
  }));
  const releaseIds = [...new Set([...holdings, ...sales].map((item) => item.releaseId))];
  const [fits, releases] = await Promise.all([
    ctx.pricing.fairValues(releaseIds),
    releasesById(ctx.pool, releaseIds),
  ]);
  const fairValue = (releaseId, grade) => fits.get(releaseId)?.grades[grade - 1].fairCents ?? null;
  const portfolio = buildPortfolio({
    holdings,
    sales,
    cashCents: wallet.rows[0].cash_cents,
    fairValue,
  });

  const withRelease = (item) => ({
    release: releases.get(item.releaseId) ?? { id: item.releaseId },
    grade: item.grade,
    code: gradeByRank(item.grade).code,
  });
  const { totals } = portfolio;
  return {
    holdings: portfolio.holdings.map((h) => ({
      ...withRelease(h),
      copyId: h.copyId,
      status: h.status,
      cost: money(h.costCents),
      fair: money(h.fairCents),
      unrealized: money(h.unrealizedCents),
    })),
    realized: portfolio.realized.map((s) => ({
      ...withRelease(s),
      tradeId: s.tradeId,
      proceeds: money(s.proceedsCents),
      cost: money(s.costCents),
      gain: money(s.gainCents),
      heldDays: s.heldDays,
    })),
    totals: {
      cash: money(totals.cashCents),
      holdings: money(totals.holdingsCents),
      netWorth: money(totals.netWorthCents),
      unrealized: money(totals.unrealizedCents),
      realized: money(totals.realizedCents),
      invested: money(totals.investedCents),
      returnShare: totals.returnShare,
      unpriced: totals.unpriced,
    },
  };
}
