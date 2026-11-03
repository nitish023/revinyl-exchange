# reVINYL

A record exchange printed like a 1960s newspaper. Every vinyl pressing has its own market: sellers run FOR SALE ads
for the copies they own, buyers run WANTED ads with a price and the lowest condition grade they'll accept, and the
exchange matches them. Play money only.

CS375 Web Development, Drexel, Fall 2026. Team Vibe Coders on Tilt: Nitish Chawla and Sauransh Bhardwaj.

## Stack

- **Front end:** plain HTML, CSS and JavaScript modules, no framework. Vite bundles it.
- **Back end:** Node.js 22 and Express 5, PostgreSQL through `pg` (plain SQL), Zod for validation.
- **Data:** release details and cover art from the [Discogs API](https://www.discogs.com/developers). reVINYL is not
  affiliated with Discogs.
- **Hosting:** Render (web service) and Neon (Postgres).
- **Tests:** Vitest, with Supertest for the API.

## Run it locally

You need Node 22 and Docker.

```bash
npm install
cp .env.example .env     # then add your Discogs token (optional, needed for search)
npm run db:up            # Postgres on port 5433, plus a separate test database
npm run dev              # API on :3000, site on http://localhost:5173
```

The server creates and updates the database tables on start.

## Tests and checks

```bash
npm test                 # shared, server and browser unit tests (no database)
npm run test:integration # the API against the test database (needs db:up)
npm run test:all         # both
npm run lint
npm run format
```

## Production

```bash
npm run build && NODE_ENV=production npm start   # serves client/dist from Express
```

On Render, set `DATABASE_URL` (Neon connection string) and `DISCOGS_TOKEN` in the dashboard; `render.yaml` has the
rest.

## Project layout

```
shared/        rules used by both the browser and the server (grades, catalog, sign-up schemas)
server/src/    Express app: auth/, catalog/ (Discogs), market/ (matching engine), db/
server/migrations/  numbered SQL files, applied in order on start
server/test/   API integration tests
client/        index.html, src/ (pages, components, lib), styles.css
docs/          project rules, build plan and the brief for each part
```

See [docs/PROJECT.md](docs/PROJECT.md) for the rules we follow and the build plan.
