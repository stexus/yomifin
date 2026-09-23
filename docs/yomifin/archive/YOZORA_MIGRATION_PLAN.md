# Plan: Replace the Stremio/Anime tabs with the Yozora backend

**Archived 2026-09-23.** The migration is implemented. The final session
summary dated 2026-07-15 records device verification except SUB-6 “Sync on
server”; earlier per-phase “pending”, “next” and external-repo worktree notes
below are historical snapshots, not current instructions. `FEATURES.md` is the
source of truth for remaining gates and detail-page parity work. No deployment
or worktree status in the separate Yozora repository was reverified in this audit.

Implementation differs from the original plan: types/constants are maintained
in `utils/yozora/types.ts` (no generator or OpenAPI hash check), session glue is
`utils/yozora/session.ts`, and all legacy Anime/Stremio files are deleted.

---

## 1. Context & goal

Yomifin's on-demand streaming surface is currently **two tabs built on two
client-side stacks**:

| Tab | Stack | What it does client-side |
| --- | --- | --- |
| `(stremio)` | `utils/stremio/client.ts` | Full Stremio addon protocol client: manifest/catalog/meta/stream fan-out, debrid-URL filtering, hardcoded addon manifest URLs (with embedded tokens) in `Settings.stremioAddonUrls` |
| `(anime)` | `utils/anilist/` | Direct AniList GraphQL discovery + `arm.haglund.dev` kitsu-id bridge (`mapping.ts`, MMKV-cached) → `kitsu:{id}:{ep}` stream queries through the same addon client |

Both feed `app/(auth)/player/stremio-player.tsx` (mpv + full yomifin mining
pipeline) with **local-only MMKV watch state** (`utils/stremio/watchState.ts`).

**Yozora** (`~/playground/yozora`) is a self-hosted backend that does all of
this server-side, better, behind one versioned API (`/api/v1`, OpenAPI generated
from Zod schemas in `packages/shared/`):

- **Identity:** canonical `title_key` (`anilist:{id}`, `tmdb:movie:{id}`,
  `tmdb:show:{id}`), anime episodes = AniList absolute numbers (ANM-1).
- **Discovery:** `GET /discover/anime` (AniList server-side, cached),
  `/discover/movies|shows` (TMDB), `GET /search`, `GET /shelves`.
- **Detail:** `GET /titles/{key}` (relations, recommendations, cast,
  `external_ids`, `title_variants`, `next_airing`) +
  `GET /titles/{key}/episodes` (paginated ×20, **with `still_url` stills** —
  replaces our TVDB-thumbnail backfill hack wholesale).
- **Resolution:** `GET /titles/{key}/sources` (server does addon fan-out,
  release parsing, TorBox cached-check, ranking) + `POST /resolve` (auto-pick
  best cached, or explicit `info_hash`) → short-lived CDN URL. The
  Fribb/anime_map kitsu bridge lives server-side — `utils/anilist/mapping.ts`
  and the arm dependency die entirely.
- **Progress:** `POST /progress` ticks (PRG-1), server-derived
  resumable/watched semantics, `GET /continue-watching` (resume / next-up /
  sequel / waiting), `GET /library`, manual watched/unwatched, hide.
  This **is** FEATURES backlog item 9 ("progress synced with web interface").
- **Subtitles:** server-cached OpenSubtitles + Jimaku search per title/episode,
  and **`POST /subtitles/{id}/sync`** — server-side alass re-timing against the
  playing file (SUB-6/SUB-7).
- **Auth:** closed registration, opaque bearer device tokens, login or pairing
  flow, per-device revocation.

**Goal:** rewrite the on-demand surface as a thin client of Yozora, deleting the
client-side addon/AniList/mapping/watch-state machinery, and reorganize the
naming while we're at it. The yomifin mining pipeline (overlay, lookup, Anki,
capture), the mpv module, GestureOverlay, and everything Jellyfin-side are
**untouched**.

---

## 2. Naming & organization (the explicit ask)

"Stremio" is a leftover from when we spoke the addon protocol ourselves; the
new backend isn't Stremio (Yozora merely *consumes* Stremio addons server-side,
invisibly to us). Proposal:

### Recommended scheme: one namespace, one tab — `yozora`

