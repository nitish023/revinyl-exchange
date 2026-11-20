/**
 * `npm run db:simulate [-- days]`: give the demo database months of market history (Part 19),
 * so the index, the price charts and the appraisal have something to show. For each pressing
 * in the database, the market simulation (simulation.js) runs for `days` (default 90); its
 * trades are written in as finished sales between 24 simulated collectors, backdated to the
 * day they happened, exactly as the demo seed writes its sales (insertFinishedSale): copies,
 * filled orders, completed trades with the seller's fee, and ledger journals.
 *
 * Grades are drawn as a record shop would see them (VG 30%, VG+ 40%, NM 25%, Mint 5%) and
 * priced with a 30% step per grade. Collectors are paired so no two trade three times in
 * 30 days, and every copy moves on, so surveillance (Part 17) has nothing to flag. Runs once:
 * a database that already has the collectors is left alone.
 */
import { pathToFileURL } from 'node:url';
import { hashPassword } from '../auth/passwords.js';
import { fitFairValue } from '../analytics/fairValue.js';
import { seededRandom } from '../analytics/stats.js';
import { insertFinishedSale } from '../db/seed.js';
import { withTransaction } from '../db/pool.js';
import { simulateMarket } from './simulation.js';

const DAY_MS = 86_400_000;
const COLLECTORS = 24;
const GRADES = [
  [5, 0.3],
  [6, 0.4],
  [7, 0.25],
  [8, 0.05],
];
const GRADE_STEP = Math.log(1.3);

/** A grade drawn from the shop's mix. */
function drawGrade(random) {
  let roll = random();
  for (const [grade, share] of GRADES) {
    if ((roll -= share) <= 0) return grade;
  }
  return 6;
}

/** A VG+ copy's fair value from the pressing's sales so far, or $20 if it has none. */
async function currentFairCents(client, releaseId, now) {
  const { rows } = await client.query(
    `SELECT id, grade, price_cents, created_at FROM trades
      WHERE release_id = $1 AND status <> 'refunded' ORDER BY id`,
    [releaseId],
  );
  const fit = fitFairValue(
    rows.map((row) => ({
      id: row.id,
      grade: row.grade,
      priceCents: row.price_cents,
      at: row.created_at.getTime(),
    })),
    { now },
  );
  return fit ? fit.grades[5].fairCents : 2000;
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ days?: number, now?: number }} [options]
 * @returns {Promise<{ pressings: number, sales: number } | null>} null if it already ran
 */
export async function simulateHistory(pool, { days = 90, now = Date.now() } = {}) {
  const { rows: existing } = await pool.query(
    `SELECT 1 FROM users WHERE display_name = 'collector01'`,
  );
  if (existing.length) return null;
  const { rows: releases } = await pool.query('SELECT id FROM releases ORDER BY id');
  const passwordHash = await hashPassword('password123');

  return withTransaction(pool, async (client) => {
    const collectors = [];
    for (let i = 1; i <= COLLECTORS; i += 1) {
      const name = `collector${String(i).padStart(2, '0')}`;
      const { rows } = await client.query(
        `INSERT INTO users (email, display_name, password_hash, created_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [`${name}@example.com`, name, passwordHash, new Date(now - (days + 30) * DAY_MS)],
      );
      collectors.push({ id: rows[0].id, cash: 200_000 });
    }

    let sales = 0;
    for (const { id: releaseId } of releases) {
      const random = seededRandom(releaseId);
      // The history has to arrive at today's market, not start there: anchor it so its
      // last couple of weeks average the pressing's fair value now (a VG+ copy).
      const anchor = await currentFairCents(client, releaseId, now);
      const { trades } = simulateMarket({ days, seed: releaseId, startCents: anchor });
      const tail = trades.filter((trade) => trade.day >= days - 14);
      const tailLevel = Math.exp(
        (tail.length ? tail : trades).reduce((sum, t) => sum + Math.log(t.priceCents), 0) /
          Math.max(1, (tail.length ? tail : trades).length),
      );
      const scale = trades.length ? anchor / tailLevel : 1;
      const pairs = new Map(); // "a:b" -> days they traded on
      for (const trade of trades) {
        const at = new Date(
          now - (days - trade.day) * DAY_MS + Math.floor(random() * 20) * 3_600_000,
        );
        if (at.getTime() >= now) continue;
        const grade = drawGrade(random);
        const priceCents = Math.max(
          100,
          Math.round(trade.priceCents * scale * Math.exp(GRADE_STEP * (grade - 6))),
        );
        // Two collectors who haven't traded twice in the last 30 days, the buyer able to pay.
        let seller;
        let buyer;
        for (let tries = 0; tries < 50; tries += 1) {
          seller = collectors[Math.floor(random() * COLLECTORS)];
          buyer = collectors[Math.floor(random() * COLLECTORS)];
          const key = [seller.id, buyer.id].sort((a, b) => a - b).join(':');
          const recent = (pairs.get(key) ?? []).filter((day) => trade.day - day < 30);
          if (seller !== buyer && buyer.cash >= priceCents && recent.length < 2) {
            pairs.set(key, [...recent, trade.day]);
            break;
          }
          seller = null;
        }
        if (!seller) continue;
        const row = await insertFinishedSale(client, {
          releaseId,
          buyerId: buyer.id,
          sellerId: seller.id,
          grade,
          priceCents,
          at,
        });
        buyer.cash -= priceCents;
        seller.cash += priceCents - row.seller_fee_cents;
        sales += 1;
      }
    }
    return { pressings: releases.length, sales };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadConfig } = await import('../config.js');
  const { createPool } = await import('../db/pool.js');
  const days = Number(process.argv[2]) || 90;
  const pool = createPool(loadConfig().DATABASE_URL);
  try {
    const result = await simulateHistory(pool, { days });
    console.log(
      result
        ? `Simulated ${days} days: ${result.sales} sales on ${result.pressings} pressings, between 24 collectors (password password123).`
        : 'The simulated history is already there.',
    );
  } catch (error) {
    console.error(`Simulating history failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
