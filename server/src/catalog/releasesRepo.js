/**
 * Reads and writes the cached Discogs releases (migration 002). pg returns
 * bigint ids as strings, so they are turned back into numbers here.
 */

function toReleaseDto(row) {
  return {
    id: Number(row.id),
    title: row.title,
    artist: row.artist,
    year: row.year,
    released: row.released,
    country: row.country,
    label: row.label,
    catno: row.catno,
    formats: row.formats,
    genres: row.genres,
    styles: row.styles,
    tracklist: row.tracklist,
    coverUrl: row.cover_url,
    thumbUrl: row.thumb_url,
    discogsUrl: row.discogs_url,
    fetchedAt: row.fetched_at.toISOString(),
  };
}

export async function findRelease(db, id) {
  const { rows } = await db.query('SELECT * FROM releases WHERE id = $1', [id]);
  return rows[0] ? toReleaseDto(rows[0]) : null;
}

/** Insert or refresh a cached release. Returns the stored row. */
export async function upsertRelease(db, release, fetchedAt) {
  const { rows } = await db.query(
    `INSERT INTO releases (id, title, artist, year, released, country, label, catno, formats,
                           genres, styles, tracklist, cover_url, thumb_url, discogs_url, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title, artist = EXCLUDED.artist, year = EXCLUDED.year,
       released = EXCLUDED.released, country = EXCLUDED.country, label = EXCLUDED.label,
       catno = EXCLUDED.catno, formats = EXCLUDED.formats, genres = EXCLUDED.genres,
       styles = EXCLUDED.styles, tracklist = EXCLUDED.tracklist, cover_url = EXCLUDED.cover_url,
       thumb_url = EXCLUDED.thumb_url, discogs_url = EXCLUDED.discogs_url,
       fetched_at = EXCLUDED.fetched_at
     RETURNING *`,
    [
      release.id,
      release.title,
      release.artist,
      release.year,
      release.released,
      release.country,
      release.label,
      release.catno,
      release.formats,
      release.genres,
      release.styles,
      JSON.stringify(release.tracklist),
      release.coverUrl,
      release.thumbUrl,
      release.discogsUrl,
      fetchedAt,
    ],
  );
  return toReleaseDto(rows[0]);
}