- **Code namespace `yozora`** everywhere, mirroring how `yomifin` names the
  language layer:
  - `utils/yozora/` — API client, auth, hooks (pure, bun-testable, token/URL
    passed in — same purity rule as `utils/yomifin/`)
  - `components/yozora/` — cards, shelves, grids, filter modal, player controls
  - `app/(auth)/(tabs)/(yozora)/` — the tab (replaces BOTH `(stremio)` and
    `(anime)`)
  - `app/(auth)/player/yozora-player.tsx` — renamed player route
  - Settings keys `yozora*`; log prefix `[YOZORA]`
- **One tab, label "Yozora"**, SF symbol `moon.stars` (yozora = night sky —
  the brand does the "on-demand streaming" job Stremio's name used to do;
  "Anime" would be wrong the moment it isn't anime-only).
- **The tab is the whole Yozora client, not just anime.** Yozora's web shell
  navs Home · Anime · Movies · Shows · Search · Library; yomifin's tab bar
  already has 9 entries, so those become an **internal section switcher**, not
  more tabs: a pinned section row (`Home · Anime · Movies · Shows · Library`)
  in the tab's persistent top bar — the same pattern the anime tab's pinned
  search/filter bar uses today — swapping the body in place. **Default =
  Home** (decided 2026-07-12): like Yozora web's landing (WEB-1), Home is pure
  client-side composition — Continue Watching rail + discovery rails + addon
  shelf rails — no `/home` endpoint exists or is needed. The rail list is a
  plain config array in code, so re-defaulting to Anime later is one line, and
  a future server-side home-config (Yozora is expected to grow one) can drive
  it with no restructure. Movies/Shows reuse the same shelves-⇄-grid skeleton
  with TMDB vocabulary (`/discover/movies|shows`); Library renders
  `GET /library`. Home+Anime ship first (Phase 2a); Movies/Shows/Library
  follow in Phase 2b — once the skeleton exists they're mostly configuration
  (see Phase 2b for the honest per-section cost). Search stays folded into
  yomifin's existing unified `(search)` tab (scope selector), not a Yozora
  section.
- **"Collapse two tabs into one" does NOT mean losing anime discovery.** The
  Anime section IS today's `(anime)` screen, near-verbatim (one chip from the
  Home landing — and Home's CW + anime rails cover the common case): same
  persistent search bar + filter + title bar, same shelves ⇄ inline-grid swap,
  same detail layout — only the data layer changes (direct AniList GraphQL →
  `GET /discover/anime`, which is AniList server-side per Yozora SPEC DSC-2,
  TTL-cached). What actually disappears is the OLD `(stremio)` tab's unique
  content — generic addon catalog shelves + client-side addon management —
  which moves server-side (admin panel; `GET /shelves` can resurrect catalog
  rows as a section later if missed). The only anime-discovery deltas are the
  parity items in §5 (filter tags/year-ranges, title-language toggle), both
  fixable by small additive Yozora API amendments (Open Question C).
- **Component names inside stay content-descriptive** (`AnimeCard`,
  `AnimeShelf`, `AnimeFilterModal` move to `components/yozora/` unrenamed —
  they describe what they render, not the transport).

### Alternatives considered

- *Tab label "Anime", namespace `yozora`* — accurate today, paints us into a
  corner tomorrow; also splits user-facing name from code name for no gain.
- *Generic names (`(ondemand)`, `(streams)`, `(cloud)`)* — vague, and the code
  would still need a concrete namespace for the client.
- *Keep two tabs* — the `(stremio)` tab's only unique job (generic addon
  catalogs) maps to Yozora shelves/movie-show discover, which we don't need on
  day 1. Collapse to one tab; resurrect sections later if wanted.

### Settings migration

| Old | New |
| --- | --- |
| `stremioAddonUrls` (hardcoded manifests w/ tokens!) | **deleted** — addons are admin-managed server-side (also closes FEATURES backlog item 12) |
| `stremioAutoPlayFirstStream` | `yozoraAutoPlay` (semantics upgrade: `POST /resolve` auto-pick = *best cached*, not "first in list") |
| `searchScope: "jellyfin" \| "stremio" \| "both"` | `"jellyfin" \| "yozora" \| "both"` (map old stored value on read) |
| `anilistTitleLanguage` | keep **only if** parity is restored (see Open Question C); otherwise delete with the toggle |
| — (new) | Settings: `yozoraDeviceName`, `yozoraAutoPlay` (prefs only). **Credentials** (`yozora.serverUrl/token/username/deviceId`) are dedicated top-level MMKV keys in `utils/yozora/session.ts` — NOT Settings, which is plugin-overridable (a Jellyfin server can lock/override any Settings key) and JSON-serialized wholesale. Mirrors how JellyfinProvider stores its own `token`/`serverUrl`. |

