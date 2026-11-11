/**
 * Bringing a Discogs collection into your crate (Part 6). Two steps, so nothing lands in
 * your crate without a grade you chose:
 *
 *   1. preview(username): read the public collection from Discogs (newest first) and list
 *      its vinyl, up to 100 records, with grades filled in from Discogs' Media and Sleeve
 *      Condition fields where the owner set them. Kept for 30 minutes.
 *   2. importItems({ username, items }): add the ticked records as copies, with the grades
 *      from the form. Only records from that preview can be imported, so the request can't
 *      invent pressings, and a record already imported (and not removed) is skipped.
 *
 * Discogs only shows us public collections (we aren't logged in as their owner), and the
 * whole thing costs at most 1 + MAX_PAGES requests from our shared Discogs allowance.
 *
 * Known limit: we can't check that the Discogs account is yours without Discogs OAuth, so
 * anyone could import a public collection. With play money that's acceptable for the demo.
 */
import {
  collectionImportSchema,
  collectionPreviewQuerySchema,
  MAX_COPIES_PER_USER,
  MAX_IMPORT,
} from '../../../shared/index.js';
import { DiscogsUnavailableError } from '../catalog/discogsClient.js';
import { isVinyl } from '../catalog/discogsMapping.js';
import { insertReleaseIfMissing } from '../catalog/releasesRepo.js';
import { withTransaction } from '../db/pool.js';
import { AppError } from '../errors.js';

/** Pages of 100 to read at most, looking for 100 vinyl records among CDs and tapes. */
export const MAX_PAGES = 5;
const PREVIEW_TTL_MS = 30 * 60_000;

function discogsError(error, username) {
  if (!(error instanceof DiscogsUnavailableError)) return error;
  if (error.reason === 'private') {
    return new AppError(
      403,
      'COLLECTION_PRIVATE',
      `${username}’s collection is private on Discogs. Make it public in your Discogs privacy settings, then try again.`,
    );
  }
  return new AppError(
    503,
    'CATALOG_UNAVAILABLE',
    'Discogs is busy right now. Please try again in a minute.',
  );
}

const noSuchUser = (username) =>
  new AppError(404, 'DISCOGS_USER_NOT_FOUND', `Discogs has no user called ${username}.`, {
    username: `Discogs has no user called ${username}.`,
  });

/** What the import list shows for one record. */
function toPreviewItem(item, alreadyImported) {
  const { release } = item;
  return {
    instanceId: item.instanceId,
    addedAt: item.addedAt,
    release: {
      id: release.id,
      title: release.title,
      artist: release.artist,
      year: release.year,
      label: release.label,
      catno: release.catno,
      formats: release.formats,
      thumbUrl: release.thumbUrl,
    },
    grade: item.grade,
    sleeveGrade: item.sleeveGrade,
    alreadyImported,
  };
}

export class CollectionImport {
  /** @type {Map<number, { username: string, items: object[], expiresAt: number }>} */
  #previews = new Map();

  /**
   * @param {{ pool: import('pg').Pool,
   *   source: import('../catalog/discogsClient.js').CatalogSource, now?: () => number }} deps
   */
  constructor({ pool, source, now = Date.now }) {
    this.pool = pool;
    this.source = source;
    this.now = now;
  }

  /**
   * Step 1: what's in their collection.
   * @param {number} userId
   * @param {unknown} query { username }
   */
  async preview(userId, query) {
    const { username } = collectionPreviewQuerySchema.parse(query ?? {});
    const { items, skipped, more } = await this.#readCollection(username);
    this.#previews.set(userId, { username, items, expiresAt: this.now() + PREVIEW_TTL_MS });
    for (const [key, cached] of this.#previews) {
      if (cached.expiresAt <= this.now()) this.#previews.delete(key);
    }

    const imported = await this.#importedInstances(this.pool, userId, items);
    const { rows } = await this.pool.query(
      'SELECT count(*) AS active FROM copies WHERE owner_id = $1 AND removed_at IS NULL',
      [userId],
    );
    return {
      username,
      items: items.map((item) => toPreviewItem(item, imported.has(item.instanceId))),
      skipped, // not vinyl
      more, // the collection has more vinyl than one import takes
      crateRoom: Math.max(0, MAX_COPIES_PER_USER - rows[0].active),
    };
  }

