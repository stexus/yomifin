/*
 * Yozora display-helper tests (pure, offline).
 * Run: bun utils/yozora/display.test.ts (or ./scripts/yomifin-test.sh)
 */
import assert from "node:assert/strict";
import {
  cwSubtitle,
  describeSourcesError,
  displayTitle,
  episodeLabel,
  formatBytes,
  jimakuTitle,
  movieProgress,
  parseTitleKey,
  progressByEpisode,
  progressFraction,
  ratingPercent,
  relativeAirTime,
  runtimeLabel,
  scoreColor,
  sourceMetaLine,
} from "./display";
import type { ContinueWatchingItem, Source } from "./types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("yozora display helpers");

test("parseTitleKey recognizes the three canonical shapes", () => {
  assert.deepEqual(parseTitleKey("anilist:207141"), {
    kind: "anime",
    anilistId: 207141,
  });
  assert.deepEqual(parseTitleKey("tmdb:movie:603"), {
    kind: "movie",
    anilistId: null,
  });
  assert.deepEqual(parseTitleKey("tmdb:show:1396"), {
    kind: "show",
    anilistId: null,
  });
  assert.equal(parseTitleKey("garbage").kind, "unknown");
});

test("displayTitle picks per language with fallbacks", () => {
  const t = {
    title: "Sousou no Frieren",
    titles: {
      romaji: "Sousou no Frieren",
      english: "Frieren: Beyond Journey's End",
      native: "葬送のフリーレン",
    },
  };
  assert.equal(displayTitle(t, "romaji"), "Sousou no Frieren");
  assert.equal(displayTitle(t, "english"), "Frieren: Beyond Journey's End");
  assert.equal(displayTitle(t, "native"), "葬送のフリーレン");
  // no titles object (tmdb) → server title
  assert.equal(displayTitle({ title: "The Matrix" }, "native"), "The Matrix");
  // missing rendition falls back
  assert.equal(
    displayTitle(
      { title: "X", titles: { romaji: "R", english: null, native: null } },
      "english",
    ),
    "R",
  );
});

test("jimakuTitle prefers romaji/native over english", () => {
  assert.equal(
    jimakuTitle({
      title: "t",
      titles: { romaji: null, english: "E", native: "N" },
    }),
    "N",
  );
  assert.equal(jimakuTitle({ title: "Movie" }), "Movie");
});

test("ratingPercent + scoreColor thresholds", () => {
  assert.equal(ratingPercent(8.6), 86);
  assert.equal(ratingPercent(null), null);
  assert.equal(ratingPercent(0), null);
  assert.equal(scoreColor(86), "#16a34a");
  assert.equal(scoreColor(65), "#d97706");
  assert.equal(scoreColor(40), "#dc2626");
  assert.equal(scoreColor(null), "#4b5563");
});

test("formatBytes", () => {
  assert.equal(formatBytes(null), "");
  assert.equal(formatBytes(1.5 * 1024 ** 3), "1.5 GB");
  assert.equal(formatBytes(15 * 1024 ** 3), "15 GB");
  assert.equal(formatBytes(500 * 1024 ** 2), "500 MB");
});

test("sourceMetaLine composes the badge line", () => {
  const s: Source = {
    info_hash: "ab",
    name: "Some.Release.1080p",
    addon: "torrentio",
    size_bytes: 2 * 1024 ** 3,
    seeders: 120,
    file_idx: null,
    cached: true,
    parsed: {
      resolution: "1080p",
      quality_class: "webdl",
      codec: "hevc",
      audio: ["aac"],
      hdr: [],
      dv_profile5_suspect: false,
      group: "SubsPlease",
      langs: ["ja"],
      season_pack: false,
    },
  };
  assert.equal(
    sourceMetaLine(s),
    "1080p · WEBDL · HEVC · 2.0 GB · 120 seeders",
  );
});

test("describeSourcesError covers RES-15 codes", () => {
  assert.match(describeSourcesError("NO_MAPPING"), /No sources yet/);
  assert.match(describeSourcesError("NOTHING_CACHED"), /cached/);
  assert.match(describeSourcesError("SOMETHING_ELSE"), /SOMETHING_ELSE/);
});

test("progress helpers", () => {
  assert.equal(progressFraction(600, 1200), 0.5);
  assert.equal(progressFraction(0, 1200), null);
  assert.equal(progressFraction(600, null), null);
  assert.equal(progressFraction(2000, 1200), 1);
  const items = [
    {
      episode: "5",
      position_sec: 100,
      duration_sec: 1400,
      state: "in_progress" as const,
      updated_at: "2026-01-01",
    },
    {
      episode: null,
      position_sec: 500,
      duration_sec: 7000,
      state: "in_progress" as const,
      updated_at: "2026-01-01",
    },
  ];
  assert.equal(progressByEpisode(items).get("5")?.position_sec, 100);
  assert.equal(progressByEpisode(items).size, 1);
  assert.equal(movieProgress(items)?.position_sec, 500);
});

test("cwSubtitle per kind", () => {
  const base = {
    title: { title_key: "anilist:1" } as ContinueWatchingItem["title"],
    updated_at: "2026-01-01",
  };
  assert.equal(
    cwSubtitle({
      ...base,
      kind: "resume",
      episode: "5",
      position_sec: 600,
      duration_sec: 1200,
    }),
    "Ep 5 · Resume · 50%",
  );
  assert.equal(
    cwSubtitle({
      ...base,
      kind: "next_up",
      episode: "2:3",
      position_sec: 0,
      duration_sec: null,
    }),
    "Ep 2×3 · Next up",
  );
  assert.equal(
    cwSubtitle({
      ...base,
      kind: "sequel",
      episode: null,
      position_sec: 0,
      duration_sec: null,
    }),
    "Sequel",
  );
});

test("relativeAirTime countdown", () => {
  const now = new Date("2026-07-15T00:00:00Z");
  assert.equal(relativeAirTime("2026-07-17T04:30:00Z", now), "Airs in 2d 4h");
  assert.equal(relativeAirTime("2026-07-15T01:30:00Z", now), "Airs in 1h 30m");
  assert.equal(relativeAirTime("2026-07-14T00:00:00Z", now), "Airing now");
  assert.equal(relativeAirTime(null, now), "Waiting");
});

test("episodeLabel + runtimeLabel", () => {
  assert.equal(episodeLabel("12"), "Episode 12");
  assert.equal(episodeLabel("2:5"), "S2 E5");
  assert.equal(episodeLabel(null), "");
  assert.equal(runtimeLabel(135), "2h 15m");
  assert.equal(runtimeLabel(24), "24m");
});

console.log(`\n${passed} passed`);
