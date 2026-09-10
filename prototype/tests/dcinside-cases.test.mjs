import assert from "node:assert/strict";
import test from "node:test";

import {
  collectDcinsideCases, htmlToText, mayCollect, parsePostBody, parseSearchResults,
} from "../server/dcinside-cases.mjs";
import { clearRobotsCache } from "../server/robots.mjs";

const ROBOTS = [
  "User-agent: GPTBot",
  "Disallow: /",
  "User-agent: *",
  "Allow: /",
  "Disallow: /board/lists/?id=cat",
  "Disallow: /board/view/?id=cat",
].join("\n");

const searchPage = (items) => `<ul class="sch_result_list">${items.map((item) => `
  <li><a href="${item.url}" target="_blank" class="tit_txt">${item.title}</a>
  <p class="link_dsc_txt">발췌</p></li>`).join("")}</ul>`;

const postPage = (body) => `<html><body>
  <div class="writing_view_box"><div class="jjalbang_list">
    <ul>{{each(i, digit) no.toString().split('')}}{{/each}}</ul>
  </div></div>
  <div class="write_div" style="overflow:hidden"><p>${body}</p></div>
  <script>if(window.OutLink && typeof window.OutLink.renderOutLinkWarning === 'function') {}</script>
</body></html>`;

const ending = "국내 겜이라 특정 2달 만에 관할 경찰서로 이관된다는 전화받고 조사 받으러 감. 결국 불송치 뜸. 진술만 잘하면 됨";

function fakeSite({ robots = ROBOTS, results = [], body = ending, onOpen = () => {} } = {}) {
  return async (url) => {
    onOpen(url);
    if (url.endsWith("/robots.txt")) {
      if (robots === null) throw new Error("network");
      return { ok: true, text: async () => robots };
    }
    if (url.startsWith("https://search.dcinside.com/")) {
      return { ok: true, text: async () => searchPage(results) };
    }
    return { ok: true, text: async () => postPage(body) };
  };
}

test("reads the address, the gallery and the post number out of a search page", () => {
  const html = searchPage([
    { url: "https://gall.dcinside.com/mini/board/view/?id=tongtong&no=435615", title: "통매음 <b>불송치</b> 후기" },
    { url: "https://gall.dcinside.com/board/view/?id=accusation&no=364390", title: "소리질러!" },
  ]);
  assert.deepEqual(parseSearchResults(html).map((item) => [item.gallery, item.no, item.title]), [
    ["tongtong", "435615", "통매음 불송치 후기"],
    ["accusation", "364390", "소리질러!"],
  ]);
});

test("offers the same post once however many times the page lists it", () => {
  const url = "https://gall.dcinside.com/board/view/?id=accusation&no=1";
  const html = searchPage([{ url, title: "하나" }, { url, title: "하나" }]);
  assert.equal(parseSearchResults(html).length, 1);
});

