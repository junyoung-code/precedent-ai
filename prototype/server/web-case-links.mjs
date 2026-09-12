/**
 * Opens stored addresses and records whether they answered.
 *
 * Split out of the verify script because the import script needs exactly the
 * same behaviour for the handful of posts it just added — and the behaviour is
 * the whole point. It was learned the hard way, from `verifyWebCases` running a
 * batch through one `Promise.all`: measured against Lawtalk on 9월 11일, the
 * first five requests answered 200 and everything from the sixth on came back
 * 502, including pages that had answered a minute earlier. Each 502 counted as
 * "gone" and dropped a live post. Opening the links faster produced fewer.
 *
 * Two rules follow, and a second copy of this loop is a second chance to get
 * them wrong:
 *
 *   1. One request at a time, hosts interleaved, and a floor on how often any
 *      one site is touched.
 *   2. A 5xx or a network error never marks a post dead. Only the host's own
 *      definite answer — a 4xx — does. If a host starts refusing, walk away and
 *      leave its rows as they were.
 *
 * It does not re-check that the page still says what the title claims. For
 * posts a model found, `verifyWebCases` did that before storing them; for the
 * ones collected by hand the title was read off the page. Existence is what
 * decays, and existence is what this watches.
 */

import { mayFetch, USER_AGENT } from "./robots.mjs";
import { recordLinkCheck } from "./web-case-pool.mjs";

export const DEFAULT_DELAY_MS = 800;

/**
 * The least time one site may see between two of our requests.
 *
 * Interleaving hosts is not enough alone. 63 of the first 90 posts collected
 * are Lawtalk, so once the smaller hosts run out the round robin degenerates
 * into back-to-back Lawtalk requests at the global delay — the very burst that
 * got us blocked. This is the rule that actually binds.
 */
export const DEFAULT_HOST_DELAY_MS = 5_000;

// How many refusals in a row mean the host has had enough of us, rather than
// these particular pages being gone.
const REFUSAL_RUN = 3;

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => { setTimeout(resolve, ms); }) : Promise.resolve());

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Round robin across hosts, so no site is asked twice in a row while another
 * waits. Taking them in stored order would send every Lawtalk request together.
 */
export function interleaveByHost(rows) {
  const queues = new Map();
  for (const row of rows) {
    const host = hostOf(row.url);
    if (!queues.has(host)) queues.set(host, []);
    queues.get(host).push(row);
  }
  const order = [];
  for (let depth = 0; ; depth += 1) {
    const round = [...queues.values()].map((queue) => queue[depth]).filter(Boolean);
    if (round.length === 0) break;
    order.push(...round);
  }
  return { order, hosts: queues.size, busiest: Math.max(0, ...[...queues.values()].map((queue) => queue.length)) };
}

export async function checkWebCaseLinks({
  pool, rows, delayMs = DEFAULT_DELAY_MS, hostDelayMs = DEFAULT_HOST_DELAY_MS,
  timeoutMs = 12_000, fetchImpl = fetch, allowFetch = mayFetch, onProgress = null,
}) {
  const { order } = interleaveByHost(rows || []);
  const refusals = new Map();
  const lastCall = new Map();
  const abandoned = new Set();
  const tally = { live: 0, gone: 0, refused: 0, skipped: 0, disallowed: 0 };

  for (const [index, row] of order.entries()) {
    const host = hostOf(row.url);
    if (abandoned.has(host)) { tally.skipped += 1; continue; }

    const since = Date.now() - (lastCall.get(host) ?? -Infinity);
    if (since < hostDelayMs) await sleep(hostDelayMs - since);
    lastCall.set(host, Date.now());

    // Ask before opening, the same way the batch check did. Fails open: a
    // robots.txt we could not read is not an objection to a link somebody
    // already published, and this opens one page rather than crawling.
    if (!(await allowFetch({ url: row.url, fetchImpl, timeoutMs }))) {
      tally.disallowed += 1;
      await recordLinkCheck({ pool, url: row.url, status: 403 });
      await sleep(delayMs);
      continue;
    }

    let status = null;
    try {
      const response = await fetchImpl(row.url, {
        redirect: "follow",
        headers: { "user-agent": USER_AGENT, "accept-language": "ko" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      // Drain the body so the socket is reused rather than left hanging.
      await response.arrayBuffer?.().catch(() => {});
    } catch {
      status = null;
    }

    const live = status !== null && status >= 200 && status < 400;
    const definite = status !== null && status >= 400 && status < 500;

    if (live || definite) {
      refusals.set(host, 0);
      await recordLinkCheck({ pool, url: row.url, status });
      if (live) tally.live += 1; else tally.gone += 1;
    } else {
      // 5xx or no answer. Not evidence about this post — evidence about the
      // host. Nothing is written, so the row keeps whatever it already had.
      const run = (refusals.get(host) || 0) + 1;
      refusals.set(host, run);
      tally.refused += 1;
      if (run >= REFUSAL_RUN) {
        abandoned.add(host);
        onProgress?.({ kind: "abandoned", host });
      }
    }

    onProgress?.({ kind: "checked", index: index + 1, total: order.length, url: row.url, status });
    await sleep(delayMs);
  }

  return { ...tally, abandoned: [...abandoned], checked: order.length };
}
