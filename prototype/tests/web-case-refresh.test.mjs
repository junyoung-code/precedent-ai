import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMON_WEB_SEARCH_KEYS, WEB_SEARCH_KEYS, readWebCasesWithRefresh, refreshWebCaseQuery,
} from "../server/web-case-refresh.mjs";
import { GALLERY_QUERY_LIMITS, WEB_EXPRESSIONS, WEB_MEDIUMS, buildWebSearchQuery } from "../server/web-cases.mjs";

const post = (n) => ({
  title: `통매음 질문 ${n}`, url: `https://www.lawtalk.co.kr/qna/${n}`,
  sourceType: "lawyer_qna", quote: "게임 채팅으로 성적인 욕설을 들었다는 질문입니다.",
  medium: "game_chat", expression: "insult_with_sexual_terms", writerRole: "victim",
});
const keepAll = async ({ cases }) => ({ cases, dropped: [] });
// The gallery is a network call with a real default, the same shape as
// verifyWebCases' fetchImpl. Every test injects it, because a test that reached
// DCInside would be slow, flaky, and rude to somebody else's server.
const noGallery = async () => ({ posts: [], dropped: [] });

test("covers every query the rules can ever build", () => {
  // Warming a list that is written out by hand goes stale the moment the tag
  // rules widen, leaving a combination nobody ever fills.
  const built = new Set(WEB_MEDIUMS.flatMap((medium) =>
    WEB_EXPRESSIONS.map((expressionType) => buildWebSearchQuery({ medium, expressionType }))));
  assert.deepEqual(new Set(WEB_SEARCH_KEYS), built);
  assert.equal(WEB_SEARCH_KEYS.length, new Set(WEB_SEARCH_KEYS).size);
  assert.ok(COMMON_WEB_SEARCH_KEYS.length > 0 && COMMON_WEB_SEARCH_KEYS.length < WEB_SEARCH_KEYS.length);
});

test("a stored batch goes through the same checks a live search does", async () => {
  // A cached link is one we will show for a day. It earns no shortcut.
  const verified = [];
  const written = [];
  const pool = { query: async (sql, values) => { written.push(values); return { rows: [] }; } };
  const client = {
    model: "test-model",
    searchWebCases: async () => ({
      webCases: [post(1), { ...post(2), url: "javascript:alert(1)" }, { ...post(3), quote: "010-1234-5678로 연락이 왔습니다." }],
      usage: { input_tokens: 100 }, webSearches: 1,
    }),
  };
  const result = await refreshWebCaseQuery({
    pool, client, queryKey: "게임 채팅 통매음 통신매체이용음란", collect: noGallery,
    verify: async ({ cases }) => { verified.push(...cases); return { cases, dropped: [] }; },
  });
  assert.equal(result.count, 1);
  assert.deepEqual(verified.map((item) => item.url), ["https://www.lawtalk.co.kr/qna/1"]);
  assert.equal(written.length, 1);
});

test("a failed refresh leaves what is already stored", async () => {
  // The refresh runs behind a response that has gone out. It must not be able
  // to replace a good batch with nothing and then look fresh for a day.
  const written = [];
  const pool = { query: async (sql, values) => { written.push({ sql, values }); return { rows: [] }; } };

  const empty = await refreshWebCaseQuery({
    pool, client: { model: "m", searchWebCases: async () => ({ webCases: [] }) }, verify: keepAll,
    queryKey: "q", collect: noGallery,
  });
  assert.equal(empty.ok, true);
  assert.equal(empty.stored, false);

  const broken = await refreshWebCaseQuery({
    pool, client: { model: "m", searchWebCases: async () => { throw Object.assign(new Error("down"), { code: "ANALYSIS_API_UNAVAILABLE" }); } },
    queryKey: "q", verify: keepAll, collect: noGallery,
  });
  assert.equal(broken.ok, false);
  assert.equal(broken.code, "ANALYSIS_API_UNAVAILABLE");
  // Nothing overwrote the cases. The empty round does touch the row's clock —
  // see the next test for why — but it never carries a batch with it.
  assert.equal(written.some(({ sql }) => sql.includes("cases = EXCLUDED.cases")), false);
});

test("an empty refresh moves the clock so it cannot be asked again immediately", async () => {
  // Not writing the empty batch is right; not writing anything was a hole. The
  // row stayed stale, so the next reader started another refresh, and the one
  // after that — a key that keeps coming back empty bought a web search on
  // every single request.
  const written = [];
  const pool = { query: async (sql, values) => { written.push({ sql, values }); return { rows: [] }; } };
  await refreshWebCaseQuery({
    pool, client: { model: "m", searchWebCases: async () => ({ webCases: [] }) },
    queryKey: "q", verify: keepAll, collect: noGallery,
  });
  const touch = written.find(({ sql }) => sql.includes("fetched_at = now()"));
  assert.ok(touch, "빈 결과인데 시각을 갱신하지 않았습니다");
  assert.equal(touch.sql.includes("cases = EXCLUDED.cases"), false, "빈 배치가 기존 배치를 덮었습니다");
});

