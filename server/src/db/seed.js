/**
 * Demo data, so the market page has something on it before anyone has traded.
 *
 *   npm run db:seed                  # the fixture pressing (Rick Astley, 7", release 249504)
 *   npm run db:seed -- 1234 5678     # also these Discogs releases (needs DISCOGS_TOKEN)
 *
 * Creates five demo traders (password "password123") and, for each pressing, a month of
 * finished sales, copies for sale in a few grades and some wanted ads. Everything follows
 * the rules the real code keeps: a listed copy has exactly one open ask, held cash equals
 * the open bids, no open bid could match an open ask, and money only moves between users.
 * Running it again adds nothing for a pressing that already has demo data.
 */
import { pathToFileURL } from 'node:url';
import { hashPassword } from '../auth/passwords.js';
import { mapRelease } from '../catalog/discogsMapping.js';
import releaseFixture from '../catalog/fixtures/release-249504.json' with { type: 'json' };
import { upsertRelease } from '../catalog/releasesRepo.js';
import { withTransaction } from './pool.js';

export const DEMO_PASSWORD = 'password123';
export const DEMO_TRADERS = [
  'groovegarden',
  'paperlantern',
  'secondspin',
  'latenight',
  'harbormaster',
];
export const FIXTURE_RELEASE_ID = releaseFixture.id;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Prices in whole dollars, so the demo reads like real ads. */
const dollars = (base, factor) => Math.max(1, Math.round((base * factor) / 100)) * 100;

/** A believable starting price for a pressing, in cents. Fixed per release so reruns match. */
const basePrice = (releaseId) => 2_000 + (releaseId % 23) * 150;

/**
 * What one pressing's demo market looks like. Seller/buyer are indexes into DEMO_TRADERS.
 * Grades: 8 M, 7 NM, 6 VG+, 5 VG, 4 G+.
 */
function planFor(releaseId, now) {
  const base = basePrice(releaseId);
  const ago = (days, hours = 0) => new Date(now - days * DAY_MS - hours * HOUR_MS);
  return {
    sales: [
      { seller: 0, buyer: 1, grade: 6, sleeve: 6, price: dollars(base, 0.85), at: ago(27) },
      { seller: 2, buyer: 3, grade: 7, sleeve: 6, price: dollars(base, 1.05), at: ago(21) },
      { seller: 4, buyer: 0, grade: 5, sleeve: 5, price: dollars(base, 0.5), at: ago(16) },
      { seller: 1, buyer: 2, grade: 6, sleeve: null, price: dollars(base, 0.9), at: ago(9) },
      { seller: 3, buyer: 4, grade: 7, sleeve: 7, price: dollars(base, 1.1), at: ago(4) },
      { seller: 0, buyer: 3, grade: 6, sleeve: 5, price: dollars(base, 0.95), at: ago(1, 5) },
    ],
    forSale: [
      {
        seller: 2,
        grade: 7,
        sleeve: 7,
        price: dollars(base, 1.2),
        headline: 'Played twice.',
        notes: 'Stored upright in an anti-static inner sleeve. Quiet all the way through.',
        flags: [],
        at: ago(6),
      },
      {
        seller: 4,
        grade: 6,
        sleeve: 6,
        price: dollars(base, 1),
        headline: 'Plays clean.',
        notes: 'Light hairlines you can see under a lamp, silent when playing.',
        flags: [],
        at: ago(5),
      },
      {
        seller: 1,
        grade: 6,
        sleeve: 5,
        price: dollars(base, 1.05),
        headline: 'Original inner sleeve.',
        notes: 'Some corner wear on the jacket and a small split along the bottom seam.',
        flags: ['seam_split'],
        at: ago(3),
      },
      {
        seller: 3,
        grade: 5,
        sleeve: null,
        price: dollars(base, 0.6),
        headline: 'Honest copy.',
        notes: 'Some crackle in the quiet intro, then it settles. Name written on the label.',
        flags: ['label_writing'],
        at: ago(2),
      },
      {
        seller: 0,
        grade: 4,
        sleeve: 4,
        price: dollars(base, 0.35),
        headline: 'For listening, not the shelf.',
        notes: 'Noisy between tracks and a slight warp that doesn’t affect play.',
        flags: ['warp', 'groove_wear'],
        at: ago(1),
      },
    ],
    // Each bid is below every ask its grade would accept, so nothing here would match.
    wanted: [
      {
        buyer: 3,
        minGrade: 7,
        price: dollars(base, 1.1),
        note: 'Clean copy for a listening room.',
        at: ago(4),
      },
      {
        buyer: 2,
        minGrade: 6,
        price: dollars(base, 0.85),
        note: 'Sleeve wear is fine if it plays clean.',
        at: ago(2),
      },
      { buyer: 4, minGrade: 5, price: dollars(base, 0.5), note: '', at: ago(0, 7) },
    ],
  };
}

