# rycord

> my record collection, in 3d.

Rycord turns my Discogs collection into a cache-first 3D record room. Albums
sit on a Kallax-style shelf in a rainy cafe scene, with real cover art,
procedural spines, a turntable, and an RGB strip controlled by the remote on
the floor.

This is built for a single personal collection, so upstream data is treated as
local library data once fetched. Cache files are plain JSON or images under
`data/`, which makes them easy to mount in Docker, edit by hand, or back up.

## quickstart

```bash
npm install
cp .env.example .env.local
npm run dev
```

The dev server runs at `http://localhost:3030`.

Set `DISCOGS_USER` in `.env.local` to load a different public collection. Add
`DISCOGS_TOKEN` if the collection is private or you want authenticated Discogs
requests. If Discogs is unavailable and no cache exists yet, Rycord falls back
to bundled synthetic records.

## configuration

See `.env.example` for the full commented list.

| var                  | required | purpose                                      |
|----------------------|----------|----------------------------------------------|
| `DISCOGS_USER`       | no       | Discogs username for the shelf               |
| `DISCOGS_TOKEN`      | no       | Personal token for authenticated requests    |
| `RYCORD_DATA_DIR`    | no       | Cache root, defaults to `./data`             |
| `LASTFM_API_KEY`     | no       | Description fallback after Wikipedia         |
| `OPENROUTER_API_KEY` | no       | Final AI fallback for album descriptions     |
| `OPENROUTER_MODEL`   | no       | Comma-separated OpenRouter model chain       |
| `MULTIPLY_RECORDS`   | no       | Dev-only shelf density test multiplier       |

## cache model

Normal app loads read local cache first. Rycord only calls upstream APIs when a
needed cache file does not exist yet.

| path                    | contents                                      |
|-------------------------|-----------------------------------------------|
| `data/collections/*.json` | Normalized collection entries and raw Discogs rows |
| `data/releases/*.json`    | Release metadata, notes, tracklist, durations, raw payload |
| `data/descriptions/*.json` | Wikipedia, Last.fm, or OpenRouter description payloads |
| `data/palettes/*.json`    | Derived cover palettes                       |
| `data/covers/*`           | Proxied cover image binaries and metadata    |

Description lookup order is:

1. Wikipedia
2. Last.fm
3. OpenRouter

Delete an individual cache file to force Rycord to fetch that item again.

## refresh from Discogs

Use `refresh=1` when you intentionally want to re-pull your Discogs collection:

```bash
curl "http://localhost:3030/api/collection?user=YOUR_DISCOGS_USER&refresh=1"
```

That request rewrites `data/collections/<user>.json`, compares old cached
release IDs against the current Discogs collection, and prunes albums you no
longer own from:

- `data/releases`
- `data/descriptions`
- `data/palettes`
- `data/covers`

The response includes `source` and `prunedReleaseIds`.

## docker data volume

Mount `data/` into the container so the collection survives rebuilds:

```yaml
volumes:
  - ./data:/app/data
```

If you want the cache somewhere else locally, set `RYCORD_DATA_DIR`.

## scripts

- `npm run dev`: Next dev server on port `3030`
- `npm run build`: production build
- `npm start`: run the production server on port `3030`
- `npm run typecheck`: TypeScript check

## project map

```text
app/
  page.tsx                    Load records and palettes, then mount SceneLoader
  layout.tsx                  Root metadata and global styles
  api/
    collection/route.ts       Collection response, refresh, and prune endpoint
    cover/[id]/route.ts       Same-origin cached Discogs cover proxy
    release/[id]/route.ts     Cached release details and tracklists
    description/[id]/route.ts Cached Wikipedia, Last.fm, OpenRouter descriptions

components/
  Scene.tsx                   R3F room, shelf layout, camera, post effects
  VinylRecord.tsx             Pull-out record interaction and front/back jacket
  InfoPanel.tsx               Active record metadata, notes, tracklist, actions
  Room.tsx                    Floor, wall, baseboard, rug
  RoomProps.tsx               Wall art, plant, book stack, mug, other decor
  RGBStrip.tsx                Addressable LED strip
  Remote.tsx                  In-scene controls for the LED strip
  Paper.tsx                   Pickup-style note from me on the floor
  Turntable.tsx               Centerpiece player
  Shelf.tsx                   Procedural Kallax-style grid

lib/
  dataCache.ts                Disk cache helpers
  discogs.ts                  Discogs client, collection cache, refresh pruning
  cachedAssets.ts             Cover and palette disk cache
  palette.ts                  Sharp-based palette extraction
  releaseDetails.ts           Client-side release detail loader
  covers.ts                   Synthetic fallback records
  ledStore.ts                 Shared state for the remote, paper, and LED strip
```

## current limits

- Desktop-first scene, with `MobileGate` for narrow or touch viewports
- One configured collection at a time
- One room theme
- No audio playback
