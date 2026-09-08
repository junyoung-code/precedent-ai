import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMON_WEB_SEARCH_KEYS, WEB_SEARCH_KEYS, readWebCasesWithRefresh, refreshWebCaseQuery,
} from "../server/web-case-refresh.mjs";
import { WEB_EXPRESSIONS, WEB_MEDIUMS, buildWebSearchQuery } from "../server/web-cases.mjs";

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
  let wrote = false;
  const pool = { query: async () => { wrote = true; return { rows: [] }; } };

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
  assert.equal(wrote, false);
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
