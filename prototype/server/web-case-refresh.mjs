import {
  GALLERY_BATCH_SIZE,
  WEB_BATCH_SIZE,
  WEB_EXPRESSIONS,
  WEB_MEDIUMS,
  GALLERY_QUERY_LIMITS,
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
import { embedWebCases } from "./web-case-embeddings.mjs";

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
    // The same post is reachable from more than one query, and the galleries
    // cross-post it too, so the address decides whether we already have it.
    //
    // Each query gets its own share rather than filling in order, because the
    // order is not neutral: the first two ask in the accused person's words and
    // would take the whole batch, leaving the complainant-side query cut off by
    // the WEB_BATCH_SIZE slice downstream.
    const queries = buildGalleryQueries(queryKey);
    for (const [index, query] of queries.entries()) {
      const limit = GALLERY_QUERY_LIMITS[index] ?? GALLERY_QUERY_LIMITS.at(-1);
      const found = await collect({ query, limit: limit * 2 });
      let taken = 0;
      for (const post of found.posts) {
        if (taken >= limit) break;
        if (seen.has(post.url)) continue;
        seen.add(post.url);
        posts.push(post);
        taken += 1;
      }
    }
    if (posts.length === 0) return { webCases: [], usage: null };
    const { webCases, usage } = await client.summarizeWebPosts({ posts: posts.map(tag) });
    return { webCases, usage };
  } catch {
    return { webCases: [], usage: null };
  }
}

// Article 13 lists the forms the offence can take — 말, 음향, 글, 그림, 영상,
// 물건 — and a post that quotes that list trips the image rules on the statute's
// words rather than on anything that happened to the writer. The precedent side
// has had this guard since its own tags were first extracted
// (`precedent-fact-tags.mjs:35-43`); the gallery path went in without it.
//
// `isStatuteRecital` already drops posts that are nothing but the statute. This
// is for the ones that quote a line of it inside a real account.
const STATUTE_LINE = /제\s?13\s?조[^\n]*|성폭력범죄의?\s?처벌[^\n]*제\s?13[^\n]*|자기\s?또는\s?(?:다른\s?사람|타인)의\s?성적\s?욕망[^\n]*/g;

export function withoutStatuteEnumeration(text) {
  return String(text || "").replace(STATUTE_LINE, " ");
}

/**
 * Both calls' tokens as one row's worth.
 *
 * A refresh makes two model calls — the web search and the gallery summary —
 * and reporting only the first would understate what a batch costs by however
 * much the summary ran to, which was 8,443 input tokens the first time it went
 * out for real. They share a model, so one row is the honest shape.
 */
function totalUsage(...usages) {
  const fields = ["input_tokens", "output_tokens"];
  const total = {};
  for (const usage of usages) {
    if (!usage) continue;
    for (const field of fields) total[field] = (total[field] || 0) + (Number(usage[field]) || 0);
    const cached = usage.input_tokens_details?.cached_tokens;
    if (cached) {
      total.input_tokens_details = {
        cached_tokens: (total.input_tokens_details?.cached_tokens || 0) + Number(cached),
      };
    }
  }
  return Object.keys(total).length > 0 ? total : null;
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
  embeddingClient = null, embed = embedWebCases,
} = {}) {
  try {
    // The tags the ranking compares on are produced by the same rules that read
    // the reader's own description, so the gallery posts are tagged here rather
    // than asked of a model. Rules do the matching; the model only writes.
    const tag = (post) => {
      const extracted = facts(withoutStatuteEnumeration(`${post.title}\n${post.body}`));
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
    // Room for both sources in full. The old cap was WEB_BATCH_SIZE * 2, which
    // was two lots of the web search's size and had nothing to do with how many
    // the gallery now brings.
    const shaped = validateWebCases(
      [...searched.webCases, ...gathered.webCases],
      { limit: WEB_BATCH_SIZE + GALLERY_BATCH_SIZE },
    );
    const verified = shaped.cases.length > 0 ? await verify({ cases: shaped.cases }) : { cases: [] };
    const stored = await writeCachedWebCases({
      pool, queryKey, cases: verified.cases, model: client.model,
    });

    // After storing, not before: a batch that could not be written is not one
    // whose vectors are worth buying. Skips anything already embedded, so the
    // daily refresh pays only for posts it has never seen. No client — offline,
    // or no consent — means no vectors, and the panel ranks on tags as it did
    // before any of this existed.
    if (embeddingClient && verified.cases.length > 0) {
      await embed({ pool, embeddingClient, cases: verified.cases });
    }

    return {
      ok: true,
      stored,
      count: verified.cases.length,
      usage: totalUsage(searched.usage, gathered.usage),
      // Only the web search is billed per tool call; the gallery is fetched by
      // this server and summarised without a tool.
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
export async function readWebCasesWithRefresh({
  pool, client, queryKey, refresh = refreshWebCaseQuery, onRefresh, embeddingClient = null,
}) {
  const cached = await readCachedWebCases({ pool, queryKey });
  const needsFetch = client && (!cached || cached.stale);
  if (needsFetch) {
    // Forwarded rather than left out: a post collected today and embedded
    // tomorrow is a post that ranks on tags alone for a day, which is the state
    // the vectors exist to end.
    const running = refresh({ pool, client, queryKey, embeddingClient }).catch(() => ({ ok: false }));
    if (onRefresh) onRefresh(running);
  }
  return cached || { cases: [], fetchedAt: null, stale: true, model: null };
}
