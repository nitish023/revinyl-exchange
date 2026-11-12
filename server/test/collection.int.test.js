/**
 * Part 6: importing a Discogs collection. The fake Discogs (helpers.js) has a user
 * "digger" whose collection is the docs-shaped fixture: four vinyl records (two copies of
 * the same LP among them) and a CD. "shy" keeps theirs private.
 */
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_COPIES_PER_USER, MAX_IMPORT } from '../../shared/index.js';
import { createApp } from '../src/app.js';
import { MAX_PAGES } from '../src/collection/importService.js';
import { createTestContext, resetDatabase } from './helpers.js';

const ctx = createTestContext();
const app = createApp(ctx, { rateLimit: false });

beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.catalogSource.collectionPages = 1;
  ctx.catalogSource.collectionRepeat = 1;
  ctx.catalogSource.collectionCalls = 0;
  ctx.catalogSource.failWith = null;
  ctx.collection.clearPreviews();
});
afterAll(() => ctx.pool.end());

const query = async (sql, params) => (await ctx.pool.query(sql, params)).rows;

async function signUp(name = 'alice') {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ email: `${name}@example.com`, displayName: name, password: 'password123' })
    .expect(201);
  const cookie = response.headers['set-cookie'][0].split(';')[0];
  return {
    id: response.body.user.id,
    preview: (username) =>
      request(app).get('/api/collection/discogs').query({ username }).set('Cookie', cookie),
    import: (body) => request(app).post('/api/collection/discogs').set('Cookie', cookie).send(body),
  };
}

const choose = (items, grade = 6) =>
  items.map((item) => ({
    instanceId: item.instanceId,
    grade: item.grade ?? grade,
    sleeveGrade: typeof item.sleeveGrade === 'number' ? item.sleeveGrade : null,
  }));

describe('preview', () => {
  it('needs a login', async () => {
    await request(app).get('/api/collection/discogs?username=digger').expect(401);
  });

  it('lists the vinyl, newest first, with grades from Discogs where the owner set them', async () => {
    const alice = await signUp();
    const { body } = await alice.preview('digger').expect(200);

    expect(body.username).toBe('digger');
    expect(body.skipped).toBe(1); // the CD
    expect(body.more).toBe(false);
    expect(body.crateRoom).toBe(MAX_COPIES_PER_USER);
    expect(body.items.map((item) => item.instanceId)).toEqual([900001, 900002, 900003, 900005]);
    expect(body.items[0]).toMatchObject({
      grade: 6,
      sleeveGrade: 5,
      alreadyImported: false,
      release: { id: 249504, title: 'Never Gonna Give You Up', artist: 'Rick Astley' },
    });
    expect(body.items[1]).toMatchObject({ grade: 7, sleeveGrade: 'generic' });
    expect(body.items[2]).toMatchObject({ grade: null, sleeveGrade: null });
  });

  it('says when there is no such Discogs user, and when the collection is private', async () => {
    const alice = await signUp();
    const missing = await alice.preview('nobody').expect(404);
    const shy = await alice.preview('shy').expect(403);

    expect(missing.body.error.fields.username).toMatch(/no user called nobody/);
    expect(shy.body.error.code).toBe('COLLECTION_PRIVATE');
  });

  it('refuses a username Discogs couldn’t have, without calling Discogs', async () => {
    const alice = await signUp();
    await alice.preview('../users').expect(400);
    expect(ctx.catalogSource.collectionCalls).toBe(0);
  });

  it(`stops at ${MAX_IMPORT} records and at ${MAX_PAGES} pages, and says there are more`, async () => {
    const alice = await signUp();
    ctx.catalogSource.collectionRepeat = 30; // 120 vinyl a page
    ctx.catalogSource.collectionPages = 3;
    const { body } = await alice.preview('digger').expect(200);
    expect(body.items).toHaveLength(MAX_IMPORT);
    expect(body.more).toBe(true);
    expect(ctx.catalogSource.collectionCalls).toBe(2); // fields + one page was enough

    ctx.catalogSource.collectionRepeat = 1; // 4 vinyl a page
    ctx.catalogSource.collectionPages = 50;
    ctx.catalogSource.collectionCalls = 0;
    const thin = (await alice.preview('digger').expect(200)).body;
    expect(thin.items).toHaveLength(4 * MAX_PAGES);
    expect(thin.more).toBe(true);
    expect(ctx.catalogSource.collectionCalls).toBe(1 + MAX_PAGES);
  });

  it('answers 503 when Discogs is down', async () => {
    const alice = await signUp();
    const { DiscogsUnavailableError } = await import('../src/catalog/discogsClient.js');
    ctx.catalogSource.failWith = new DiscogsUnavailableError('down', 'Discogs answered 500');
    await alice.preview('digger').expect(503);
  });
});