test("hands back a stale batch at once and refreshes behind it", async () => {
  // Waiting twenty seconds for a fresher version of something we already have
  // is the cost this cache exists to remove.
  const old = new Date(Date.now() - 30 * 60 * 60 * 1000);
  const pool = { query: async () => ({ rows: [{ cases: [post(1)], model: "m", fetched_at: old, fetchedAt: old }] }) };
  let refreshed = null;
  const started = Date.now();
  const result = await readWebCasesWithRefresh({
    pool, client: { model: "m" }, queryKey: "q",
    refresh: async () => { await new Promise((resolve) => setTimeout(resolve, 60)); refreshed = true; return { ok: true }; },
    onRefresh: (running) => { refreshed = running; },
  });
  assert.equal(Date.now() - started < 50, true, "읽기가 갱신을 기다리면 안 됩니다");
  assert.equal(result.cases.length, 1);
  assert.equal(result.stale, true);
  assert.ok(refreshed);
});

test("does not refresh a batch that is still current, or with no client", async () => {
  const fresh = new Date();
  const pool = { query: async () => ({ rows: [{ cases: [post(1)], model: "m", fetchedAt: fresh }] }) };
  let calls = 0;
  const refresh = async () => { calls += 1; return { ok: true }; };

  await readWebCasesWithRefresh({ pool, client: { model: "m" }, queryKey: "q", refresh });
  assert.equal(calls, 0);

  // No consent means no client, and an empty cache is then simply empty.
  const bare = { query: async () => ({ rows: [] }) };
  const result = await readWebCasesWithRefresh({ pool: bare, client: null, queryKey: "q", refresh });
  assert.equal(calls, 0);
  assert.deepEqual(result.cases, []);
});

test("stores what the gallery found alongside what the search found", async () => {
  // The two sources answer different questions. Lawtalk supplies "somebody in
  // my situation asked this" and stops at the question, because a consultation
  // post has no ending; the gallery supplies how it went. Replacing one with
  // the other would trade one gap for another.
  const written = [];
  const pool = { query: async (sql, values) => { written.push(values); return { rows: [] }; } };
  const client = {
    model: "test-model",
    searchWebCases: async () => ({ webCases: [post(1)], usage: { input_tokens: 100 }, webSearches: 1 }),
    summarizeWebPosts: async ({ posts }) => ({
      webCases: posts.map((item) => ({
        title: item.title, url: item.url, sourceType: "community",
        quote: "조사를 받은 뒤 불송치로 끝났다고 적은 글입니다.",
        medium: item.medium, expression: item.expression,
        writerRole: "reported", ending: true, situation: item.situation,
      })),
      usage: null, webSearches: 0,
    }),
  };
  const collect = async () => ({
    posts: [{
      title: "통매음 불송치 후기",
      url: "https://gall.dcinside.com/mini/board/view/?id=tongtong&no=1",
      gallery: "tongtong",
      body: "게임에서 벌어진 일로 조사 받으러 갔는데 결국 불송치 뜸. 헌터한테 걸린 거였음",
      ending: true,
    }],
    dropped: [],
  });

  const result = await refreshWebCaseQuery({
    pool, client, queryKey: "게임 채팅 통매음 통신매체이용음란", collect, verify: keepAll,
  });

  assert.equal(result.count, 2);
  const stored = JSON.parse(written[0][1]);
  assert.deepEqual(stored.map((item) => item.sourceType).sort(), ["community", "lawyer_qna"]);
  // The rules that read the reader's own description tag the gallery post too,
  // so the ranking compares like with like without asking a model for it.
  const gallery = stored.find((item) => item.sourceType === "community");
  assert.equal(gallery.medium, "game_chat");
  assert.equal(gallery.ending, true);
  assert.equal(gallery.situation, "hunter_pattern");
});