---

## 3. Old → new mapping (what dies, what replaces it)

| Current code | Fate | Yozora replacement |
| --- | --- | --- |
| `utils/stremio/client.ts` (+test) | **delete** | `GET /titles/{key}/sources`, `POST /resolve`, `GET /shelves` |
| `utils/stremio/useStremioAddons.ts` | **delete** | server-side addon management |
| `utils/stremio/useStremioSearch.ts` | **delete** | `GET /search` |
| `utils/stremio/watchState.ts` | **delete** | `POST /progress` ticks + `GET /titles/{key}/progress` resume |
| `utils/anilist/client.ts` (+test) | **delete** | `GET /discover/anime`, `GET /titles/{key}`, `GET /titles/{key}/episodes` |
| `utils/anilist/mapping.ts`, `useAnilistIdMap.ts` (+test) | **delete** | server-side `anime_map` (Fribb) + kitsu-first RES-2 |
| Episode-thumbnail backfill (`fetchMetaFromAddons` + `episodeThumbnailMap`) | **delete** | `EpisodeSummary.still_url` |
| `app/(auth)/(tabs)/(stremio)/` (index/catalog/meta) | **delete** | folded into the one `(yozora)` tab |
| `app/(auth)/(tabs)/(anime)/` | **rewrite → move** | `app/(auth)/(tabs)/(yozora)/{_layout,index,detail}.tsx` |
| `app/(auth)/player/stremio-player.tsx` | **rename + rewire** | `yozora-player.tsx`: resolve-aware, server progress ticks |
| `components/stremio/StremioPlayerControls.tsx` | **move/rename** | `components/yozora/YozoraPlayerControls.tsx` (presentational — unchanged internally) |
| `components/stremio/CatalogShelf.tsx` | **delete** (or adapt for `/shelves` later) | — |
| `components/anime/*` | **move** | `components/yozora/*` (unchanged internally) |
| `components/search/StremioSearchResults.tsx` | **rename + rewire** | `YozoraSearchResults.tsx` over `GET /search` |
| jimaku direct client (`utils/yomifin/jimaku.ts`, `OnlineSubtitlesModal`) | **keep** (shared with direct-player) | Phase 5 option: add Yozora subtitle search/sync as a second source |
| yomifin-test.sh steps 16/18/19 (stremio + anilist clients) | replace | new `utils/yozora/` client tests |

**New client code** (`utils/yozora/`):

- `types.gen.ts` — checked-in output of `openapi-typescript` against the served
  `/api/v1/openapi.json` (types only, zero runtime deps; regen script in
  `scripts/`). Yozora's API-2 guarantees the doc matches the runtime schemas.
- `api.ts` — thin typed fetch wrapper (`{baseUrl, token}` passed in, RN-free,
  bun-testable): discover/search/detail/episodes/sources/resolve/progress/
  continue-watching/subtitles, structured `{error:{code}}` handling with the
  stable RES-15 codes (`NOTHING_CACHED`, `NO_MAPPING`, …).
- `auth.ts` — login (`POST /auth/login`) → device token; logout = device
  revoke. (Pairing flow AUTH-4 exists but username/password in Settings is
  simpler for a single-user sideloaded app.)
- `hooks.ts` / `utils/atoms/yozora.ts` — Jotai atoms for server config + token,
  React Query hooks for the endpoints (device-only glue lives here, not in
  `api.ts`).

---

## 4. Phases

Each phase is independently shippable and device-gated (JS-only → `just dev`;
the only potentially-native change is ATS config, see Phase 0).

### Phase 0 — prep & decisions (no yomifin code)

1. **Reachability:** confirm the iPad can reach the Yozora deployment.
   **✓ RESOLVED (audit 2026-07-12):** `app.json` already sets
   `NSAllowsArbitraryLoads: true` (Jellyfin-over-http support), so plain
   http-on-LAN works with no native change. Remaining question is only
   away-from-home access (Tailscale/reverse proxy) — affects nothing but the
   URL entered in Settings → Yozora.
