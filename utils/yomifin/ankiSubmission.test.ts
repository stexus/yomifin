import { afterAll, describe, expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
import type { CardData } from "./anki";
import type { AnkiConfig } from "./ankiConfig";

const require = createRequire(import.meta.url);
const frozenConfig: AnkiConfig = {
  url: "http://anki-original",
  deckName: "Original deck",
  modelName: "Original model",
  fieldTemplates: {
    Expression: "{expression}",
    Sentence: "{sentence}",
    Audio: "{sentence-audio}",
    Image: "{picture}",
  },
  tags: [],
  allowDuplicate: false,
  htmlGlossary: false,
  wordAudioSources: [],
};
const getAnkiConfig = mock(() => ({
  ...frozenConfig,
  url: "http://anki-changed",
  deckName: "Changed deck",
}));
mock.module(require.resolve("./ankiConfig"), () => ({ getAnkiConfig }));
const { addAnkiCard } = await import("./anki");
const originalFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});

function card(): CardData {
  return {
    result: {
      matchedText: "猫",
      matchedLength: 1,
      entries: [
        {
          term: "猫",
          reading: "ねこ",
          wordClasses: [],
          inflectionChain: [],
          definitions: [],
        },
      ],
    },
    activeIndex: 0,
    sentence: "猫です",
    media: {
      imageFilename: "frozen.jpg",
      imageBase64: "image",
      audioFilename: "frozen.m4a",
      audioBase64: "audio",
    },
  };
}

describe("frozen card submission", () => {
  test("submission uses Add-time settings and reports failed media without broken references", async () => {
    const requests: Array<{ url: string; action: string; params: any }> = [];
    globalThis.fetch = (async (url, init) => {
      const request = JSON.parse(String(init?.body));
      requests.push({ url: String(url), ...request });
      const failedAudio =
        request.action === "storeMediaFile" &&
        request.params.filename === "frozen.m4a";
      return Response.json({
        result: failedAudio
          ? null
          : request.action === "addNote"
            ? 123
            : request.params.filename,
        error: failedAudio ? "upload failed" : null,
      });
    }) as typeof fetch;
    const data = card();
    const outcome = await addAnkiCard(data, frozenConfig);
    expect(getAnkiConfig).not.toHaveBeenCalled();
    expect(requests.every((request) => request.url === frozenConfig.url)).toBe(
      true,
    );
    expect(requests.map((request) => request.action)).toEqual([
      "storeMediaFile",
      "storeMediaFile",
      "addNote",
    ]);
    const note = requests.at(-1)!.params.note;
    expect(note.deckName).toBe("Original deck");
    expect(note.modelName).toBe("Original model");
    expect(note.fields.Sentence).toBe("猫です");
    expect(note.fields.Audio).toBe("");
    expect(note.fields.Image).toContain("frozen.jpg");
    expect(outcome).toEqual({ noteId: 123, missingMedia: ["sentence audio"] });
    expect(data.media?.audioFilename).toBe("frozen.m4a");
  });

  test("missing capture still adds text exactly once", async () => {
    const requests: any[] = [];
    globalThis.fetch = (async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      requests.push(request);
      return Response.json({ result: 456, error: null });
    }) as typeof fetch;
    const outcome = await addAnkiCard(
      { ...card(), media: undefined },
      frozenConfig,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].action).toBe("addNote");
    expect(requests[0].params.note.fields.Sentence).toBe("猫です");
    expect(outcome).toEqual({
      noteId: 456,
      missingMedia: ["sentence audio", "image"],
    });
  });
});
