/**
 * The crate: the copies a user owns, and their photos (Part 3).
 * Listing a copy for sale goes through the order service; this file never changes a
 * copy's status except to remove it.
 */
import {
  addCopySchema,
  conditionText,
  formatCents,
  MAX_COPIES_PER_USER,
  MAX_PHOTOS_PER_COPY,
  photoTypeFromBytes,
} from '../../../shared/index.js';
import { withTransaction } from '../db/pool.js';
import { AppError, notFound } from '../errors.js';

const photoUrl = (copyId, position) => `/api/copies/${copyId}/photos/${position}`;

/** A `copies` row (plus optional joined columns) as the API sends it. */
function toCopy(row) {
  const photos = row.photos ?? [];
  return {
    id: row.id,
    releaseId: row.release_id,
    grade: row.grade,
    sleeveGrade: row.sleeve_grade,
    condition: conditionText(row.grade, row.sleeve_grade),
    flags: row.flags,
    headline: row.headline,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    photos: photos.map((position) => ({ position, url: photoUrl(row.id, position) })),
    ...(row.title === undefined
      ? {}
      : {
          release: {
            id: row.release_id,
            title: row.title,
            artist: row.artist,
            thumbUrl: row.thumb_url,
          },
        }),
    // An open FOR SALE ad, so the crate page can show its price and offer to cancel it.
    ask:
      row.ask_order_id === null || row.ask_order_id === undefined
        ? null
        : { orderId: row.ask_order_id, price: formatCents(row.ask_price_cents) },
  };
}

/**
 * Add a copy to the user's crate. The pressing is cached from Discogs first, because
 * copies reference releases(id); a release that isn't vinyl is a 404.
 * @param {{ pool: import('pg').Pool, catalog: import('../catalog/catalogService.js').CatalogService }} ctx
 */
export async function addCopy(ctx, userId, input) {
  const copy = addCopySchema.parse(input ?? {});
  await ctx.catalog.ensureRelease(copy.releaseId);
  // A soft cap: two adds at the same moment could go one over, which is harmless.
  const { rows: counted } = await ctx.pool.query(
    'SELECT count(*) AS active FROM copies WHERE owner_id = $1 AND removed_at IS NULL',
    [userId],
  );
  if (counted[0].active >= MAX_COPIES_PER_USER) {
    throw new AppError(
      409,
      'CRATE_FULL',
      `Your crate holds up to ${MAX_COPIES_PER_USER} copies. Remove one to add another.`,
    );
  }
  const { rows } = await ctx.pool.query(
    `INSERT INTO copies (owner_id, release_id, grade, sleeve_grade, flags, headline, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [userId, copy.releaseId, copy.grade, copy.sleeveGrade, copy.flags, copy.headline, copy.notes],
  );
  return toCopy(rows[0]);
}

/** The user's copies, newest first, optionally only for one pressing. */
export async function listCrate(pool, userId, releaseId) {
  const { rows } = await pool.query(
    `SELECT c.*, r.title, r.artist, r.thumb_url,
            o.id AS ask_order_id, o.price_cents AS ask_price_cents,
            array(SELECT p.position FROM copy_photos p
                   WHERE p.copy_id = c.id ORDER BY p.position) AS photos
       FROM copies c
       JOIN releases r ON r.id = c.release_id
       LEFT JOIN orders o ON o.copy_id = c.id AND o.side = 'ask' AND o.status = 'open'
      WHERE c.owner_id = $1 AND c.removed_at IS NULL
        AND ($2::bigint IS NULL OR c.release_id = $2)
      ORDER BY c.created_at DESC, c.id DESC`,
    [userId, releaseId ?? null],
  );
  return rows.map(toCopy);
}

/** Lock one of the user's own copies for the rest of the transaction, or 404. */
async function lockMyCopy(client, userId, copyId) {
  const { rows } = await client.query(
    `SELECT id, status FROM copies
      WHERE id = $1 AND owner_id = $2 AND removed_at IS NULL FOR UPDATE`,
    [copyId, userId],
  );
  if (rows.length === 0) throw notFound('Copy');
  return rows[0];
}

/**
 * Remove a copy from the crate. Only a copy sitting in the crate can go: a listed copy's
 * ad must be cancelled first, and a copy in a trade belongs to that trade. The row stays
 * (old orders and trades point at it); its photos are deleted to save space.
 */
export async function removeCopy(pool, userId, copyId) {
  await withTransaction(pool, async (client) => {
    const copy = await lockMyCopy(client, userId, copyId);
    if (copy.status !== 'in_crate') {
      throw new AppError(
        409,
        'COPY_NOT_AVAILABLE',
        copy.status === 'listed'
          ? 'That copy is for sale. Cancel its ad before removing it.'
          : 'That copy is in a trade, so it can’t be removed.',
      );
    }
    await client.query('UPDATE copies SET removed_at = now() WHERE id = $1', [copyId]);
    await client.query('DELETE FROM copy_photos WHERE copy_id = $1', [copyId]);
  });
}

/**
 * Store a photo of one of the user's copies in the next free slot (1 to 6).
 * `bytes` is the raw request body. Its type is read from the bytes themselves; the
 * Content-Type header only decides whether Express handed us the body at all.
 * @param {Buffer | unknown} bytes
 */
export async function addPhoto(pool, userId, copyId, bytes) {
  const type = Buffer.isBuffer(bytes) && bytes.length > 0 ? photoTypeFromBytes(bytes) : null;
  if (!type) {
    throw new AppError(415, 'UNSUPPORTED_PHOTO', 'Photos must be JPEG, PNG or WebP images.');
  }
  return withTransaction(pool, async (client) => {
    const copy = await lockMyCopy(client, userId, copyId);
    if (copy.status === 'in_trade') {
      throw new AppError(
        409,
        'COPY_NOT_AVAILABLE',
        'That copy is in a trade, so its photos are final.',
      );
    }
    const { rows } = await client.query('SELECT position FROM copy_photos WHERE copy_id = $1', [
      copyId,
    ]);
    const taken = new Set(rows.map((row) => row.position));
    let position = 1;
    while (taken.has(position)) position += 1;
    if (position > MAX_PHOTOS_PER_COPY) {
      throw new AppError(
        409,
        'PHOTO_LIMIT',
        `A copy can have up to ${MAX_PHOTOS_PER_COPY} photos.`,
      );
    }
    await client.query(
      'INSERT INTO copy_photos (copy_id, position, content_type, bytes) VALUES ($1, $2, $3, $4)',
      [copyId, position, type, bytes],
    );
    return { position, url: photoUrl(copyId, position) };
  });
}

/** A photo for an ad. Anyone may see it; photos of removed copies are gone. */
export async function findPhoto(pool, copyId, position) {
  const { rows } = await pool.query(
    `SELECT p.content_type, p.bytes
       FROM copy_photos p JOIN copies c ON c.id = p.copy_id
      WHERE p.copy_id = $1 AND p.position = $2 AND c.removed_at IS NULL`,
    [copyId, position],
  );
  if (rows.length === 0) throw notFound('Photo');
  return { contentType: rows[0].content_type, bytes: rows[0].bytes };
}