2. Create a yomifin user in Yozora admin; `curl` sanity: login → sources →
   resolve an airing anime episode → CDN URL plays in mpv on the Mac.
3. Settle **Open Questions A–D** (§6) — especially filter parity, since it
   decides whether Yozora needs SPEC amendments first.

### Phase 1 — client foundation (`utils/yozora/` + auth + settings) ✅ IMPLEMENTED

- ✅ `utils/yozora/types.ts` (hand-authored from the shared Zod schemas; regen
  path via `openapi-typescript` noted in-file), `utils/yozora/api.ts` (pure,
  RN-free, injectable fetch — full read/write surface: discover/search/detail/
  episodes/sources/resolve/progress/continue-watching/subtitles/auth),
  `utils/yozora/api.test.ts` (10 offline tests: URL+query building, auth header,
  API-3 error-envelope → `YozoraApiError.code`, baseUrl normalization). Added as
  step `[yozora]` in `yomifin-test.sh`.
- ✅ `utils/yozora/session.ts` — device-only glue: `useYozora()` hook returning
  `{client, connected, serverUrl, username, connect, disconnect}`. Credentials
  live in dedicated MMKV keys (`yozora.*`), synchronously loaded into a Jotai
  atom — NOT in Settings (audit fix: the Settings bag is plugin-overridable
  and JSON-serialized; Jellyfin's own token uses the same separate-key
  convention). Sign-out best-effort revokes the device then clears locally,
  keeping serverUrl for re-login.
- ✅ Settings keys `yozora{DeviceName,AutoPlay}` (prefs only) + **Settings →
  Yozora** screen (`app/(auth)/(tabs)/(home)/settings/yozora/page.tsx`):
  server URL, username/password connect (INVALID_CREDENTIALS /
  ACCOUNT_DISABLED / NETWORK_ERROR mapped to friendly copy), status banner,
  Test connection (`GET /me`), auto-play toggle, Sign out. Registered in
  `settings.tsx` AND in `(home)/_layout.tsx` (title + HeaderBackButton — audit
  fix: unregistered settings routes get a raw default header).
- Additive only — nothing existing changed; typecheck + lint + full
  `yomifin-test.sh` green.
- **Gate (PENDING DEVICE):** on-device login persists across app restart; Test
  connection shows OK against the real deployment. Depends on Phase 0
  reachability (ATS if http-on-LAN).

> **Next: (1) the Phase 1 device gate (user, ~10 min), (2) Phase 2-pre in the
> yozora repo, (3) Phase 2a session here.** The client + session are ready to
> consume; nothing is deleted yet.

### Phase 2-pre — filter-parity amendments ✅ IMPLEMENTED (both repos)

Decided (Open Question C → resolved): full filter parity, so the API grew
first. What actually landed in yozora (shapes differ from the original guesses
— both improvements):

1. `AnimeDiscoverQuerySchema` += `tags` (comma-separated AniList tag names,
   AND) + **`ANILIST_TAG_GROUPS`** — grouped `{group, tags[]}` vocabulary
   (Demographic/Premise/Setting/Characters/Romance/Hobbies), not a flat list.
2. `AnimeDiscoverQuerySchema` += `year_min`/`year_max` (inclusive, AniList
   startDate bounds). `season_year` stays for exact season+year.
3. `TitleSummarySchema` += optional **structured `titles`
   `{romaji, english, native}`** (not flat fields) — client picks per the
   title-language toggle.

Yomifin follow-up done (2026-07-14): `types.ts` extended (+ vendored
`ANILIST_TAG_GROUPS` with a re-copy note — constants ship in yozora's shared
schemas, not over the API), serialization test added (11 tests green).