test("keeps the page's own machinery out of what we call a post body", () => {
  // The gallery ships a jQuery template as ordinary markup, so tag stripping
  // alone leaves `{{each(i, digit) no.toString().split('')}}` behind, and a
  // body pattern that ran past the closing </div> picked it up 25KB away from
  // where the writer's words actually were. It then went to the model as though
  // somebody had typed it.
  const body = parsePostBody(postPage(ending));
  assert.equal(body, ending);
  assert.equal(/\{\{|toString\(\)|window\.OutLink/.test(body), false);
});

test("drops script and style outright rather than reading their contents", () => {
  const text = htmlToText("<p>앞</p><script>var a = '읽으면 안 되는 것';</script><style>.x{}</style><p>뒤</p>");
  assert.equal(text.includes("읽으면 안 되는 것"), false);
  assert.equal(text.includes("앞"), true);
  assert.equal(text.includes("뒤"), true);
});

test("refuses to open a page when it could not read the rules", async () => {
  // `mayFetch` fails open, which is right for checking a link somebody already
  // published. This module opens pages the reader never asked for, so it fails
  // closed: DCInside does publish a robots.txt, and an empty ruleset means we
  // failed to read it rather than that the site is open.
  clearRobotsCache();
  const url = "https://gall.dcinside.com/board/view/?id=accusation&no=1";
  assert.equal(await mayCollect({ url, fetchImpl: fakeSite({ robots: null }) }), false);

  clearRobotsCache();
  assert.equal(await mayCollect({ url, fetchImpl: fakeSite() }), true);

  clearRobotsCache();
  assert.equal(await mayCollect({ url: "not a url", fetchImpl: fakeSite() }), false);
});

test("honours the galleries DCInside excludes by name", async () => {
  // The exclusions are written as query strings — `Disallow: /board/view/?id=cat`
  // — which is why this has to go through isAllowedByRobots on pathname+search
  // rather than on the path alone.
  clearRobotsCache();
  const fetchImpl = fakeSite();
  assert.equal(await mayCollect({ url: "https://gall.dcinside.com/board/view/?id=cat&no=9", fetchImpl }), false);
  assert.equal(await mayCollect({ url: "https://gall.dcinside.com/board/view/?id=accusation&no=9", fetchImpl }), true);
});

test("does not open a post the gallery asked us to leave alone", async () => {
  clearRobotsCache();
  const opened = [];
  const fetchImpl = fakeSite({
    onOpen: (url) => { if (url.includes("board/view")) opened.push(url); },
    results: [
      { url: "https://gall.dcinside.com/board/view/?id=cat&no=1", title: "가려진 갤러리" },
      { url: "https://gall.dcinside.com/board/view/?id=accusation&no=2", title: "통매음 불송치 후기" },
    ],
  });
  const result = await collectDcinsideCases({ query: "통매음", fetchImpl, delayMs: 0 });
  assert.deepEqual(opened, ["https://gall.dcinside.com/board/view/?id=accusation&no=2"]);
  assert.equal(result.posts.length, 1);
  assert.equal(result.dropped.includes("disallowed"), true);
});

test("brings back only the posts that say how it turned out", async () => {
  clearRobotsCache();
  const results = [
    { url: "https://gall.dcinside.com/board/view/?id=accusation&no=1", title: "통매음 불송치 후기" },
    { url: "https://gall.dcinside.com/board/view/?id=accusation&no=2", title: "이거 통매음 됨?" },
  ];
  const fetchImpl = async (url) => {
    if (url.endsWith("/robots.txt")) return { ok: true, text: async () => ROBOTS };
    if (url.startsWith("https://search.dcinside.com/")) return { ok: true, text: async () => searchPage(results) };
    const body = url.endsWith("no=1") ? ending : "이거 고소 되냐고 물어보는 중임 어떻게 해야하나";
    return { ok: true, text: async () => postPage(body) };
  };
  const result = await collectDcinsideCases({ query: "통매음", fetchImpl, delayMs: 0 });
  assert.deepEqual(result.posts.map((post) => post.title), ["통매음 불송치 후기"]);
  assert.deepEqual(result.posts.map((post) => post.ending), [true]);
  assert.equal(result.dropped.includes("noEnding"), true);
});

test("stops at the limit rather than reading the whole result page", async () => {
  clearRobotsCache();
  const results = Array.from({ length: 6 }, (unused, index) => ({
    url: `https://gall.dcinside.com/board/view/?id=accusation&no=${index + 1}`,
    title: `통매음 불송치 후기 ${index + 1}`,
  }));
  const opened = [];
  const fetchImpl = fakeSite({ results, onOpen: (url) => { if (url.includes("board/view")) opened.push(url); } });
  const result = await collectDcinsideCases({ query: "통매음", limit: 2, fetchImpl, delayMs: 0 });
  assert.equal(result.posts.length, 2);
  assert.equal(opened.length, 2, "한도를 넘겨 페이지를 열었습니다");
});

test("comes back empty instead of throwing when the search is unreachable", async () => {
  // This runs behind a response that has already gone out, so a failure here
  // must not surface anywhere.
  clearRobotsCache();
  const down = async () => { throw new Error("network"); };
  assert.deepEqual(await collectDcinsideCases({ query: "통매음", fetchImpl: down, delayMs: 0 }), {
    posts: [], dropped: ["search"],
  });

  clearRobotsCache();
  const empty = fakeSite({ results: [] });
  assert.deepEqual(await collectDcinsideCases({ query: "통매음", fetchImpl: empty, delayMs: 0 }), {
    posts: [], dropped: ["empty"],
  });
});

test("asks for nothing at all without a query", async () => {
  let called = 0;
  const result = await collectDcinsideCases({
    query: "  ",
    fetchImpl: async () => { called += 1; return { ok: true, text: async () => "" }; },
  });
  assert.deepEqual(result, { posts: [], dropped: ["query"] });
  assert.equal(called, 0);
});

test("closes up the search page's own highlighting instead of spacing it out", () => {
  // The search page wraps the matched words in <b>. Turning every tag into a
  // space split 불송치면 into "불송치 면", and that misspelling was what would
  // have gone on screen as the post's own title.
  const html = searchPage([{
    url: "https://gall.dcinside.com/mgallery/board/view/?id=lawlawlaw&no=1",
    title: "통매음 <b>불송치</b>면 판검사 임용에 결격사유임?",
  }]);
  assert.equal(parseSearchResults(html)[0].title, "통매음 불송치면 판검사 임용에 결격사유임?");
});

test("knows the difference between a quiet gallery and one that stopped answering", async () => {
  // Rate-limited, DCInside answers 200 with an empty body. Read as a page that
  // is a post with no body, which screens out as "no ending" — so a blocked run
  // looked identical to one that found nothing worth keeping, and would have
  // gone on to pay a model to summarise the emptiness.
  clearRobotsCache();
  const results = Array.from({ length: 20 }, (unused, index) => ({
    url: `https://gall.dcinside.com/board/view/?id=accusation&no=${index + 1}`,
    title: `통매음 불송치 후기 ${index + 1}`,
  }));
  let opened = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith("/robots.txt")) return { ok: true, text: async () => ROBOTS };
    if (url.startsWith("https://search.dcinside.com/")) return { ok: true, text: async () => searchPage(results) };
    opened += 1;
    return { ok: true, text: async () => "" };
  };
  const result = await collectDcinsideCases({ query: "통매음", fetchImpl, delayMs: 0 });
  assert.deepEqual(result.posts, []);
  assert.equal(result.dropped.at(-1), "blocked", "차단을 알아차리지 못했습니다");
  assert.equal(opened < results.length, true, "차단된 뒤에도 계속 요청했습니다");
});
