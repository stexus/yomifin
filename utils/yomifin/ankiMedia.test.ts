import { describe, expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
import type { CaptureContext, MediaCapturer } from "./ankiMedia";

// Exercise the real capture/cache code with controllable native operations.
const files = new Map<string, string>();
class MemoryFile {
  uri: string;
  constructor(directory: string, filename: string) {
    this.uri = `${directory}/${filename}`;
  }
  get path() {
    return this.uri.replace(/^file:\/\//, "");
  }
  get exists() {
    return files.has(this.path);
  }
  delete() {
    files.delete(this.path);
  }
  async base64() {
    return files.get(this.path)!;
  }
}
const require = createRequire(import.meta.url);
mock.module(require.resolve("expo-file-system"), () => ({
  File: MemoryFile,
  Paths: { cache: "file:///capture-test" },
}));
const { prepareCardMedia } = await import("./ankiMedia");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function context(id: string): CaptureContext {
  return {
    cueStart: 10,
    cueEnd: 16,
    framePos: 12,
    source: {
      id,
      url: "https://source/episode.mkv",
      headers: { Authorization: "original" },
    },
  };
}
function capturer(imageGate = Promise.resolve()) {
  let selectedTrack = 1;
  const getCurrentAudioTrack = mock(async () => selectedTrack);
  const captureScreenshot = mock(
    async (
      path: string,
      url: string,
      pos: number,
      headers: Record<string, string>,
    ) => {
      await imageGate;
      files.set(path, JSON.stringify({ url, pos, headers }));
      return true;
    },
  );
  const extractAudio = mock(
    async (
      start: number,
      end: number,
      audioId: number,
      path: string,
      url: string,
      headers: Record<string, string>,
    ) => {
      files.set(path, JSON.stringify({ start, end, audioId, url, headers }));
      return true;
    },
  );
  const player: MediaCapturer = {
    getCurrentAudioTrack,
    captureScreenshot,
    extractAudio,
  };
  return {
    player,
    getCurrentAudioTrack,
    captureScreenshot,
    extractAudio,
    selectTrack: (id: number) => {
      selectedTrack = id;
    },
  };
}

describe("card capture stays fixed after Add", () => {
  test("resume, seek and another lookup during the spinner and screenshot cannot alter the card", async () => {
    const gate = deferred();
    const native = capturer(gate.promise);
    const ctx = context("resume-original");
    const want = { image: true, audio: true };
    const capture = prepareCardMedia(native.player, ctx, want);
    expect(native.getCurrentAudioTrack).toHaveBeenCalledTimes(1);
    expect(native.captureScreenshot).not.toHaveBeenCalled();

    // Changes while the UI yields to paint its spinner.
    native.selectTrack(2);
    ctx.cueStart = 30;
    ctx.cueEnd = 34;
    ctx.framePos = 31;
    ctx.source.url = "https://source/other.mkv";
    ctx.source.headers.Authorization = "new";
    want.audio = false;
    const first = capture();
    // A second lookup/card can finish independently while the first is capturing.
    const secondCtx = context("resume-original");
    secondCtx.cueStart = 40;
    secondCtx.cueEnd = 44;
    const second = await prepareCardMedia(native.player, secondCtx, {
      image: false,
      audio: true,
    })();
    expect(JSON.parse(second.audioBase64!)).toMatchObject({
      start: 40,
      end: 44,
      audioId: 2,
    });
    gate.resolve();
    const media = await first;
    expect(JSON.parse(media.imageBase64!)).toEqual({
      url: "https://source/episode.mkv",
      pos: 12,
      headers: { Authorization: "original" },
    });
    expect(JSON.parse(media.audioBase64!)).toEqual({
      start: 10,
      end: 16,
      audioId: 1,
      url: "https://source/episode.mkv",
      headers: { Authorization: "original" },
    });
    expect(native.getCurrentAudioTrack).toHaveBeenCalledTimes(2);
  });

  test("a later track or source version gets distinct media and filenames", async () => {
    const native = capturer();
    const ctx = context("track-cache");
    const first = await prepareCardMedia(native.player, ctx)();
    native.selectTrack(2);
    const second = await prepareCardMedia(native.player, ctx)();
    expect(second.audioFilename).not.toBe(first.audioFilename);
    expect(JSON.parse(second.audioBase64!).audioId).toBe(2);
    expect(second.imageFilename).toBe(first.imageFilename);
    const nextVersion = {
      ...ctx,
      source: {
        ...ctx.source,
        id: "track-cache/version-2",
        url: "https://source/version-2.mkv",
      },
    };
    const third = await prepareCardMedia(native.player, nextVersion)();
    expect(third.imageFilename).not.toBe(first.imageFilename);
    expect(third.audioFilename).not.toBe(second.audioFilename);
    expect(JSON.parse(third.audioBase64!).url).toBe(nextVersion.source.url);
  });

  test("the mapped original-file track overrides a transcode's single playback track", async () => {
    const native = capturer();
    const media = await prepareCardMedia(
      native.player,
      context("transcode"),
      { image: false, audio: true },
      3,
    )();
    expect(native.getCurrentAudioTrack).not.toHaveBeenCalled();
    expect(JSON.parse(media.audioBase64!).audioId).toBe(3);
  });

  test("unknown audio identity omits audio rather than extracting a different track", async () => {
    const native = capturer();
    const media = await prepareCardMedia(
      native.player,
      context("unknown"),
      { image: true, audio: true },
      null,
    )();
    expect(media.imageFilename).toBeDefined();
    expect(media.audioFilename).toBeUndefined();
    expect(native.getCurrentAudioTrack).not.toHaveBeenCalled();
    expect(native.extractAudio).not.toHaveBeenCalled();
  });

  test("offline files use the frozen file URL and requested fields gate native work", async () => {
    const native = capturer();
    const ctx = context("offline");
    ctx.source.url = "file:///downloads/original.mkv";
    const media = await prepareCardMedia(native.player, ctx, {
      image: true,
      audio: false,
    })();
    expect(JSON.parse(media.imageBase64!).url).toBe(
      "file:///downloads/original.mkv",
    );
    expect(native.getCurrentAudioTrack).not.toHaveBeenCalled();
    expect(native.extractAudio).not.toHaveBeenCalled();
  });

  test("a failed track read still captures the image without selecting arbitrary audio", async () => {
    const native = capturer();
    native.getCurrentAudioTrack.mockRejectedValueOnce(
      new Error("player unavailable"),
    );
    const media = await prepareCardMedia(
      native.player,
      context("track-read-failure"),
    )();
    expect(media.imageFilename).toBeDefined();
    expect(media.audioFilename).toBeUndefined();
    expect(native.extractAudio).not.toHaveBeenCalled();
  });

  test("in-flight dedup survives more captures than the settled cache limit", async () => {
    const gate = deferred();
    const native = capturer(gate.promise);
    const ctx = context("pending-first");
    const first = prepareCardMedia(native.player, ctx, {
      image: true,
      audio: false,
    })();
    const others = Array.from({ length: 14 }, (_, i) =>
      prepareCardMedia(native.player, context(`pending-${i}`), {
        image: true,
        audio: false,
      })(),
    );
    const repeated = prepareCardMedia(native.player, ctx, {
      image: true,
      audio: false,
    })();
    gate.resolve();
    const [original, duplicate] = await Promise.all([
      first,
      repeated,
      ...others,
    ]);
    expect(duplicate).toEqual(original);
    expect(native.captureScreenshot).toHaveBeenCalledTimes(15);
  });
});