⚠️ **Yozora-side gate before 2a's device test:** the amendment sits
UNCOMMITTED in `~/playground/yozora` (working tree: discover.ts +148,
AnimeFilterBar, titleLang.ts, migration 0013…) and SPEC.md has NO changelog
entry for it (repo's own SPEC-is-law rule). m4 conformance tests pass (32/32).
Commit + SPEC entry + **deploy** before the yomifin tab can exercise
tags/year filters against the real server.

### Phase 2a — the `(yozora)` tab skeleton + Home + Anime ✅ IMPLEMENTED (2026-07-15, gate pending)

- New `(yozora)` route group; register in `(tabs)/_layout.tsx` (`moon.stars`);
  delete the `(anime)` and `(stremio)` registrations.
- **Tab anatomy (decided):** `index.tsx` = nav header + **pinned section chip
  row** (`Home · Anime · Movies · Shows · Library` — same visual language as
  `TitleLanguageToggle`/filter chips; NOT nested native tabs). **Default =
  Home**; chip choice is plain session state (no MMKV persistence — a fixed,
  predictable landing beats stickiness, and the default is one line to change
  later). Body = one component per section, plain swap on chip change (React
  Query cache makes re-entry instant; per-section scroll restoration is later
  polish). 2a renders the Movies/Shows/Library chips disabled-or-hidden until
  2b.
- **Home section (mirrors web `Home.tsx`, WEB-1):** a rail-config array →
  Continue Watching rail first, then discovery rails, each with "see all →"
  activating the matching section chip. In 2a the config lists only the anime
  rails (Trending anime, Airing soon); the movie/show rails (Trending/New
  movies, Trending/Top-rated shows) and `/shelves` addon rails join in 2b
  when their detail flows exist. A future Yozora server-side home-config
  slots in by replacing the hardcoded array.
- **Continue Watching = one global rail, first row of every section**,
  scrolling with content (`GET /continue-watching` returns mixed kinds; one
  query serves all sections; resume/next-up/sequel play directly; waiting
  cards show air countdown, link to detail).
- **Anime section:** the current AniList-style screen near-verbatim
  (persistent search bar + filter + shelves ⇄ inline grid), rewired to
  `GET /discover/anime` sorts (trending / popularity / rating / newest /
  airing).
- **Filter modal:** full existing vocabulary via the Phase 2-pre amendments
  (sort, year range, season, status, format, genres, tags). One modal
  skeleton, per-section vocabularies (2b reuses it with TMDB vocab — exactly
  how Yozora web shares `FilterBar`/`AnimeFilterBar`).
- **Route by `title_key` from day 1:** detail takes `?key=anilist:207141`
  (canonical key string), NOT an AniList numeric id — so `tmdb:movie:*` /
  `tmdb:show:*` details, `"{s}:{e}"` episode encoding, and mixed-kind search
  results plug in during Phase 2b with zero rework. The detail screen branches
  on `kind` (absolute-numbered episodes for anime per ANM-1; seasons list for
  shows — the API shapes both). Phase 2a only ever *links* to anime keys.
- **Detail:** `GET /titles/anilist:{id}` + paginated episodes (UI change: the
  current 1..N full list becomes 20-per-page — "load more" or season-style
  pager) + `still_url` thumbnails + watched/in-progress state from
  `GET /titles/{key}/progress` + PRG-5 mark watched/unwatched (long-press) +
  relations/recommendations from the detail payload.
- **Source picker:** `GET /titles/{key}/sources` — richer rows than today:
  ⚡cached badge, resolution, quality class, seeders, size, addon attribution.
  Tap → `POST /resolve {info_hash}` → player. `yozoraAutoPlay` → bare
  `POST /resolve` (auto-pick), falling back to the picker on `NOTHING_CACHED`.
  Structured error codes → honest picker states (`NO_MAPPING` → "no sources
  yet", etc.).
- **Disconnected states (required, not polish):** not-configured → explainer +
  button deep-linking to Settings → Yozora; configured-but-unreachable →
  "server unreachable" + retry. Never a bare spinner or error.
- **Gate:** browse → detail → episode → source list → episode plays in the
  (still-named) stremio-player with the full mining pipeline.

### Phase 2b — Movies · Shows · Library sections + full Home ✅ IMPLEMENTED (2026-07-15, gate pending)

Honest per-section cost, in build order:

- **Home completes:** movie/show discovery rails (Trending/New movies,
  Trending/Top-rated shows) + `/shelves` addon rails appended to the 2a rail
  config — pure composition, no new components beyond `ShelfRail`.

- **Movies (near-free):** browse grid + TMDB filter vocab (`DiscoverQuery`:
  genres/year range/min rating; `TMDB_MOVIE_GENRES` ships as shared
  constants) via `GET /discover/movies`; detail is play-button-only (no
  episode list) — the `kind` branch already exists.
- **Library (small):** two grids — In Progress (`GET /library`) and History
  (`GET /library/history`), progress badges, hide/unhide per PRG-9.
- **Shows (the only real new UI):** seasons — season picker + per-season
  episode lists from `TitleDetail.seasons`, `"{s}:{e}"` episode keys
  (anime's flat paginated list doesn't cover this).
- **`canonical_key` redirect (ANM-5):** a tmdb title unambiguously mapped to
  AniList → detail redirects to the `anilist:{id}` key so identity/progress
  live under the anime key.
- **Gate:** each section browses → details → plays; a movie started from
  Continue Watching resumes.

### Phase 3 — the player (`yozora-player.tsx` + server progress) ✅ IMPLEMENTED (2026-07-15, gate pending)

> Implementation notes (deltas from the plan below): the route is a NEW file
> (`yozora-player.tsx`) rather than a rename — `stremio-player.tsx` +
> `watchState.ts` still exist untouched and die in Phase 4 (the old tabs are
> `tabBarItemHidden`, not deleted, so everything keeps compiling). Sections
> 2a+2b shipped together: `components/yozora/sections/{HomeSection,
> AnimeSection,TmdbSection,LibrarySection}.tsx` under the chip row in
> `(yozora)/index.tsx`. Ticks are fire-and-forget with integer seconds
> (PRG-1 schema); "ended" is inferred at ≥97% on leave. Re-resolve fires on
> ANY mpv error when expires_at is unknown OR <5min away, once per 30s.

- Rename route; params become `{title_key, episode, url, expires_at, title,
  query, anilistId}` (identity params derived from `title_key`; jimaku keeps
  its raw AniList id + romaji prefill via detail `title_variants`).
- **Progress ticks (PRG-1):** every ~15s while playing + immediately on
  pause/seek and on `beforeRemove` (`stopped`) / natural end (`ended`).
  Resume position from `GET /titles/{key}/progress` (server semantics: <5% not
  resumable, ≥85% watched — replaces the local 96% heuristic). Fire-and-forget
  with a small offline swallow (a lost tick is not an error state).
- **Re-resolve on expiry (SHIM-7 analog):** on mpv network error with a
  near/past `expires_at`, `POST /resolve` again (same `info_hash`) and reload
  at the last position instead of dying.
- Delete `watchState.ts` + its FEATURES row references.
- **Gate:** watch half an episode on iPad → it appears resumable in the Yozora
  web app at the right position; finish it → next-up appears in the tab's
  Continue Watching row; kill/reopen mid-episode → resumes.

### Phase 4 — search + deletion sweep ✅ IMPLEMENTED (2026-07-15, gate pending)

> Implementation notes: `searchScope` stored value `"stremio"` is mapped to
> `"yozora"` at the READ site (search screen) — the literal survives in that one
> line by necessity. `StremioPlayerControls` →
> `components/yozora/YozoraPlayerControls.tsx` (yozora-player was its only
> consumer). `anilistTitleLanguage` kept (parity restored in 2-pre; key name is
> historical). Remaining `rg -i stremio` hits: the migration literal + history
> comments in yozora files — no live addon code.

- `searchScope` value rename (+ stored-value migration), `useStremioSearch` →
  `GET /search`, `StremioSearchResults` → `YozoraSearchResults` routing into
  `(yozora)/detail`; section header "Yozora".
- Delete: `utils/stremio/`, `utils/anilist/`, `(stremio)` +`(anime)` route
  groups, `components/stremio/`, old settings keys, the two hardcoded addon
  manifest URLs (tokens leave the repo — backlog item 12 done).
- Update `YOMIFIN_CONTEXT.md` file map + FEATURES.md (Shipped rows rewritten to
  point at the new files; backlog items 1/9/12 closed or reworded).
- **Gate:** `rg -i stremio` finds nothing outside FEATURES/context history;
  typecheck/lint/tests green; unified search returns Yozora hits.

### Phase 5 — follow-ups ✅ IMPLEMENTED (subtitles part, 2026-07-15, gate pending)

> Implementation notes: rather than a second modal, `OnlineSubtitlesModal` grew
> an OPTIONAL injectable `serverSubs` source (list/download/sync) + an
> `activeServerId` prop — yozora-player injects the Yozora client (langs ja,en,
> manual q, authenticated download via `subtitleContent`), direct-player passes
> nothing and is unchanged. "Sync on server" appears in the Active/sync section
> only when the active sub is server-loaded; it POSTs the resolved CDN URL so
> alass re-times against the exact playing file, then loads the returned
> provider:"sync" row (delay resets to 0). AniList scrobbling (PRG-7) stays
> server-side — nothing to do client-side.

- **Yozora subtitles in the player:** list `GET /titles/{key}/subtitles`
  (server-cached jimaku + OpenSubtitles) alongside/behind the existing jimaku
  modal; **SUB-6 sync** (`POST /subtitles/{id}/sync` with the resolved
  `stream_url`) as a one-tap "Sync on server" next to the manual-nudge UI —
  server-side alass beats our offset estimator, and works even when the stream
  carries no reference subs (SUB-7 embedded-track extraction).
- AniList scrobbling arrives server-side (PRG-7) for free when Yozora ships it.
- (Movies/Shows/Library moved up into Phase 2b — decided 2026-07-12.)

---

## 5. Feature parity ledger (honest deltas)

**Wins:** server-ranked + cached-aware sources; real cross-device progress
(item 9); next-up/sequel/waiting rows; episode stills without the TVDB hack;
addon tokens out of the repo (item 12); structured resolve errors; no more arm
/ AniList direct-call flakiness (server caches); alass subtitle sync available.

**Regressions to accept or fix:**

1. **Addon-provided per-stream subtitle URLs are gone** — `Source` has no
   `subtitles[]` (Yozora resolves infoHash→CDN; addon subtitle sidecars aren't
   modeled). Today those seeded the cue store AND were the auto-sync reference.
   Post-migration: cue store comes from jimaku or the embedded track (already
   the common case); auto-sync reference is lost → Phase 5's server-side sync
   is the (better) replacement. Until then: manual nudges, as embedded-only
   playback already behaves.
2. ~~Anime filter vocabulary shrinks~~ → resolved by Phase 2-pre amendments
   (tags + year range; single format already matches the modal's actual
   single-select behavior).
3. ~~Title-language toggle~~ → resolved by Phase 2-pre `title_english`/
   `title_native` on `TitleSummary`.
4. **Episode list pagination** (20/page vs full list) — minor UX change.
5. **Server dependency:** the tab is dead when the deployment is down (the old
   stack talked to public endpoints directly). Acceptable — Jellyfin tab is the
   offline path — but every screen needs a graceful "server unreachable" state
   with retry, not a spinner.

---

## 6. Open questions

- **A. Auth mode: ✓ RESOLVED** — username/password (implemented in Phase 1).
- **B. Who resolves: ✓ RESOLVED (2026-07-14)** — detail/picker resolves and
  passes the URL (PWA-2-style handoff; Yozora ships both models — the desktop
  shim resolves itself per SHIM-3, mobile handoff pre-resolves per PWA-2).
  Rationale: resolve errors land on the tapped source row, and it ports the
  current stremio flow near-mechanically. The player still gets
  `{title_key, episode, info_hash, expires_at}` so SHIM-7-style
  re-resolve-on-expiry works inside the player. Progress tracking is
  unaffected either way — PRG-1 ticks always come from the player, which has
  the identity params under both models.
- **C. Yozora API extensions: ✓ RESOLVED (2026-07-12)** — full filter parity
  wanted; API grows first. See Phase 2-pre for the exact amendment list.
- **D. ATS: ✓ RESOLVED** — `NSAllowsArbitraryLoads` already true; only the
  away-from-home URL question remains (Tailscale/reverse proxy — affects
  nothing but the URL entered in Settings).

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| ~~ATS blocks http LAN calls silently~~ resolved: `NSAllowsArbitraryLoads` already true | Explicit connection-status UI in Settings → Yozora regardless |
| CDN URL expiry mid-episode | Phase 3 re-resolve-and-seek (`expires_at` is in the resolve response) |
| Tick spam / battery | 15s cadence matches the existing 10s MMKV save; fire-and-forget, no retry queue in v1 |
| Losing filter/title-language features annoys real use | Ledger §5 + Open Question C; decide *before* deleting the old tab, not after |
| Big-bang deletion breaks unified search or a forgotten import | Phase 4's `rg -i stremio` sweep gate + typecheck; phases 2–3 keep old code compiling until 4 |
| OpenAPI drift between repos | `types.gen.ts` regen script + a checked-in copy of the openapi.json hash; Yozora's API-1 additive-only discipline protects us |
