/*
 * Yozora filter-model tests (pure, offline).
 * Run: bun utils/yozora/filters.test.ts (or ./scripts/yomifin-test.sh)
 */
import assert from "node:assert/strict";
import {
  animeFilterSummary,
  hasActiveAnimeFilters,
  hasActiveTmdbFilters,
  tmdbFilterSummary,
  toAnimeQuery,
  toDiscoverQuery,
} from "./filters";
import { TMDB_MOVIE_GENRES } from "./types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("yozora filter models");

test("toAnimeQuery joins arrays, drops empties", () => {
  assert.deepEqual(
    toAnimeQuery(
      {
        sort: "popularity",
        genres: ["Action", "Drama"],
        tags: ["Isekai"],
        yearMin: 2010,
        yearMax: 2020,
        q: "  ",
      },
      2,
    ),
    {
      page: 2,
      sort: "popularity",
      q: undefined,
      season: undefined,
      year_min: 2010,
      year_max: 2020,
      status: undefined,
      format: undefined,
      genres: "Action,Drama",
      tags: "Isekai",
    },
  );
});

test("hasActiveAnimeFilters ignores bare sort", () => {
  assert.equal(hasActiveAnimeFilters({ sort: "trending" }), false);
  assert.equal(
    hasActiveAnimeFilters({ sort: "trending", tags: ["Isekai"] }),
    true,
  );
  assert.equal(hasActiveAnimeFilters({ q: "frieren" }), true);
});

test("animeFilterSummary composes human line", () => {
  assert.equal(
    animeFilterSummary({
      q: "frieren",
      season: "fall",
      yearMin: 2023,
      yearMax: 2023,
      genres: ["Fantasy"],
    }),
    "“frieren” · Fall 2023 · Fantasy",
  );
});

test("toDiscoverQuery: q is exclusive with filters (server rule)", () => {
  assert.deepEqual(
    toDiscoverQuery({ q: "matrix", genreIds: [28], minRating: 7 }, 1),
    { page: 1, q: "matrix" },
  );
  assert.deepEqual(
    toDiscoverQuery({ sort: "rating", genreIds: [28, 18], yearMin: 1990 }, 3),
    {
      page: 3,
      sort: "rating",
      genres: "28,18",
      year_min: 1990,
      year_max: undefined,
      min_rating: undefined,
    },
  );
});

test("tmdb summary + active detection", () => {
  assert.equal(hasActiveTmdbFilters({ sort: "trending" }), false);
  assert.equal(hasActiveTmdbFilters({ minRating: 7 }), true);
  assert.equal(
    tmdbFilterSummary(
      { genreIds: [28, 35], yearMin: 1990, yearMax: 1999, minRating: 7 },
      TMDB_MOVIE_GENRES,
    ),
    "1990–1999 · ≥ 7★ · Action, Comedy",
  );
});

console.log(`\n${passed} passed`);
