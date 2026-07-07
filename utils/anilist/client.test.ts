/*
 * AniList client tests (pure JS, no network — a fake fetch records the GraphQL
 * request and serves canned data). Run: bun utils/anilist/client.test.ts
 */
import { strict as assert } from "node:assert";
import {
  type AnilistMediaPreview,
  AnilistRateLimitError,
  airedEpisodeCount,
  cleanEpisodeTitle,
  currentSeason,
  displayTitle,
  episodeStreamMap,
  type FetchLike,
  fetchMediaDetail,
  fetchMediaList,
  fetchMediaPage,
  isSingleVideo,
  jimakuTitle,
  SEASON_OPTIONS,
  STATUS_OPTIONS,
  scoreColor,
  searchMedia,
  seasonLabel,
  seasonOptions,
  shelfPresets,
  stripDescription,
  yearOptions,
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

interface Captured {
  query: string;
  variables: Record<string, unknown>;
}

/** Fake fetch that records the POST body and returns `data`. */
function recordingFetch(
  data: unknown,
  captured: Captured[],
  status = 200,
): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse((init?.body as string) ?? "{}");
    captured.push({ query: body.query, variables: body.variables });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ data }),
    };
  };
}

const FRIEREN: AnilistMediaPreview = {
  id: 154587,
  idMal: 52991,
  type: "ANIME",
  title: {
    romaji: "Sousou no Frieren",
    english: "Frieren: Beyond Journey's End",
    native: "葬送のフリーレン",
  },
  coverImage: { extraLarge: "cover.jpg", color: "#5b8ca5" },
  format: "TV",
  episodes: 28,
  season: "FALL",
  seasonYear: 2023,
  averageScore: 96,
  genres: ["Adventure", "Drama", "Fantasy"],
  isAdult: false,
  nextAiringEpisode: null,
};