async function ensureTraders(client) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const ids = [];
  for (const name of DEMO_TRADERS) {
    const { rows } = await client.query(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [`${name}@example.com`, name, passwordHash],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

async function insertCopy(
  client,
  { ownerId, releaseId, grade, sleeve, flags = [], headline = '', notes = '', status, at },
) {
  const { rows } = await client.query(
    `INSERT INTO copies (owner_id, release_id, grade, sleeve_grade, flags, headline, notes, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [ownerId, releaseId, grade, sleeve, flags, headline, notes, status, at],
  );
  return rows[0].id;
}

async function insertOrder(client, order) {
  const { rows } = await client.query(
    `INSERT INTO orders (user_id, release_id, side, price_cents, min_grade, copy_id, note, status,
                         created_at, closed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      order.userId,
      order.releaseId,
      order.side,
      order.price,
      order.minGrade ?? null,
      order.copyId ?? null,
      order.note ?? '',
      order.status,
      order.at,
      order.status === 'open' ? null : order.at,
    ],
  );
  return rows[0].id;
}

async function seedRelease(client, releaseId, traders, now) {
  const { rows } = await client.query(
    'SELECT 1 FROM copies WHERE release_id = $1 AND owner_id = ANY($2) LIMIT 1',
    [releaseId, traders],
  );
  if (rows.length) return false;

  const plan = planFor(releaseId, now);

  // Finished sales: the copy now belongs to the buyer, and the money has moved.
  for (const sale of plan.sales) {
    const buyerId = traders[sale.buyer];
    const sellerId = traders[sale.seller];
    const listedAt = new Date(sale.at.getTime() - 2 * DAY_MS);
    const copyId = await insertCopy(client, {
      ownerId: buyerId,
      releaseId,
      grade: sale.grade,
      sleeve: sale.sleeve,
      status: 'in_crate',
      at: listedAt,
    });
    const askId = await insertOrder(client, {
      userId: sellerId,
      releaseId,
      side: 'ask',
      price: sale.price,
      copyId,
      status: 'filled',
      at: listedAt,
    });
    const bidId = await insertOrder(client, {
      userId: buyerId,
      releaseId,
      side: 'bid',
      price: sale.price,
      minGrade: sale.grade,
      status: 'filled',
      at: sale.at,
    });
    await client.query(
      `INSERT INTO trades (release_id, copy_id, grade, price_cents, bid_order_id, ask_order_id,
                           buyer_id, seller_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9, $9)`,
      [releaseId, copyId, sale.grade, sale.price, bidId, askId, buyerId, sellerId, sale.at],
    );
    await client.query('UPDATE users SET cash_cents = cash_cents - $2 WHERE id = $1', [
      buyerId,
      sale.price,
    ]);
    await client.query('UPDATE users SET cash_cents = cash_cents + $2 WHERE id = $1', [
      sellerId,
      sale.price,
    ]);
  }

  // Copies for sale: listed, with one open ask each.
  for (const ad of plan.forSale) {
    const ownerId = traders[ad.seller];
    const copyId = await insertCopy(client, {
      ownerId,
      releaseId,
      grade: ad.grade,
      sleeve: ad.sleeve,
      flags: ad.flags,
      headline: ad.headline,
      notes: ad.notes,
      status: 'listed',
      at: ad.at,
    });
    await insertOrder(client, {
      userId: ownerId,
      releaseId,
      side: 'ask',
      price: ad.price,
      copyId,
      status: 'open',
      at: ad.at,
    });
  }

  // Wanted ads: the buyer's money is held while the ad runs.
  for (const ad of plan.wanted) {
    const userId = traders[ad.buyer];
    await insertOrder(client, {
      userId,
      releaseId,
      side: 'bid',
      price: ad.price,
      minGrade: ad.minGrade,
      note: ad.note,
      status: 'open',
      at: ad.at,
    });
    await client.query('UPDATE users SET held_cents = held_cents + $2 WHERE id = $1', [
      userId,
      ad.price,
    ]);
  }
  return true;
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ releaseIds?: number[], now?: number, ensureRelease?: (id: number) => Promise<unknown> }} [options]
 *   ensureRelease caches a pressing from Discogs; the fixture pressing never needs it.
 * @returns {Promise<number[]>} the pressings that got new demo data
 */
export async function seedDemo(pool, { releaseIds = [], now = Date.now(), ensureRelease } = {}) {
  await upsertRelease(pool, mapRelease(releaseFixture), new Date(now));
  const ids = [FIXTURE_RELEASE_ID, ...releaseIds.filter((id) => id !== FIXTURE_RELEASE_ID)];
  for (const id of ids) {
    if (id !== FIXTURE_RELEASE_ID) {
      if (!ensureRelease) throw new Error(`Can't fetch release ${id} without the catalog`);
      await ensureRelease(id);
    }
  }
  return withTransaction(pool, async (client) => {
    const traders = await ensureTraders(client);
    const seeded = [];
    for (const id of ids) if (await seedRelease(client, id, traders, now)) seeded.push(id);
    return seeded;
  });
}

// `npm run db:seed -- [releaseId ...]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadConfig } = await import('../config.js');
  const { createContext } = await import('../context.js');
  const { migrate } = await import('./migrate.js');
  const releaseIds = process.argv.slice(2).map(Number);
  if (releaseIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    console.error('Usage: npm run db:seed -- [discogsReleaseId ...]');
    process.exit(1);
  }
  const ctx = createContext(loadConfig());
  try {
    await migrate(ctx.pool);
    const seeded = await seedDemo(ctx.pool, {
      releaseIds,
      ensureRelease: (id) => ctx.catalog.ensureRelease(id),
    });
    console.log(
      seeded.length
        ? `Seeded pressings: ${seeded.join(', ')}. Log in as any of ${DEMO_TRADERS.join(', ')} (email <name>@example.com, password ${DEMO_PASSWORD}).`
        : 'Demo data is already there.',
    );
    console.log(`Open http://localhost:5173/release/${FIXTURE_RELEASE_ID} to see the market.`);
  } catch (error) {
    console.error(`Seeding failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await ctx.pool.end();
  }
}
