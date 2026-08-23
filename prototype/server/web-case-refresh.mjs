import {
  WEB_EXPRESSIONS,
  WEB_MEDIUMS,
  buildWebSearchQuery,
  readCachedWebCases,
  validateWebCases,
  verifyWebCases,
  writeCachedWebCases,
} from "./web-cases.mjs";

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
 * Fetches one query's batch and stores it, or leaves what is already there.
 *
 * Never throws. Refreshing runs behind a response that has already gone out, so
 * a failure here must not surface anywhere — the reader keeps the older batch,
 * which is the whole point of serving before revalidating.
 */
export async function refreshWebCaseQuery({ pool, client, queryKey, verify = verifyWebCases }) {
  try {
    const { webCases, usage, webSearches } = await client.searchWebCases({ query: queryKey });
    // The same two checks a live search runs. A cached link is one we will show
    // for a day, so it earns no shortcut around them.
    const shaped = validateWebCases(webCases);
    const verified = shaped.cases.length > 0 ? await verify({ cases: shaped.cases }) : { cases: [] };
    const stored = await writeCachedWebCases({
      pool, queryKey, cases: verified.cases, model: client.model,
    });
    return { ok: true, stored, count: verified.cases.length, usage, webSearches };
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