async function main() {
  await test("fetchMediaPage sends declared vars + parses Page", async () => {
    const captured: Captured[] = [];
    const page = await fetchMediaPage(
      { sort: ["TRENDING_DESC"], season: "FALL", seasonYear: 2023 },
      2,
      30,
      recordingFetch(
        {
          Page: {
            pageInfo: { hasNextPage: true, currentPage: 2 },
            media: [FRIEREN],
          },
        },
        captured,
      ),
    );
    assert.equal(page.media.length, 1);
    assert.equal(page.media[0].id, 154587);
    assert.equal(page.pageInfo.hasNextPage, true);
    // Only requested filters are sent (null filters omitted).
    const v = captured[0].variables;
    assert.deepEqual(v.sort, ["TRENDING_DESC"]);
    assert.equal(v.season, "FALL");
    assert.equal(v.seasonYear, 2023);
    assert.equal(v.page, 2);
    assert.equal("genre_in" in v, false);
    assert.equal("search" in v, false);
  });

  await test("fetchMediaPage maps the full filter set (genres/tags/format/status/year)", async () => {
    const captured: Captured[] = [];
    await fetchMediaPage(
      {
        genres: ["Action", "Comedy"],
        tags: ["Isekai"],
        formats: ["TV"],
        status: "RELEASING",
        seasonYear: 2024,
      },
      1,
      30,
      recordingFetch({ Page: { pageInfo: {}, media: [] } }, captured),
    );
    const v = captured[0].variables;
    assert.deepEqual(v.genre_in, ["Action", "Comedy"]);
    assert.deepEqual(v.tag_in, ["Isekai"]);
    assert.deepEqual(v.format_in, ["TV"]);
    assert.equal(v.status, "RELEASING");
    assert.equal(v.seasonYear, 2024); // standalone year (no season)
    assert.equal("season" in v, false);
  });

  await test("fetchMediaPage maps a year RANGE to startDate FuzzyDateInts", async () => {
    const captured: Captured[] = [];
    await fetchMediaPage(
      { yearFrom: 2025, yearTo: 2026, season: "WINTER" },
      1,
      30,
      recordingFetch({ Page: { pageInfo: {}, media: [] } }, captured),
    );
    const v = captured[0].variables;
    assert.equal(v.startDate_greater, 20250101);
    assert.equal(v.startDate_lesser, 20261231);
    assert.equal(v.season, "WINTER");
    assert.equal("seasonYear" in v, false); // range supersedes single year
  });

  await test("fetchMediaPage: single seasonYear used when no range set", async () => {
    const captured: Captured[] = [];
    await fetchMediaPage(
      { seasonYear: 2024 },
      1,
      30,
      recordingFetch({ Page: { pageInfo: {}, media: [] } }, captured),
    );
    const v = captured[0].variables;
    assert.equal(v.seasonYear, 2024);
    assert.equal("startDate_greater" in v, false);
  });

  await test("yearOptions descends from next year; STATUS/SEASON options present", () => {
    const years = yearOptions(new Date("2024-06-01"), 5);
    assert.deepEqual(years, [2025, 2024, 2023, 2022, 2021]);
    assert.equal(STATUS_OPTIONS[0].value, "RELEASING");
    assert.deepEqual(
      SEASON_OPTIONS.map((s) => s.value),
      ["WINTER", "SPRING", "SUMMER", "FALL"],
    );
  });

  await test("fetchMediaList returns page-1 media only", async () => {
    const captured: Captured[] = [];
    const list = await fetchMediaList(
      { sort: ["SCORE_DESC"] },
      20,
      recordingFetch(
        { Page: { pageInfo: {}, media: [FRIEREN, FRIEREN] } },
        captured,
      ),
    );
    assert.equal(list.length, 2);
    assert.equal(captured[0].variables.perPage, 20);
  });

  await test("searchMedia passes the query + SEARCH_MATCH sort", async () => {
    const captured: Captured[] = [];
    await searchMedia(
      "frieren",
      1,
      recordingFetch({ Page: { pageInfo: {}, media: [] } }, captured),
    );
    assert.equal(captured[0].variables.search, "frieren");
    assert.deepEqual(captured[0].variables.sort, ["SEARCH_MATCH"]);
  });

  await test("search never opts into adult by default", async () => {
    const captured: Captured[] = [];
    await searchMedia(
      "x",
      1,
      recordingFetch({ Page: { pageInfo: {}, media: [] } }, captured),
    );
    assert.equal("isAdult" in captured[0].variables, false); // defaults false in the query
  });

  await test("fetchMediaDetail passes the id", async () => {
    const captured: Captured[] = [];
    const detail = await fetchMediaDetail(
      154587,
      recordingFetch(
        { Media: { ...FRIEREN, description: "A mage…" } },
        captured,
      ),
    );
    assert.equal(detail?.id, 154587);
    assert.equal(captured[0].variables.id, 154587);
  });

  await test("429 → AnilistRateLimitError", async () => {
    let threw = false;
    try {
      await fetchMediaList({}, 20, recordingFetch({}, [], 429));
    } catch (e) {
      threw = e instanceof AnilistRateLimitError;
    }
    assert.ok(threw);
  });

  await test("GraphQL errors surface as thrown", async () => {
    const errFetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: "Invalid" }] }),
    });
    await assert.rejects(() => fetchMediaList({}, 20, errFetch), /Invalid/);
  });

  test("displayTitle honors language + falls through", () => {
    assert.equal(displayTitle(FRIEREN, "romaji"), "Sousou no Frieren");
    assert.equal(
      displayTitle(FRIEREN, "english"),
      "Frieren: Beyond Journey's End",
    );
    assert.equal(displayTitle(FRIEREN, "native"), "葬送のフリーレン");
    assert.equal(
      displayTitle({ title: { native: "x" } }, "english"),
      "x", // english missing → falls through to native
    );
  });

  test("jimakuTitle prefers romaji then native", () => {
    assert.equal(jimakuTitle(FRIEREN), "Sousou no Frieren");
    assert.equal(jimakuTitle({ title: { native: "鬼滅" } }), "鬼滅");
  });

  test("currentSeason maps months correctly", () => {
    assert.deepEqual(currentSeason(new Date("2024-01-15")), {
      season: "WINTER",
      year: 2024,
    });
    assert.deepEqual(currentSeason(new Date("2024-04-10")), {
      season: "SPRING",
      year: 2024,
    });
    assert.deepEqual(currentSeason(new Date("2024-10-01")), {
      season: "FALL",
      year: 2024,
    });
    // December rolls into next year's winter cour.
    assert.deepEqual(currentSeason(new Date("2024-12-20")), {
      season: "WINTER",
      year: 2025,
    });
  });

  test("shelfPresets includes the four rows + a live season", () => {
    const presets = shelfPresets(new Date("2023-11-01"));
    assert.deepEqual(
      presets.map((p) => p.key),
      ["trending", "season", "top", "alltime"],
    );
    const season = presets.find((p) => p.key === "season");
    assert.equal(season?.filters.season, "FALL");
    assert.equal(season?.filters.seasonYear, 2023);
  });

  test("seasonOptions walks back chronologically", () => {
    const opts = seasonOptions(new Date("2024-04-10"), 3);
    assert.deepEqual(
      opts.map((o) => o.label),
      ["Spring 2024", "Winter 2024", "Fall 2023"],
    );
  });

  test("scoreColor thresholds", () => {
    assert.equal(scoreColor(96), "#16a34a");
    assert.equal(scoreColor(70), "#d97706");
    assert.equal(scoreColor(40), "#dc2626");
    assert.equal(scoreColor(null), "#4b5563");
  });

  test("seasonLabel formats", () => {
    assert.equal(seasonLabel("FALL", 2023), "Fall 2023");
    assert.equal(seasonLabel(null, 2023), "2023");
    assert.equal(seasonLabel(), "");
  });

  test("stripDescription removes html + entities", () => {
    assert.equal(
      stripDescription("A <b>mage</b> named Frieren.<br>Long life &amp; loss."),
      "A mage named Frieren.\nLong life & loss.",
    );
  });

  test("airedEpisodeCount caps at last aired", () => {
    // Airing: next ep 13 → 12 aired even if planned 24.
    assert.equal(
      airedEpisodeCount({
        episodes: 24,
        nextAiringEpisode: { episode: 13, airingAt: 0 },
      }),
      12,
    );
    // Finished: full count.
    assert.equal(
      airedEpisodeCount({ episodes: 28, nextAiringEpisode: null }),
      28,
    );
    assert.equal(
      airedEpisodeCount({ episodes: null, nextAiringEpisode: null }),
      0,
    );
  });

  test("episodeStreamMap keys by parsed episode number, not array index", () => {
    const map = episodeStreamMap([
      { title: "Episode 2 - Second", thumbnail: "t2" },
      { title: "Episode 1 - First", thumbnail: "t1" },
      { title: "Episode 3 - Third", thumbnail: "t3" },
    ]);
    assert.equal(map.get(1)?.thumbnail, "t1");
    assert.equal(map.get(2)?.thumbnail, "t2");
    assert.equal(map.get(3)?.thumbnail, "t3");
  });

  test("episodeStreamMap handles empty/sparse lists", () => {
    assert.equal(episodeStreamMap([]).size, 0);
    assert.equal(episodeStreamMap(null).size, 0);
    assert.equal(episodeStreamMap(undefined).size, 0);
    const m = episodeStreamMap([{ title: "Preview", thumbnail: "p" }]);
    assert.equal(m.get(1)?.thumbnail, "p");
  });

  test("cleanEpisodeTitle strips the Episode-N prefix", () => {
    assert.equal(cleanEpisodeTitle("Episode 12 - The Journey"), "The Journey");
    assert.equal(cleanEpisodeTitle("Episode 3: Reunion"), "Reunion");
    assert.equal(cleanEpisodeTitle("A Standalone Title"), "A Standalone Title");
    assert.equal(cleanEpisodeTitle(null), "");
  });

  test("isSingleVideo detects movies + one-shots", () => {
    assert.equal(isSingleVideo({ format: "MOVIE", episodes: 1 }), true);
    assert.equal(isSingleVideo({ format: "TV", episodes: 12 }), false);
    assert.equal(isSingleVideo({ format: "OVA", episodes: 1 }), true);
    assert.equal(isSingleVideo({ format: "TV", episodes: null }), true);
  });

  console.log(`\n✅ anilist client: ${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
