/*
 * Yozora API client tests (fake fetch — no network): URL/query construction,
 * auth header, the API-3 error envelope → YozoraApiError code mapping, and
 * baseUrl normalization. Pure; mirrors utils/yomifin/jimaku.test.ts.
 *
 * Run: bun utils/yozora/api.test.ts (or ./scripts/yomifin-test.sh)
 */
import assert from "node:assert/strict";
import {
  createYozoraClient,
  type FetchLike,
  normalizeBaseUrl,
  YozoraApiError,
} from "./api";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

interface Recorded {
  url: string;
  method?: string;
  auth?: string;
  contentType?: string;
  body?: string;
}

/** Records the outgoing request and returns a canned JSON body. */
function fakeFetch(status: number, body: unknown, sink: Recorded[]): FetchLike {
  return async (url, init) => {
    sink.push({
      url,
      method: init?.method,
      auth: init?.headers?.Authorization,
      contentType: init?.headers?.["Content-Type"],
      body: init?.body,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

async function main() {
  console.log("yozora api client");

  await test("normalizeBaseUrl strips trailing slash and /api/v1", () => {
    assert.equal(
      normalizeBaseUrl("https://y.example.com/"),
      "https://y.example.com",
    );
    assert.equal(
      normalizeBaseUrl("https://y.example.com/api/v1"),
      "https://y.example.com",
    );
    assert.equal(
      normalizeBaseUrl("https://y.example.com/api/v1/"),
      "https://y.example.com",
    );
    assert.equal(
      normalizeBaseUrl("http://10.0.0.5:38019"),
      "http://10.0.0.5:38019",
    );
  });

  await test("discoverAnime builds /api/v1 path, omits empty params", async () => {
    const calls: Recorded[] = [];
    const api = createYozoraClient({
      baseUrl: "https://y.example.com",
      token: "tok",
      fetch: fakeFetch(200, { items: [], page: 1, has_more: false }, calls),
    });
    await api.discoverAnime({ sort: "trending", q: "", page: 2 });
    assert.equal(
      calls[0].url,
      "https://y.example.com/api/v1/discover/anime?sort=trending&page=2",
    );
    assert.equal(calls[0].auth, "Bearer tok");
    assert.equal(calls[0].method, "GET");
  });

  await test("discoverAnime passes DSC-2 amendment params (tags/year range)", async () => {
    const calls: Recorded[] = [];
    const api = createYozoraClient({
      baseUrl: "https://y.example.com",
      token: "tok",
      fetch: fakeFetch(200, { items: [], page: 1, has_more: false }, calls),
    });
    await api.discoverAnime({
      sort: "popularity",
      tags: "Isekai,Time Travel",
      year_min: 2010,
      year_max: 2020,
    });
    assert.equal(
      calls[0].url,
      "https://y.example.com/api/v1/discover/anime?sort=popularity&tags=Isekai%2CTime%20Travel&year_min=2010&year_max=2020",
    );
  });

  await test("title_key is URL-encoded in the path", async () => {
    const calls: Recorded[] = [];
    const api = createYozoraClient({
      baseUrl: "https://y.example.com",
      fetch: fakeFetch(200, {}, calls),
    });
    await api.titleDetail("anilist:207141");
    assert.equal(
      calls[0].url,
      "https://y.example.com/api/v1/titles/anilist%3A207141",
    );
    // no token → no Authorization header
    assert.equal(calls[0].auth, undefined);
  });

  await test("resolve POSTs a JSON body with content-type", async () => {
    const calls: Recorded[] = [];
    const api = createYozoraClient({
      baseUrl: "https://y.example.com",
      token: "tok",
      fetch: fakeFetch(200, { url: "https://cdn/x", info_hash: "ab" }, calls),
    });
    await api.resolve({
      title_key: "anilist:1",
      episode: "5",
      info_hash: "abc",
    });
    assert.equal(calls[0].url, "https://y.example.com/api/v1/resolve");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].contentType, "application/json");
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
      title_key: "anilist:1",
      episode: "5",
      info_hash: "abc",
    });
  });

  await test("error envelope maps to YozoraApiError.code (RES-15)", async () => {
    const calls: Recorded[] = [];
    const api = createYozoraClient({
      baseUrl: "https://y.example.com",
      token: "tok",
      fetch: fakeFetch(
        409,
        { error: { code: "NOTHING_CACHED", message: "nothing cached" } },
        calls,
      ),
    });
    await assert.rejects(
      () => api.resolve({ title_key: "anilist:1" }),
      (e: unknown) => {
        assert.ok(e instanceof YozoraApiError);
        assert.equal(e.status, 409);
        assert.equal(e.code, "NOTHING_CACHED");
        return true;
      },
    );
  });

  await test("non-JSON error body falls back to HTTP_<status>", async () => {
    const api = createYozoraClient({
      baseUrl: "https://y.example.com",
      fetch: async () => ({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error("not json");
        },
        text: async () => "<html>bad gateway</html>",
      }),
    });
    await assert.rejects(
      () => api.me(),
      (e: unknown) => {
        assert.ok(e instanceof YozoraApiError);
        assert.equal(e.code, "HTTP_502");
        return true;
      },
    );
  });

  await test("network failure surfaces NETWORK_ERROR", async () => {
    const api = createYozoraClient({
      baseUrl: "https://y.example.com",
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await assert.rejects(
      () => api.health(),
      (e: unknown) => {
        assert.ok(e instanceof YozoraApiError);
        assert.equal(e.code, "NETWORK_ERROR");
        assert.equal(e.status, 0);
        return true;
      },
    );
  });

  await test("login POSTs credentials without a token header", async () => {
    const calls: Recorded[] = [];
    const api = createYozoraClient({
      baseUrl: "https://y.example.com/api/v1/", // exercise normalization
      fetch: fakeFetch(200, { token: "t", user: {}, device: {} }, calls),
    });
    await api.login("me", "pw", "Yomifin iPad");
    assert.equal(calls[0].url, "https://y.example.com/api/v1/auth/login");
    assert.equal(calls[0].auth, undefined);
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
      username: "me",
      password: "pw",
      device_name: "Yomifin iPad",
    });
  });

  await test("subtitleUrl builds an absolute cached-file URL (+vtt)", () => {
    const api = createYozoraClient({ baseUrl: "https://y.example.com" });
    assert.equal(
      api.subtitleUrl(42),
      "https://y.example.com/api/v1/subtitles/42",
    );
    assert.equal(
      api.subtitleUrl(42, { format: "vtt" }),
      "https://y.example.com/api/v1/subtitles/42?format=vtt",
    );
  });

  await test("markWatched/continueWatching hit the right verbs+paths", async () => {
    const calls: Recorded[] = [];
    const api = createYozoraClient({
      baseUrl: "https://y.example.com",
      token: "tok",
      fetch: fakeFetch(200, { items: [], page: 1, has_more: false }, calls),
    });
    await api.continueWatching(3);
    await api.markWatched("anilist:1", "5");
    assert.equal(
      calls[0].url,
      "https://y.example.com/api/v1/continue-watching?page=3",
    );
    assert.equal(
      calls[1].url,
      "https://y.example.com/api/v1/titles/anilist%3A1/watched",
    );
    assert.equal(calls[1].method, "POST");
    assert.deepEqual(JSON.parse(calls[1].body ?? "{}"), { episode: "5" });
  });

  await test("discoverMovies/shows + shelves + library paths", async () => {
    const calls: Recorded[] = [];
    const api = createYozoraClient({
      baseUrl: "https://y.example.com",
      token: "tok",
      fetch: fakeFetch(200, { items: [], page: 1, has_more: false }, calls),
    });
    await api.discoverMovies({ sort: "trending", page: 2 });
    await api.discoverShows({ genres: "18,35", min_rating: 7 });
    await api.shelves();
    await api.shelfItems("3:anime:kitsu-anime-trending", 2);
    await api.library();
    await api.libraryHistory(4);
    await api.hideTitle("tmdb:movie:603");
    await api.unhideTitle("tmdb:movie:603");
    assert.equal(
      calls[0].url,
      "https://y.example.com/api/v1/discover/movies?sort=trending&page=2",
    );
    assert.equal(
      calls[1].url,
      "https://y.example.com/api/v1/discover/shows?genres=18%2C35&min_rating=7",
    );
    assert.equal(calls[2].url, "https://y.example.com/api/v1/shelves");
    assert.equal(
      calls[3].url,
      "https://y.example.com/api/v1/shelves/3%3Aanime%3Akitsu-anime-trending/items?page=2",
    );
    assert.equal(calls[4].url, "https://y.example.com/api/v1/library");
    assert.equal(
      calls[5].url,
      "https://y.example.com/api/v1/library/history?page=4",
    );
    assert.equal(
      calls[6].url,
      "https://y.example.com/api/v1/titles/tmdb%3Amovie%3A603/hide",
    );
    assert.equal(calls[6].method, "POST");
    assert.equal(calls[7].method, "DELETE");
  });

  await test("subtitleContent GETs raw text with auth; syncSubtitle POSTs", async () => {
    const calls: Recorded[] = [];
    let api = createYozoraClient({
      baseUrl: "https://y.example.com",
      token: "tok",
      fetch: async (url, init) => {
        calls.push({
          url,
          method: init?.method,
          auth: init?.headers?.Authorization,
          body: init?.body,
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => "1\n00:00:01,000 --> 00:00:02,000\nhello",
        };
      },
    });
    const text = await api.subtitleContent(42);
    assert.match(text, /hello/);
    assert.equal(calls[0].url, "https://y.example.com/api/v1/subtitles/42");
    assert.equal(calls[0].auth, "Bearer tok");

    api = createYozoraClient({
      baseUrl: "https://y.example.com",
      token: "tok",
      fetch: fakeFetch(200, { id: 43, provider: "sync" }, calls),
    });
    await api.syncSubtitle(42, "https://cdn/x.mkv");
    assert.equal(
      calls[1].url,
      "https://y.example.com/api/v1/subtitles/42/sync",
    );
    assert.equal(calls[1].method, "POST");
    assert.deepEqual(JSON.parse(calls[1].body ?? "{}"), {
      stream_url: "https://cdn/x.mkv",
    });
    await api.syncSubtitle(42);
    assert.deepEqual(JSON.parse(calls[2].body ?? "{}"), {});
  });

  console.log(`\n${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