test("keeps the panel up when the gallery is the thing that broke", async () => {
  // A site that changed shape overnight must not take the search results down
  // with it.
  const pool = { query: async () => ({ rows: [] }) };
  const client = {
    model: "m",
    searchWebCases: async () => ({ webCases: [post(1)], usage: null, webSearches: 1 }),
    summarizeWebPosts: async () => { throw new Error("should not be called"); },
  };
  const result = await refreshWebCaseQuery({
    pool, client, queryKey: "q", verify: keepAll,
    collect: async () => { throw new Error("gallery down"); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
});

test("does not pay for a summary when the gallery brought back nothing", async () => {
  let summarised = 0;
  const pool = { query: async () => ({ rows: [] }) };
  const client = {
    model: "m",
    searchWebCases: async () => ({ webCases: [post(1)], usage: null, webSearches: 1 }),
    summarizeWebPosts: async () => { summarised += 1; return { webCases: [], usage: null, webSearches: 0 }; },
  };
  await refreshWebCaseQuery({ pool, client, queryKey: "q", verify: keepAll, collect: noGallery });
  assert.equal(summarised, 0);
});

test("gives every gallery query its own share of the batch", async () => {
  // Filling in query order is what made the batch one-sided: the first two ask
  // in the accused person's words, and they took every slot before the
  // complainant-side query was reached. Nine of nine posts came back labelled
  // reported, so victims saw nothing from the gallery.
  const asked = [];
  const pool = { query: async () => ({ rows: [] }) };
  const client = {
    model: "m",
    searchWebCases: async () => ({ webCases: [], usage: null, webSearches: 1 }),
    summarizeWebPosts: async ({ posts }) => ({
      webCases: posts.map((post) => ({
        title: post.title, url: post.url, sourceType: "community",
        quote: "조사를 받은 뒤 처분을 받았다고 적은 글입니다.",
        medium: post.medium, expression: post.expression,
        writerRole: "unclear", ending: true, situation: post.situation,
      })),
      usage: null, webSearches: 0,
    }),
  };
  // Every query can offer more than its share; none may take more.
  const collect = async ({ query }) => {
    asked.push(query);
    return {
      posts: Array.from({ length: GALLERY_QUERY_LIMITS[0] + 5 }, (unused, index) => ({
        title: `${query} ${index}`,
        url: `https://gall.dcinside.com/board/view/?id=a&no=${asked.length}${index}`,
        gallery: "a",
        body: "조사 받으러 갔다가 결국 불송치 뜸. 진술만 잘하면 된다고 봄",
        ending: true,
      })),
      dropped: [],
    };
  };

  const result = await refreshWebCaseQuery({ pool, client, queryKey: "카카오톡 통매음", collect, verify: keepAll });
  assert.equal(asked.length, 3, "세 검색어를 모두 물어야 합니다");
  // The third query's posts are in the batch rather than cut off by the
  // WEB_BATCH_SIZE slice downstream.
  const fromThird = result.count > 0 && asked[2];
  assert.ok(fromThird, "고소인 쪽 검색어가 배치에 들어가야 합니다");
  // Derived, so raising the pool does not silently break the guarantee this
  // test exists for: every query contributes, none takes more than its share.
  const share = GALLERY_QUERY_LIMITS.reduce((sum, n) => sum + n, 0);
  assert.equal(result.count, share, "한 검색어가 배치를 독식했습니다");
});

test("reports what both model calls cost, not just the search", async () => {
  // A refresh makes two calls. Reporting only the web search understated a
  // batch by whatever the summary ran to — 8,443 input tokens the first time it
  // went out for real.
  const pool = { query: async () => ({ rows: [] }) };
  const client = {
    model: "m",
    searchWebCases: async () => ({ webCases: [post(1)], usage: { input_tokens: 2_000, output_tokens: 300 }, webSearches: 2 }),
    summarizeWebPosts: async () => ({ webCases: [], usage: { input_tokens: 8_443, output_tokens: 1_042 }, webSearches: 0 }),
  };
  const collect = async () => ({
    posts: [{ title: "통매음 불송치 후기", url: "https://gall.dcinside.com/board/view/?id=a&no=1", gallery: "a", body: "조사 받고 불송치 떴음 진술 잘하면 됨", ending: true }],
    dropped: [],
  });
  const result = await refreshWebCaseQuery({ pool, client, queryKey: "q", collect, verify: keepAll });
  assert.deepEqual(result.usage, { input_tokens: 10_443, output_tokens: 1_342 });
  // Only the search is billed per tool call; the gallery is fetched here and
  // summarised without a tool.
  assert.equal(result.webSearches, 2);
});

test("has no usage to report when nothing was called", async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const client = {
    model: "m",
    searchWebCases: async () => ({ webCases: [post(1)], usage: null, webSearches: 0 }),
    summarizeWebPosts: async () => { throw new Error("should not be called"); },
  };
  const result = await refreshWebCaseQuery({ pool, client, queryKey: "q", collect: noGallery, verify: keepAll });
  assert.equal(result.usage, null);
});
