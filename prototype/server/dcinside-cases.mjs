/**
 * Reads a Korean gallery for posts that say how somebody's case turned out.
 *
 * The web-case panel was 87% one site — 47 of 54 cached posts came from
 * Lawtalk. That is not a prompting failure: `analysis-client.mjs` already asks
 * for 지식iN and 디시인사이드 by name and gets Lawtalk anyway. It is an index
 * failure. Naver blocks its own crawler from `/qna/detail`, so no search engine
 * holds those pages at all, and DCInside blocks GPTBot and friends by name — so
 * a model searching the web can only find the one site that is fully indexed.
 * No amount of instruction reaches a page that is not in the index.
 *
 * So this module does the searching itself, through the gallery's own search,
 * and hands the model posts to summarise rather than a query to run.
 *
 * On being allowed in: DCInside's robots.txt splits AI crawlers in two. It
 * names GPTBot, ClaudeBot, CCBot and Google-Extended under `AI 학습 크롤러
 * 차단`, and then writes `그 외 모든 봇 (검색봇 + AI 검색봇 포함)` above
 * `User-agent: *` `Allow: /`. Training is refused; searching and citing is
 * allowed. This service is the second kind, it says who it is on the way in,
 * and it honours the per-gallery Disallow list underneath.
 */

import { isAllowedByRobots, readRobots, USER_AGENT } from "./robots.mjs";
import { screenPost } from "./dcinside-filter.mjs";

const SEARCH_ORIGIN = "https://search.dcinside.com";
const GALLERY_ORIGIN = "https://gall.dcinside.com";

// Accuracy rather than recency. The newest posts about 통매음 are mostly people
// reacting to each other; the ones that carry an ending are older and rank on
// the words they use.
const SEARCH_PATH = "/post/sort/accuracy/q/";

const MAX_BODY = 200_000;

/**
 * Whether we may open this page, refusing when we could not read the rules.
 *
 * `mayFetch` fails open — an unreachable robots.txt is not an objection, and
 * for checking a link somebody already published that is the right call. It is
 * the wrong call here. This module opens pages the reader never asked for, and
 * a site whose rules we could not read for six hours would be crawled as though
 * it had none. DCInside does publish a robots.txt with a `*` group, so an empty
 * ruleset means we failed to read it, not that it is open.
 */
async function mayCollect({ url, fetchImpl, timeoutMs }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const groups = await readRobots({ origin: parsed.origin, fetchImpl, timeoutMs });
  if (groups.length === 0) return false;
  return isAllowedByRobots(groups, `${parsed.pathname}${parsed.search}`);
}

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => { setTimeout(resolve, ms); }) : Promise.resolve());

async function readPage(url, { fetchImpl, timeoutMs }) {
  const response = await fetchImpl(url, {
    redirect: "follow",
    headers: { "user-agent": USER_AGENT, "accept-language": "ko" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.text()).slice(0, MAX_BODY);
}

const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/**
 * Page text with the page's own machinery taken out.
 *
 * The first version of this read the post body straight out of the container
 * div and pulled the gallery's inline scripts in with it — every body ended
 * with `if(window.OutLink && typeof window.OutLink.renderOutLinkWarning`, which
 * then went to the model as though the writer had typed it.
 */
export function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

const RESULT = /<a href="(https:\/\/gall\.dcinside\.com\/[^"]*board\/view\/\?id=([^&"]+)&no=(\d+))"[^>]*class="tit_txt">([\s\S]*?)<\/a>/g;

/**
 * The posts one search page offers, in the order it offered them.
 *
 * Exported so the parsing can be tested against a saved page without going to
 * the network — the shape of somebody else's HTML is exactly the thing that
 * changes without telling us.
 */
export function parseSearchResults(html) {
  const results = [];
  const seen = new Set();
  for (const match of String(html || "").matchAll(RESULT)) {
    const [, url, gallery, no, title] = match;
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({ url, gallery, no, title: htmlToText(title) });
  }
  return results;
}

// The body sits in `write_div` and closes with a single `</div>`, so a pattern
// that waited for two ran past it into the rest of the page. What it reached
// was worse than junk: the gallery ships a jQuery template as ordinary markup —
// `{{each(i, digit) no.toString().split('')}}` — which is not inside a <script>
// and so survives the tag stripping, and it landed in the body as though the
// writer had typed it.
//
// Non-greedy to the first `</div>`. A post that nests a div of its own gets cut
// short, which is the direction to be wrong in: a truncated body loses the end
// of somebody's story, while an over-long one puts the page's furniture into
// what we send the model.
const BODY_CONTAINER = [
  /<div class="write_div"[^>]*>([\s\S]*?)<\/div>/,
  /<div class="writing_view_box"[^>]*>([\s\S]*?)<\/div>/,
];

export function parsePostBody(html) {
  for (const pattern of BODY_CONTAINER) {
    const match = pattern.exec(String(html || ""));
    if (match) return htmlToText(match[1]);
  }
  return "";
}

/**
 * Searches one query and returns the posts that carry an ending.
 *
 * Every collaborator that costs a request is injected, because
 * `offline-mode.test.mjs` proves that nothing external is called by counting
 * calls through the seams — a fetch that went around them would be invisible
 * to it.
 *
 * Never throws. This runs behind a response that has already gone out.
 */
export async function collectDcinsideCases({
  query,
  limit = 12,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  delayMs = 1_100,
  allowFetch = mayCollect,
} = {}) {
  const text = String(query || "").trim();
  if (!text) return { posts: [], dropped: ["query"] };

  const dropped = [];
  const searchUrl = `${SEARCH_ORIGIN}${SEARCH_PATH}${encodeURIComponent(text)}`;

  let results = [];
  try {
    results = parseSearchResults(await readPage(searchUrl, { fetchImpl, timeoutMs }));
  } catch {
    return { posts: [], dropped: ["search"] };
  }
  if (results.length === 0) return { posts: [], dropped: ["empty"] };

  const posts = [];
  for (const result of results) {
    if (posts.length >= limit) break;

    // Ask before opening, every time. The gallery ids DCInside excludes are
    // written as query strings — `Disallow: /board/lists/?id=cat` — which
    // `isAllowedByRobots` already matches because it is handed pathname+search.
    if (!(await allowFetch({ url: result.url, fetchImpl, timeoutMs }))) {
      dropped.push("disallowed");
      continue;
    }

    let body = "";
    try {
      body = parsePostBody(await readPage(result.url, { fetchImpl, timeoutMs }));
    } catch {
      dropped.push("unreachable");
      await sleep(delayMs);
      continue;
    }

    const post = { title: result.title, url: result.url, gallery: result.gallery, body };
    const screened = screenPost(post);
    if (screened.keep) posts.push({ ...post, ending: true });
    else dropped.push(screened.reason);

    await sleep(delayMs);
  }

  return { posts, dropped };
}

// Exported for the tests, which need to prove the fail-closed rule holds.
export { mayCollect };

// A gallery whose whole subject is this offence. Not used to restrict the
// search — the endings turned up across a dozen unrelated galleries — but kept
// here because it is where the density is, and a later change that wants a
// starting point should not have to rediscover it.
export const TOPIC_GALLERY = `${GALLERY_ORIGIN}/mini/board/lists/?id=tongtong`;
