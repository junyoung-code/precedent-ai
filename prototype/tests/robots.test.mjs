import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_TOKEN, USER_AGENT, clearRobotsCache, isAllowedByRobots, mayFetch, parseRobots, readRobots,
} from "../server/robots.mjs";

// Lawtalk's actual file, which is the one this feature reads most. It opens the
// Q&A and links a sitemap — it wants the traffic — while naming three bots it
// does not want, one of them OpenAI's training crawler.
const LAWTALK = `# robotstxt.org

User-agent: PetalBot
Disallow: /

User-agent: GPTBot
Disallow: /

User-agent: *
Disallow: /api/
Disallow: /admin/
Disallow: /my/
Disallow: /*.swf*
Disallow: /terms-of-service/

Sitemap: https://www.lawtalk.co.kr/sitemap.xml`;

test("says who is calling instead of claiming to be a browser", () => {
  // A site that names individual bots plainly cares who is calling, and
  // answering "Chrome" to that is not an answer.
  assert.equal(USER_AGENT.toLowerCase().includes("mozilla"), false);
  assert.equal(USER_AGENT.toLowerCase().includes(AGENT_TOKEN), true);
  // Carries a way to look us up, so a site that wants us gone can name us.
  assert.match(USER_AGENT, /https?:\/\//);
});

test("reads a real file the way the site means it", () => {
  const groups = parseRobots(LAWTALK);
  const open = (path) => isAllowedByRobots(groups, path);
  assert.equal(open("/qna/265531"), true, "상담글은 열려 있습니다");
  assert.equal(open("/api/anything"), false);
  assert.equal(open("/terms-of-service/"), false);
  assert.equal(open("/my/"), false);
  // A named group beats the catch-all, in both directions.
  assert.equal(isAllowedByRobots(groups, "/qna/265531", "gptbot"), false);
  assert.equal(isAllowedByRobots(groups, "/qna/265531", "petalbot"), false);
});

test("handles the wildcard and end-anchor forms", () => {
  const groups = parseRobots(`User-agent: *\nDisallow: /*.swf$\nDisallow: /board/lists/?id=47`);
  assert.equal(isAllowedByRobots(groups, "/x/y.swf"), false);
  assert.equal(isAllowedByRobots(groups, "/x/y.swf.html"), true, "$ 는 끝을 고정합니다");
  assert.equal(isAllowedByRobots(groups, "/board/lists/?id=47"), false);
  assert.equal(isAllowedByRobots(groups, "/board/lists/?id=48"), true);
});

test("lets a site open one path inside a closed branch", () => {
  // Longest match wins and Allow takes a tie, which is the only way a site can
  // say "not this branch, except here".
  const groups = parseRobots(`User-agent: *\nDisallow: /board/\nAllow: /board/view/`);
  assert.equal(isAllowedByRobots(groups, "/board/lists/"), false);
  assert.equal(isAllowedByRobots(groups, "/board/view/?id=1"), true);
});

test("treats consecutive user-agent lines as one group", () => {
  const groups = parseRobots(`User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nAllow: /`);
  assert.equal(isAllowedByRobots(groups, "/x", "gptbot"), false);
  assert.equal(isAllowedByRobots(groups, "/x", "claudebot"), false);
  assert.equal(isAllowedByRobots(groups, "/x"), true);
});

test("an unreachable robots.txt is not an objection", async (t) => {
  // robots.txt is a request from a site, not a lock. Refusing to open a page
  // because the rules were briefly unreachable would drop links the site never
  // objected to.
  t.beforeEach(clearRobotsCache);
  clearRobotsCache();
  const down = async () => { throw new Error("network"); };
  assert.equal(await mayFetch({ url: "https://example.com/post/1", fetchImpl: down }), true);

  clearRobotsCache();
  const missing = async () => ({ ok: false, status: 404, text: async () => "" });
  assert.equal(await mayFetch({ url: "https://example.com/post/1", fetchImpl: missing }), true);

  // A url that is not a url is refused before any request goes out.
  let called = 0;
  clearRobotsCache();
  assert.equal(await mayFetch({ url: "not a url", fetchImpl: async () => { called += 1; return { ok: false }; } }), false);
  assert.equal(called, 0);
});

test("asks each host once rather than once per link", async () => {
  // Twelve links from one site is one question about that site.
  clearRobotsCache();
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return { ok: true, text: async () => "User-agent: *\nDisallow: /private/" };
  };
  for (let index = 0; index < 5; index += 1) {
    await mayFetch({ url: `https://example.com/post/${index}`, fetchImpl });
  }
  assert.equal(requests, 1);
  assert.equal(await mayFetch({ url: "https://example.com/private/x", fetchImpl }), false);
  assert.equal(requests, 1);
});

test("identifies itself when asking for the rules too", async () => {
  clearRobotsCache();
  let seen = null;
  await readRobots({
    origin: "https://example.com",
    fetchImpl: async (url, options) => {
      seen = { url, agent: options?.headers?.["user-agent"] };
      return { ok: true, text: async () => "" };
    },
  });
  assert.equal(seen.url, "https://example.com/robots.txt");
  assert.equal(seen.agent, USER_AGENT);
});
