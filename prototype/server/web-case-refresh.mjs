import {
  WEB_BATCH_SIZE,
  WEB_EXPRESSIONS,
  WEB_MEDIUMS,
  buildGalleryQueries,
  buildWebSearchQuery,
  readCachedWebCases,
  validateWebCases,
  verifyWebCases,
  writeCachedWebCases,
} from "./web-cases.mjs";
import { collectDcinsideCases } from "./dcinside-cases.mjs";
import { hunterSituation } from "./dcinside-filter.mjs";
import { extractFactTags } from "../src/lib/fact-tags.js";

/**
 * Every query the service can ever send to a web search.
 *
 * It is a couple of dozen strings because the query is built from fact tags
 * rather than from what anyone wrote, which is what makes a shared cache
 * possible in the first place. Derived rather than listed, so widening the tag
 * rules widens this too instead of leaving a combination nobody fills.
 */
export const WEB_SEARCH_KEYS = [...new Set(
  WEB_MEDIUMS.flatMap((medium) => WEB_EXPRESSIONS.map(
    (expressionType) => buildWebSearchQuery({ medium, expressionType }),
  )),
)];

// The mediums most complaints arrive on. Warming these covers nearly everyone
// while leaving the rare combinations to fill themselves on first use.
export const COMMON_WEB_SEARCH_KEYS = WEB_SEARCH_KEYS.filter(
  (key) => /카카오톡|게임 채팅|SNS 디엠|문자 메시지/.test(key),
);

/**
 * Reads the gallery and has the model write a line about what it found.
 *
 * Kept apart from the web search rather than replacing it, because the two
 * sources answer different questions and neither answers both. Lawtalk supplies
 * "somebody in my situation asked this" — cleanly, safely, and in quantity —
 * and stops at the question, because a consultation post has no ending. The
 * gallery supplies how it went, and about a third of what it holds is worth
 * showing.
 *
 * Returns an empty batch rather than throwing. A gallery that changed shape
 * overnight must not take the panel down with it.
 */
async function collectGalleryCases({ client, queryKey, collect, tag }) {
  try {
    const seen = new Set();
    const posts = [];
    // Asked the gallery's way, not the search tool's — see buildGalleryQueries.
    // The same post is reachable from both queries, and the galleries also
    // cross-post it, so the address is what decides whether we have it already.
    for (const query of buildGalleryQueries(queryKey)) {
      const found = await collect({ query });
      for (const post of found.posts) {
        if (seen.has(post.url)) continue;
        seen.add(post.url);
        posts.push(post);
      }
    }
    if (posts.length === 0) return { webCases: [], usage: null };
    const { webCases, usage } = await client.summarizeWebPosts({ posts: posts.map(tag) });
    return { webCases, usage };
  } catch {
    return { webCases: [], usage: null };
  }
}

/**
 * Fetches one query's batch from both sources and stores it, or leaves what is
 * already there.
 *
 * Never throws. Refreshing runs behind a response that has already gone out, so
 * a failure here must not surface anywhere — the reader keeps the older batch,
 * which is the whole point of serving before revalidating.
 */
export async function refreshWebCaseQuery({
  pool, client, queryKey, verify = verifyWebCases,
  collect = collectDcinsideCases, facts = extractFactTags,
} = {}) {
  try {
    // The tags the ranking compares on are produced by the same rules that read
    // the reader's own description, so the gallery posts are tagged here rather
    // than asked of a model. Rules do the matching; the model only writes.
    const tag = (post) => {
      const extracted = facts(`${post.title}\n${post.body}`);
      return {
        ...post,
        medium: extracted.medium,
        expression: extracted.expressionType,
        situation: hunterSituation(post) ? "hunter_pattern" : null,
      };
    };

    const [searched, gathered] = await Promise.all([
      client.searchWebCases({ query: queryKey }),
      collectGalleryCases({ client, queryKey, collect, tag }),
    ]);

    // The same two checks a live search runs. A cached link is one we will show
    // for a day, so it earns no shortcut around them — and a post this server
    // fetched itself goes through exactly the same door as one a model named.
    const shaped = validateWebCases([...searched.webCases, ...gathered.webCases], { limit: WEB_BATCH_SIZE * 2 });
    const verified = shaped.cases.length > 0 ? await verify({ cases: shaped.cases }) : { cases: [] };
    const stored = await writeCachedWebCases({
      pool, queryKey, cases: verified.cases, model: client.model,
    });
    return {
      ok: true,
      stored,
      count: verified.cases.length,
      usage: searched.usage,
      webSearches: searched.webSearches,
    };
  } catch (error) {
    return { ok: false, stored: false, count: 0, code: error.code || "WEB_REFRESH_FAILED" };
  }
}

/**
 * Hands back what is stored and, if it has aged out, starts a refresh.
 *
 * The refresh is deliberately not awaited: a reader waiting twenty seconds for
 * a fresher version of something we already have is the cost this cache exists
 * to remove.
 */
export async function readWebCasesWithRefresh({ pool, client, queryKey, refresh = refreshWebCaseQuery, onRefresh }) {
  const cached = await readCachedWebCases({ pool, queryKey });
  const needsFetch = client && (!cached || cached.stale);
  if (needsFetch) {
    const running = refresh({ pool, client, queryKey }).catch(() => ({ ok: false }));
    if (onRefresh) onRefresh(running);
  }
  return cached || { cases: [], fetchedAt: null, stale: true, model: null };
}
