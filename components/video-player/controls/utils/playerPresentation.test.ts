import { describe, expect, test } from "bun:test";
import {
  bufferedPositionMs,
  clampPositionMs,
  nativeTrackLabel,
  playerProfileHint,
  playerTitle,
} from "./playerPresentation";

describe("shared player presentation", () => {
  test("buffer telemetry converts seconds to ms and clears a depleted buffer", () => {
    expect(bufferedPositionMs(10, 25, 60)).toBe(35_000);
    expect(bufferedPositionMs(20, 0, 60)).toBe(20_000);
    expect(bufferedPositionMs(50, 25, 60)).toBe(60_000);
    expect(bufferedPositionMs(10, Number.NaN, 0)).toBe(10_000);
  });
  test("seek clamps endpoints without blocking streams of unknown duration", () => {
    expect(clampPositionMs(-1000, 30_000)).toBe(0);
    expect(clampPositionMs(40_000, 30_000)).toBe(30_000);
    expect(clampPositionMs(40_000, 0)).toBe(40_000);
    expect(clampPositionMs(Number.NaN, 30_000)).toBe(0);
  });
  test("native track labels distinguish language and subtitle format", () => {
    expect(
      nativeTrackLabel({ id: 1, title: "Full", lang: "jpn", codec: "ass" }),
    ).toBe("jpn · Full · ASS");
    expect(
      nativeTrackLabel({
        id: 2,
        title: "Full",
        lang: "zho",
        codec: "hdmv_pgs_subtitle",
      }),
    ).toBe("zho · Full · HDMV_PGS_SUBTITLE");
    expect(nativeTrackLabel({ id: 3 })).toBe("Track 3");
  });
  test("episode titles preserve zero seasons and missing metadata", () => {
    expect(
      playerTitle({
        Type: "Episode",
        SeriesName: "Series",
        ParentIndexNumber: 0,
        IndexNumber: 1,
        Name: "Special",
      }),
    ).toBe("Series  ·  S00E01  ·  Special");
    expect(playerTitle({ Type: "Episode", IndexNumber: 2 })).toBe("E02");
    expect(playerTitle({ Name: "Movie" })).toBe("Movie");
  });
  test("subtitle language takes precedence over audio in either player", () => {
    expect(
      playerProfileHint({ subtitleLanguage: "zh-Hans", audioLanguage: "ja" }),
    ).toBe("zh");
    expect(playerProfileHint({ audioLanguage: "jpn" })).toBe("ja");
    expect(
      playerProfileHint({
        externalSubtitle: { language: "zh" },
        audioLanguage: "ja",
      }),
    ).toBe("zh");
    expect(
      playerProfileHint({
        externalSubtitle: {},
        subtitleLanguage: "ja",
        audioLanguage: "ja",
      }),
    ).toBeNull();
  });
});
