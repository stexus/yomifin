/*
 * Stremio addon client tests (pure JS, recorded-fixture style — no network).
 * Run: bun utils/stremio/client.test.ts
 */
import { strict as assert } from "node:assert";
import {
  addonBaseUrl,
  browsableCatalogs,
  type FetchLike,
  fetchCatalog,
  fetchManifest,
  fetchMetaFromAddons,
  fetchStreamsFromAddons,
  isPlayableStream,
  manifestSupports,
  playableStreams,
  resourceUrl,
  type StremioManifest,
  searchAddons,
  searchableCatalogs,
  sortVideos,
  streamLabel,
  videoLabel,
} from "./client";

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  const run = async () => {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  };
  return run().catch((e) => {
    console.error(`  ✗ ${name}`);
    throw e;
  });
}

/** Fake fetch serving canned JSON by exact URL. */
function fakeFetch(routes: Record<string, unknown>): FetchLike {
  return async (url: string) => {
    if (url in routes) {
      return { ok: true, status: 200, json: async () => routes[url] };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

// ---------------------------------------------------------------------------
// Fixtures (shapes mirror real cinemeta/torrentio-style responses)
// ---------------------------------------------------------------------------

const META_ADDON: StremioManifest = {
  id: "com.example.meta",
  name: "MetaAddon",
  resources: ["catalog", { name: "meta", types: ["series", "movie"] }],
  types: ["series", "movie", "anime"],
  idPrefixes: ["tt", "kitsu"],
  catalogs: [
    { type: "anime", id: "top", name: "Top Anime" },
    {
      type: "anime",
      id: "search-only",
      name: "Search",
      extra: [{ name: "search", isRequired: true }],
    },
    {
      type: "series",
      id: "optional-genre",
      name: "By Genre",
      extra: [{ name: "genre", isRequired: false }, { name: "skip" }],
    },
  ],
};

const STREAM_ADDON: StremioManifest = {
  id: "com.example.stream",
  name: "StreamAddon",
  resources: [
    { name: "stream", types: ["series", "movie"], idPrefixes: ["tt"] },
  ],
  types: ["series", "movie"],
  catalogs: [],
};

const BASE_META = "https://meta.example.com/u/abc";
const BASE_STREAM = "http://stream.example.com/u/xyz";

await test("addonBaseUrl strips /manifest.json (and trailing slashes)", () => {
  assert.equal(
    addonBaseUrl("https://a.com/stremio/uuid/manifest.json"),
    "https://a.com/stremio/uuid",
  );
  assert.equal(addonBaseUrl("http://a.com/manifest.json/"), "http://a.com");
  assert.throws(() => addonBaseUrl("https://a.com/stremio/uuid"));
  assert.throws(() => addonBaseUrl("ftp://a.com/manifest.json"));
});

await test("resourceUrl percent-encodes ids and appends extra segment", () => {
  assert.equal(
    resourceUrl("https://a.com", "stream", "series", "tt123:1:2"),
    "https://a.com/stream/series/tt123%3A1%3A2.json",
  );
  assert.equal(
    resourceUrl("https://a.com", "catalog", "anime", "top", { skip: 100 }),
    "https://a.com/catalog/anime/top/skip=100.json",
  );
  assert.equal(
    resourceUrl("https://a.com", "catalog", "anime", "top", {
      search: "頭文字D",
    }),
    `https://a.com/catalog/anime/top/search=${encodeURIComponent("頭文字D")}.json`,
  );
  // skip=0 → no extra segment (matches stremio client behavior)
  assert.equal(
    resourceUrl("https://a.com", "catalog", "anime", "top", { skip: 0 }),
    "https://a.com/catalog/anime/top.json",
  );
});

await test("manifestSupports: string resources use manifest-level types/prefixes", () => {
  assert.equal(manifestSupports(META_ADDON, "catalog", "anime"), true);
  assert.equal(manifestSupports(META_ADDON, "catalog", "channel"), false);
  assert.equal(manifestSupports(META_ADDON, "meta", "series", "tt1"), true);
  // object resource narrows types: meta doesn't serve "anime"
  assert.equal(manifestSupports(META_ADDON, "meta", "anime", "tt1"), false);
  // id prefix gate
  assert.equal(manifestSupports(META_ADDON, "meta", "series", "yt:x"), false);
  assert.equal(manifestSupports(STREAM_ADDON, "stream", "series", "tt9"), true);
  assert.equal(
    manifestSupports(STREAM_ADDON, "stream", "series", "kitsu:9"),
    false,
  );
  assert.equal(manifestSupports(STREAM_ADDON, "meta", "series", "tt9"), false);
});

await test("browsableCatalogs filters required-extra catalogs", () => {
  const cats = browsableCatalogs(META_ADDON);
  assert.deepEqual(
    cats.map((c) => c.id),
    ["top", "optional-genre"],
  );
});

await test("fetchManifest validates shape", async () => {
  const url = `${BASE_META}/manifest.json`;
  const m = await fetchManifest(url, fakeFetch({ [url]: META_ADDON }));
  assert.equal(m.name, "MetaAddon");
  await assert.rejects(
    fetchManifest(url, fakeFetch({ [url]: { hello: "world" } })),
  );
  await assert.rejects(fetchManifest(url, fakeFetch({}))); // 404
});

await test("fetchCatalog returns metas", async () => {
  const url = `${BASE_META}/catalog/anime/top.json`;
  const metas = await fetchCatalog(
    `${BASE_META}/manifest.json`,
    "anime",
    "top",
    undefined,
    fakeFetch({
      [url]: { metas: [{ id: "kitsu:1", type: "anime", name: "A" }] },
    }),
  );
  assert.equal(metas.length, 1);
  assert.equal(metas[0].name, "A");
});

await test("fetchMetaFromAddons: first supporting addon wins, failures skipped", async () => {
  const addons = [
    { manifestUrl: `${BASE_STREAM}/manifest.json`, manifest: STREAM_ADDON }, // no meta
    { manifestUrl: `${BASE_META}/manifest.json`, manifest: META_ADDON },
  ];
  const metaUrl = `${BASE_META}/meta/series/tt42.json`;
  const meta = await fetchMetaFromAddons(
    addons,
    "series",
    "tt42",
    fakeFetch({
      [metaUrl]: {
        meta: {
          id: "tt42",
          type: "series",
          name: "Show",
          videos: [{ id: "tt42:1:1", season: 1, episode: 1 }],
        },
      },
    }),
  );
  assert.equal(meta?.name, "Show");
  assert.equal(meta?.videos?.length, 1);
});

await test("fetchStreamsFromAddons aggregates + annotates addon name", async () => {
  const addons = [
    { manifestUrl: `${BASE_STREAM}/manifest.json`, manifest: STREAM_ADDON },
    { manifestUrl: `${BASE_META}/manifest.json`, manifest: META_ADDON }, // no stream resource
  ];
  const streamUrl = `${BASE_STREAM}/stream/series/tt42%3A1%3A1.json`;
  const streams = await fetchStreamsFromAddons(
    addons,
    "series",
    "tt42:1:1",
    fakeFetch({
      [streamUrl]: {
        streams: [
          {
            name: "RD 1080p",
            title: "Show.S01E01.mkv",
            url: "https://dl.example/x.mkv",
          },
          { name: "Torrent", infoHash: "abcd", fileIdx: 0 },
        ],
      },
    }),
  );
  assert.equal(streams.length, 2);
  assert.equal(streams[0].addonName, "StreamAddon");
  const playable = playableStreams(streams);
  assert.equal(playable.length, 1);
  assert.equal(playable[0].stream.url, "https://dl.example/x.mkv");
});

await test("isPlayableStream: url required, http(s) only", () => {
  assert.equal(isPlayableStream({ url: "https://x/y.mkv" }), true);
  assert.equal(isPlayableStream({ url: "magnet:?xt=urn" }), false);
  assert.equal(isPlayableStream({ infoHash: "ab" }), false);
  assert.equal(isPlayableStream({ externalUrl: "https://x" }), false);
});

await test("streamLabel flattens newlines; videoLabel + sortVideos", () => {
  const l = streamLabel({ name: "RD\n1080p", title: "a\nb" });
  assert.equal(l.title, "RD · 1080p");
  assert.equal(l.subtitle, "a · b");
  assert.equal(
    videoLabel({ id: "x", season: 1, episode: 3, title: "Ep" }),
    "S1E3 · Ep",
  );
  const sorted = sortVideos([
    { id: "sp", season: 0, episode: 1 },
    { id: "b", season: 1, episode: 2 },
    { id: "a", season: 1, episode: 1 },
  ]);
  assert.deepEqual(
    sorted.map((v) => v.id),
    ["a", "b", "sp"],
  );
});

await test("searchableCatalogs finds search-extra catalogs, narrows by type", () => {
  // META_ADDON: only the anime "search-only" catalog accepts search.
  assert.deepEqual(
    searchableCatalogs(META_ADDON).map((c) => c.id),
    ["search-only"],
  );
  // Narrowed to series → none match.
  assert.deepEqual(
    searchableCatalogs(META_ADDON, ["series"]).map((c) => c.id),
    [],
  );
  // extraSupported form.
  const m: StremioManifest = {
    id: "x",
    name: "X",
    resources: ["catalog"],
    types: ["movie"],
    catalogs: [
      { type: "movie", id: "s", name: "S", extraSupported: ["search", "skip"] },
      { type: "movie", id: "n", name: "N" },
    ],
  };
  assert.deepEqual(
    searchableCatalogs(m, ["movie"]).map((c) => c.id),
    ["s"],
  );
});

await test("searchAddons queries search catalogs, merges + dedupes by id", async () => {
  const A: StremioManifest = {
    id: "a",
    name: "AddonA",
    resources: ["catalog"],
    types: ["movie", "series"],
    catalogs: [
      { type: "movie", id: "m", extraSupported: ["search"] },
      { type: "series", id: "s", extraSupported: ["search"] },
    ],
  };
  const B: StremioManifest = {
    id: "b",
    name: "AddonB",
    resources: ["catalog"],
    types: ["movie"],
    catalogs: [{ type: "movie", id: "m", extraSupported: ["search"] }],
  };
  const addons = [
    { manifestUrl: "https://a.com/manifest.json", manifest: A },
    { manifestUrl: "https://b.com/manifest.json", manifest: B },
  ];
  const q = "naruto";
  const enc = encodeURIComponent(q);
  const hits = await searchAddons(
    addons,
    q,
    ["movie", "series"],
    fakeFetch({
      [`https://a.com/catalog/movie/m/search=${enc}.json`]: {
        metas: [{ id: "tt1", type: "movie", name: "Naruto Movie" }],
      },
      [`https://a.com/catalog/series/s/search=${enc}.json`]: {
        metas: [{ id: "tt2", type: "series", name: "Naruto" }],
      },
      // B returns tt1 again (dup) + a new one.
      [`https://b.com/catalog/movie/m/search=${enc}.json`]: {
        metas: [
          { id: "tt1", type: "movie", name: "Naruto Movie (dup)" },
          { id: "tt3", type: "movie", name: "Naruto Movie 2" },
        ],
      },
    }),
  );
  // tt1 deduped to AddonA (first); tt2, tt3 present.
  assert.deepEqual(
    hits.map((h) => h.meta.id),
    ["tt1", "tt2", "tt3"],
  );
  assert.equal(hits[0].addonName, "AddonA");
  assert.equal(hits[2].addonName, "AddonB");
});

await test("searchAddons: blank query short-circuits, bad catalog swallowed", async () => {
  const A: StremioManifest = {
    id: "a",
    name: "AddonA",
    resources: ["catalog"],
    types: ["movie"],
    catalogs: [{ type: "movie", id: "m", extraSupported: ["search"] }],
  };
  const addons = [{ manifestUrl: "https://a.com/manifest.json", manifest: A }];
  assert.deepEqual(await searchAddons(addons, "   "), []);
  // Catalog 404s → swallowed, empty result (no throw).
  assert.deepEqual(
    await searchAddons(addons, "x", ["movie"], fakeFetch({})),
    [],
  );
});

console.log(`\n✅ stremio client: ${passed} tests passed`);