  /**
   * Step 2: add the chosen records with their grades.
   * @param {number} userId
   * @param {unknown} body { username, items: [{ instanceId, grade, sleeveGrade }] }
   * @returns {Promise<{ imported: number, alreadyImported: number }>}
   */
  async importItems(userId, body) {
    const request = collectionImportSchema.parse(body ?? {});
    const cached = this.#previews.get(userId);
    const fresh =
      cached &&
      cached.expiresAt > this.now() &&
      cached.username.toLowerCase() === request.username.toLowerCase();
    const items = fresh ? cached.items : (await this.#readCollection(request.username)).items;
    const byInstance = new Map(items.map((item) => [item.instanceId, item]));
    const chosen = request.items.map((choice) => ({
      choice,
      item: byInstance.get(choice.instanceId),
    }));
    if (chosen.some(({ item }) => !item)) {
      throw new AppError(
        409,
        'NOT_IN_COLLECTION',
        'Some of those records aren’t in that Discogs collection any more. Look it up again.',
      );
    }

    return withTransaction(this.pool, async (client) => {
      // One import at a time per person, so two at once can't both squeeze under the cap.
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const imported = await this.#importedInstances(
        client,
        userId,
        chosen.map(({ item }) => item),
      );
      const todo = chosen.filter(({ item }) => !imported.has(item.instanceId));
      const { rows } = await client.query(
        'SELECT count(*) AS active FROM copies WHERE owner_id = $1 AND removed_at IS NULL',
        [userId],
      );
      const room = MAX_COPIES_PER_USER - rows[0].active;
      if (todo.length > room) {
        throw new AppError(
          409,
          'CRATE_FULL',
          `Your crate has room for ${Math.max(0, room)} more records. Untick some, or remove copies first.`,
        );
      }
      for (const { choice, item } of todo) {
        await insertReleaseIfMissing(client, item.release);
        await client.query(
          `INSERT INTO copies (owner_id, release_id, grade, sleeve_grade, source, discogs_instance_id)
           VALUES ($1, $2, $3, $4, 'discogs_import', $5)`,
          [userId, item.release.id, choice.grade, choice.sleeveGrade, item.instanceId],
        );
      }
      return { imported: todo.length, alreadyImported: chosen.length - todo.length };
    });
  }

  /** Forget every preview (tests start each case clean; user ids restart there). */
  clearPreviews() {
    this.#previews.clear();
  }

  async #readCollection(username) {
    try {
      const fieldIds = await this.source.getConditionFields(username);
      if (fieldIds === null) throw noSuchUser(username);
      const items = [];
      let skipped = 0;
      let more = false;
      let pages = 1;
      let page = 1;
      for (; page <= pages && page <= MAX_PAGES && items.length < MAX_IMPORT; page += 1) {
        const result = await this.source.getCollectionPage(username, page, fieldIds);
        if (result === null) throw noSuchUser(username);
        pages = result.pages;
        for (const item of result.items) {
          if (!isVinyl(item.release)) skipped += 1;
          else if (items.length < MAX_IMPORT) items.push(item);
          else more = true;
        }
      }
      return { items, skipped, more: more || page <= pages };
    } catch (error) {
      throw discogsError(error, username);
    }
  }

  /** The instance ids among `items` that this user already has as active copies. */
  async #importedInstances(db, userId, items) {
    const { rows } = await db.query(
      `SELECT discogs_instance_id FROM copies
        WHERE owner_id = $1 AND removed_at IS NULL AND discogs_instance_id = ANY($2::bigint[])`,
      [userId, items.map((item) => item.instanceId)],
    );
    return new Set(rows.map((row) => row.discogs_instance_id));
  }
}