describe('import', () => {
  it('adds the chosen records as copies with the chosen grades, and caches each pressing', async () => {
    const alice = await signUp();
    const { items } = (await alice.preview('digger').expect(200)).body;
    const chosen = [
      { instanceId: 900001, grade: 6, sleeveGrade: 5 },
      { instanceId: 900002, grade: 7, sleeveGrade: null },
      { instanceId: 900005, grade: 4, sleeveGrade: 4 },
    ];

    const { body } = await alice.import({ username: 'digger', items: chosen }).expect(201);

    expect(body).toEqual({ imported: 3, alreadyImported: 0 });
    const copies = await query(
      `SELECT release_id, grade, sleeve_grade, source, discogs_instance_id, status
         FROM copies ORDER BY discogs_instance_id`,
    );
    expect(copies).toEqual([
      {
        release_id: 249504,
        grade: 6,
        sleeve_grade: 5,
        source: 'discogs_import',
        discogs_instance_id: 900001,
        status: 'in_crate',
      },
      {
        release_id: 1000001,
        grade: 7,
        sleeve_grade: null,
        source: 'discogs_import',
        discogs_instance_id: 900002,
        status: 'in_crate',
      },
      {
        release_id: 1000001,
        grade: 4,
        sleeve_grade: 4,
        source: 'discogs_import',
        discogs_instance_id: 900005,
        status: 'in_crate',
      },
    ]);
    // Imported pressings are cached but stale, so their page fetches the full release.
    const [stub] = await query(
      `SELECT title, artist, tracklist, fetched_at FROM releases WHERE id = 1000001`,
    );
    expect(stub).toMatchObject({ title: 'Harbor Songs', artist: 'Pell & Ruiz', tracklist: [] });
    expect(stub.fetched_at.getTime()).toBe(0);
    expect(items).toHaveLength(4);
  });

  it('never overwrites a pressing we already have', async () => {
    const alice = await signUp();
    await ctx.catalog.getRelease(249504); // the full release, with its tracklist
    await alice.preview('digger').expect(200);
    await alice
      .import({ username: 'digger', items: [{ instanceId: 900001, grade: 6, sleeveGrade: 5 }] })
      .expect(201);
    const [release] = await query('SELECT tracklist, fetched_at FROM releases WHERE id = 249504');
    expect(release.tracklist.length).toBeGreaterThan(0);
    expect(release.fetched_at.getTime()).toBeGreaterThan(0);
  });

  it('skips records already imported, and marks them in the next preview', async () => {
    const alice = await signUp();
    const first = (await alice.preview('digger').expect(200)).body;
    await alice.import({ username: 'digger', items: choose(first.items.slice(0, 2)) }).expect(201);

    const again = (await alice.preview('digger').expect(200)).body;
    expect(again.items.map((item) => item.alreadyImported)).toEqual([true, true, false, false]);
    const { body } = await alice
      .import({ username: 'digger', items: choose(again.items) })
      .expect(201);
    expect(body).toEqual({ imported: 2, alreadyImported: 2 });
    expect(await query('SELECT count(*)::int AS n FROM copies')).toEqual([{ n: 4 }]);
  });

  it('lets a removed import come back', async () => {
    const alice = await signUp();
    await alice.preview('digger').expect(200);
    const one = [{ instanceId: 900003, grade: 5, sleeveGrade: null }];
    await alice.import({ username: 'digger', items: one }).expect(201);
    await query(`UPDATE copies SET removed_at = now()`);
    const { body } = await alice.import({ username: 'digger', items: one }).expect(201);
    expect(body.imported).toBe(1);
  });

  it('only imports records from that collection', async () => {
    const alice = await signUp();
    await alice.preview('digger').expect(200);
    const response = await alice
      .import({ username: 'digger', items: [{ instanceId: 12345, grade: 6, sleeveGrade: null }] })
      .expect(409);
    expect(response.body.error.code).toBe('NOT_IN_COLLECTION');
    // A CD from the collection isn't in the vinyl preview either.
    await alice
      .import({ username: 'digger', items: [{ instanceId: 900004, grade: 6, sleeveGrade: null }] })
      .expect(409);
    expect(await query('SELECT id FROM copies')).toEqual([]);
  });

  it('reads the collection again when there is no recent preview for that username', async () => {
    const alice = await signUp();
    const { body } = await alice
      .import({ username: 'digger', items: [{ instanceId: 900002, grade: 7, sleeveGrade: null }] })
      .expect(201);
    expect(body.imported).toBe(1);
    expect(ctx.catalogSource.collectionCalls).toBe(2);
  });

  it('needs a grade for every record', async () => {
    const alice = await signUp();
    await alice.preview('digger').expect(200);
    const response = await alice
      .import({ username: 'digger', items: [{ instanceId: 900003, sleeveGrade: null }] })
      .expect(400);
    expect(response.body.error.message).toMatch(/grade/i);
  });

  it('respects the crate limit and imports nothing when the records don’t fit', async () => {
    const alice = await signUp();
    await query(
      `INSERT INTO releases (id, title, artist, discogs_url) VALUES (1, 't', 'a', 'https://www.discogs.com/release/1')`,
    );
    await query(
      `INSERT INTO copies (owner_id, release_id, grade) SELECT $1, 1, 6 FROM generate_series(1, $2)`,
      [alice.id, MAX_COPIES_PER_USER - 1],
    );
    const { items, crateRoom } = (await alice.preview('digger').expect(200)).body;
    expect(crateRoom).toBe(1);

    const full = await alice
      .import({ username: 'digger', items: choose(items.slice(0, 2)) })
      .expect(409);
    expect(full.body.error.code).toBe('CRATE_FULL');
    expect(full.body.error.message).toMatch(/room for 1 more/);
    await alice.import({ username: 'digger', items: choose(items.slice(0, 1)) }).expect(201);
  });

  it('keeps each person’s preview to themselves', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await alice.preview('digger').expect(200);
    await bob
      .import({ username: 'digger', items: [{ instanceId: 900001, grade: 6, sleeveGrade: null }] })
      .expect(201);
    expect(await query('SELECT owner_id FROM copies')).toEqual([{ owner_id: bob.id }]);
  });
});
