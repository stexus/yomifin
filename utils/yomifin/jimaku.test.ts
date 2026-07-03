/*
 * jimaku.cc client tests (fake fetch — no network): request shape (URL, auth
 * header), error mapping, and file-list sorting.
 *
 * Run: bun utils/yomifin/jimaku.test.ts (or ./scripts/yomifin-test.sh)
 */
import assert from "node:assert/strict";
import {
  type FetchLike,
  isSubtitleFileName,
  listJimakuFiles,
  searchJimakuEntries,
} from "./jimaku";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function fakeFetch(
  expected: { url: string; auth: string },
  status: number,
  body: unknown,
  calls: string[] = [],
): FetchLike {
  return async (url, init) => {
    calls.push(url);
    assert.equal(url, expected.url);
    assert.equal(init?.headers?.Authorization, expected.auth);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

await test("searchJimakuEntries: query param + auth header", async () => {
  const entries = [{ id: 7, name: "Sousou no Frieren" }];
  const res = await searchJimakuEntries(
    "KEY123",
    { query: "frieren" },
    fakeFetch(
      {
        url: "https://jimaku.cc/api/entries/search?query=frieren",
        auth: "KEY123",
      },
      200,
      entries,
    ),
  );
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 7);
});

await test("searchJimakuEntries: anilist_id param preferred alongside query", async () => {
  await searchJimakuEntries(
    "K",
    { anilistId: 154587, query: "frieren" },
    fakeFetch(
      {
        url: "https://jimaku.cc/api/entries/search?anilist_id=154587&query=frieren",
        auth: "K",
      },
      200,
      [],
    ),
  );
});

await test("listJimakuFiles: episode filter + subtitle files sorted first", async () => {
  const files = [
    { url: "u1", name: "fonts.zip" },
    { url: "u2", name: "ep01.srt" },
    { url: "u3", name: "ep01.ass" },
  ];
  const res = await listJimakuFiles(
    "K",
    7,
    1,
    fakeFetch(
      { url: "https://jimaku.cc/api/entries/7/files?episode=1", auth: "K" },
      200,
      files,
    ),
  );
  assert.deepEqual(
    res.map((f) => f.name),
    ["ep01.ass", "ep01.srt", "fonts.zip"],
  );
});

await test("auth errors map to a clear message", async () => {
  await assert.rejects(
    () =>
      searchJimakuEntries(
        "BAD",
        { query: "x" },
        fakeFetch(
          { url: "https://jimaku.cc/api/entries/search?query=x", auth: "BAD" },
          401,
          {},
        ),
      ),
    /rejected the API key/,
  );
});

await test("missing API key throws before any network call", async () => {
  const calls: string[] = [];
  await assert.rejects(
    () =>
      searchJimakuEntries(
        "",
        { query: "x" },
        fakeFetch({ url: "n/a", auth: "n/a" }, 200, [], calls),
      ),
    /API key not set/,
  );
  assert.equal(calls.length, 0);
});

await test("isSubtitleFileName", () => {
  assert.ok(isSubtitleFileName("ep01.ass"));
  assert.ok(isSubtitleFileName("EP01.SRT"));
  assert.ok(isSubtitleFileName("a.vtt"));
  assert.ok(!isSubtitleFileName("fonts.zip"));
  assert.ok(!isSubtitleFileName("readme"));
});

console.log(`\njimaku: all ${passed} tests passed`);
