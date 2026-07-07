/*
 * AniList → playback-id bridge tests (pure JS, fake fetch).
 * Run: bun utils/anilist/mapping.test.ts
 */
import { strict as assert } from "node:assert";
import {
  type AnilistIdMap,
  type FetchLike,
  fetchIdMap,
  imdbMovieStreamId,
  kitsuStreamId,
  resolvePlaybackTarget,
} from "./mapping";

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

function fakeFetch(
  data: unknown,
  status = 200,
  captured?: string[],
): FetchLike {
  return async (url) => {
    captured?.push(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
    };
  };
}

const FRIEREN_MAP: AnilistIdMap = {
  anilist: 154587,
  kitsu: 46474,
  imdb: "tt22248376",
  myanimelist: 52991,
  thetvdb: 424536,
  "thetvdb-season": 1,
};

async function main() {
  await test("fetchIdMap builds the arm URL + parses", async () => {
    const urls: string[] = [];
    const map = await fetchIdMap(154587, fakeFetch(FRIEREN_MAP, 200, urls));
    assert.equal(map?.kitsu, 46474);
    assert.match(urls[0], /source=anilist&id=154587$/);
  });

  await test("fetchIdMap → null on 404 (unmapped id)", async () => {
    const map = await fetchIdMap(999999, fakeFetch({}, 404));
    assert.equal(map, null);
  });

  test("kitsuStreamId: single number, no season", () => {
    assert.equal(kitsuStreamId(46474, 1), "kitsu:46474:1");
    assert.equal(kitsuStreamId(46474, 12), "kitsu:46474:12");
    assert.equal(kitsuStreamId(46474), "kitsu:46474");
  });

  test("imdbMovieStreamId is the bare tt id", () => {
    assert.equal(imdbMovieStreamId("tt22248376"), "tt22248376");
  });

  test("resolvePlaybackTarget → kitsu-first for a series episode", () => {
    const t = resolvePlaybackTarget(FRIEREN_MAP, {
      episode: 5,
      singleVideo: false,
    });
    assert.equal(t?.source, "kitsu");
    assert.equal(t?.streamId, "kitsu:46474:5");
    assert.deepEqual(t?.types, ["anime", "series"]);
  });

  test("resolvePlaybackTarget → kitsu movie has no episode segment", () => {
    const t = resolvePlaybackTarget(
      { kitsu: 123, imdb: "tt1" },
      { episode: 1, singleVideo: true },
    );
    assert.equal(t?.streamId, "kitsu:123");
    assert.ok(t?.types.includes("movie"));
  });

  test("resolvePlaybackTarget → imdb fallback ONLY for movies", () => {
    // No kitsu, movie → imdb.
    const movie = resolvePlaybackTarget(
      { imdb: "tt99" },
      { episode: 1, singleVideo: true },
    );
    assert.equal(movie?.source, "imdb");
    assert.equal(movie?.streamId, "tt99");
    // No kitsu, SERIES → refuse (driving imdb with AniList numbers breaks cours).
    const series = resolvePlaybackTarget(
      { imdb: "tt99" },
      { episode: 3, singleVideo: false },
    );
    assert.equal(series, null);
  });

  test("resolvePlaybackTarget → null when nothing maps", () => {
    assert.equal(
      resolvePlaybackTarget(null, { episode: 1, singleVideo: false }),
      null,
    );
    assert.equal(
      resolvePlaybackTarget({}, { episode: 1, singleVideo: true }),
      null,
    );
  });

  console.log(`\n✅ anilist mapping: ${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
