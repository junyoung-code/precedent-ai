/**
 * The collected posts, as one pool rather than a batch per query key.
 *
 * `web_case_cache` stores what one generated query returned, which is what
 * makes a refresh cheap to rate-limit — but it also made the key a wall. A
 * reader's situation reduces to two tags, those tags build one key, and the
 * panel could only choose among that key's batch. A post collected under a
 * different key was unreachable no matter how closely it matched, and 21 of the
 * 28 possible keys held nothing at all.
 *
 * This module is the storage half of taking that wall down. Retrieval lives
 * here too, so the one place that decides what a reader sees is the one place
 * that knows what has been collected.
 */

import {
  WEB_EXPRESSIONS, WEB_MEDIUMS, WEB_WRITER_ROLES,
  readerFacesStranger, scoreWebCase, webCaseSource,
} from "./web-cases.mjs";
import { WEB_CASE_GROUP_VISIBLE, WEB_CASE_POOL_LIMIT, WEB_SOURCE_TYPES } from "../src/lib/web-case-vocab.js";
import { toVectorLiteral } from "./precedent-embeddings.mjs";

// Re-exported so a caller that already reads this module keeps one import, the
// same way web-cases.mjs re-exports the vocabulary it shares with the browser.
export { WEB_CASE_GROUP_VISIBLE, WEB_CASE_POOL_LIMIT };

/**
 * Where a row came from, worst to best.
 *
 * Used to decide whether an incoming copy may overwrite a stored one. A summary
 * hand-written against the original page is better than one a model wrote from
 * a search result, and the nightly refresh must not be able to quietly degrade
 * it — a post the refresh happens to find again would otherwise arrive with a
 * thinner quote, and the quote is what the vector is built from.
 */
export const COLLECTORS = ["openai_web_search", "dcinside", "claude"];

const COLUMNS = [
  "url", "title", "quote", "source_type", "medium", "expression",
  "writer_role", "ending", "situation", "collected_by",
];

/**
 * Upserts posts into the pool, refusing to let a weaker source overwrite a
 * stronger one.
 *
 * `link_status`, `link_checked_at` and `collected_at` are never touched by an
 * update: a link already checked stays checked, and the collection date is when
 * we first saw the post rather than the last time something re-found it.
 */
const UPSERT_SQL = `INSERT INTO web_cases (${COLUMNS.join(", ")})
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
 ON CONFLICT (url) DO UPDATE SET
   title = EXCLUDED.title,
   quote = EXCLUDED.quote,
   source_type = EXCLUDED.source_type,
   medium = EXCLUDED.medium,
   expression = EXCLUDED.expression,
   writer_role = EXCLUDED.writer_role,
   ending = EXCLUDED.ending,
   situation = EXCLUDED.situation,
   collected_by = EXCLUDED.collected_by
 WHERE array_position($11::text[], EXCLUDED.collected_by)
    >= array_position($11::text[], web_cases.collected_by)
 RETURNING (xmax = 0) AS inserted`;

/**
 * The vocabularies again, in the language the pool speaks.
 *
 * The table has CHECK constraints for these, so an unrecognised value is a
 * failed insert rather than a bad row — but a whole import aborting because one
 * post carried a typo'd medium is the wrong failure. Coerced here to the same
 * defaults `validateWebCases` uses, and counted as a rejection so the caller
 * can say how many.
 */
function normalize(item, collectedBy) {
  const url = typeof item?.url === "string" ? item.url.trim() : "";
  const title = typeof item?.title === "string" ? item.title.trim() : "";
  const quote = typeof item?.quote === "string" ? item.quote.trim() : "";
  if (!url || !title || !quote) return null;
  if (!WEB_SOURCE_TYPES.includes(item.sourceType)) return null;
  if (!COLLECTORS.includes(collectedBy)) return null;
  return [
    url, title, quote, item.sourceType,
    WEB_MEDIUMS.includes(item.medium) ? item.medium : "unknown",
    WEB_EXPRESSIONS.includes(item.expression) ? item.expression : "other",
    WEB_WRITER_ROLES.includes(item.writerRole) ? item.writerRole : "unclear",
    item.ending === true,
    item.situation === "hunter_pattern" ? "hunter_pattern" : null,
    collectedBy,
  ];
}

export async function upsertWebCases({ pool, cases, collectedBy, linkStatus = null }) {
  const result = { inserted: 0, updated: 0, kept: 0, rejected: 0 };
  for (const item of Array.isArray(cases) ? cases : []) {
    const values = normalize(item, collectedBy);
    if (!values) { result.rejected += 1; continue; }
    try {
      const { rows } = await pool.query(UPSERT_SQL, [...values, COLLECTORS]);
      // No row back means the WHERE refused the update: something better is
      // already stored. That is a success, not a failure.
      if (rows.length === 0) result.kept += 1;
      else if (rows[0].inserted) result.inserted += 1;
      else result.updated += 1;

      // A caller that already opened the page says so, rather than leaving the
      // row invisible until the scheduled check happens to reach it. Written
      // separately because the upsert's own WHERE can refuse the update, and a
      // link check is true regardless of which collector wrote the summary.
      if (linkStatus !== null) await recordLinkCheck({ pool, url: values[0], status: linkStatus });
    } catch {
      result.rejected += 1;
    }
  }
  return result;
}

/**
 * Every address in the pool, oldest link check first.
 *
 * The order is what makes a checking run resumable and fair: a run that stops
 * halfway has still refreshed the stalest half, and nothing is starved.
 */
export async function readWebCaseUrls({ pool, limit = 1_000 }) {
  const { rows } = await pool.query(
    `SELECT url, link_checked_at AS "linkCheckedAt", link_status AS "linkStatus"
       FROM web_cases
      ORDER BY link_checked_at ASC NULLS FIRST, url
      LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function recordLinkCheck({ pool, url, status }) {
  await pool.query(
    `UPDATE web_cases SET link_status = $2, link_checked_at = now() WHERE url = $1`,
    [url, Number.isFinite(status) ? status : null],
  );
}

/**
 * How relevant a post must be before it may appear at all, on the 0-100 base
 * score — the semantic-and-tag half, before the role, ending and situation
 * bonuses, which order what is already relevant rather than establish that it
 * is.
 *
 * A floor is not optional here the way it was for a batch. The key used to be
 * the filter: a reader only ever saw posts collected for their own two tags. In
 * a pool the candidates are everything, so without this every reader is handed
 * the least-bad three posts in the collection and told they are similar. The
 * panel's own rule is already written down one module over:
 *
 *   숫자 채우려고 다른 매체를 넣는 건 웹 섹션판 판례 날조다.
 *   적게 주는 게 정직한 답이다.  — web-cases.mjs
 *
 * 55 is borrowed from `MINIMUM_RETRIEVAL_SCORE` on the precedent side, which is
 * on the same 0-100 scale, and is provisional in exactly the way
 * `SEMANTIC_WEIGHT` is: a named constant with a reason rather than a measured
 * number. Measuring it needs a pool with something in it to measure.
 */
export const WEB_CASE_MINIMUM_BASE = 55;

// How many candidates the ranking sees. Larger than the limit because the
// groups and the source share both discard, and a group starved by discards
// should be refilled from further down rather than left short.
const CANDIDATE_LIMIT = 80;

/**
 * How much of one group may come from a single site.
 *
 * The old rule was two posts per site across the whole panel, when the whole
 * panel was three posts. Kept as-is it would cap a 24-post screen at two
 * Lawtalk items — and 63 of the first 90 posts collected are Lawtalk, so the
 * screen would be mostly empty for the honest reason of having nothing else.
 *
 * The reason behind the old rule is intact though: three consultation
 * questions in a row teach a reader what other people asked and nothing about
 * how any of it went. Grouping now answers that structurally — 결과까지 적힌 글
 * is its own group — so this only has to stop one site from owning a group.
 */
const MAX_SOURCE_SHARE = 0.5;
const MIN_PER_SOURCE = 2;

/**
 * The groups, in the order they are filled and shown.
 *
 * A post appears in exactly one. Letting it fall into several would make the
 * counts on screen lie and show the same link three times, so each group takes
 * from what the ones above it left.
 */
/**
 * A post plainly written from the side the reader is not on.
 *
 * `unclear` is not the other side — it is a post whose side we could not read,
 * and the galleries produce plenty of those.
 */
function isOtherSide(item, role) {
  return Boolean(role) && item.writerRole !== "unclear" && item.writerRole !== role;
}

export const WEB_CASE_GROUPS = [
  {
    id: "closest",
    title: "내 상황과 가장 가까운 글",
    size: 6,
    // Everything above the floor except the other side's posts. Those score −40
    // and are not close by definition — but the per-source cap could still
    // promote one here by starving this group of same-side posts, which is how
    // a victim's question ended up under 내 상황과 가장 가까운 글 for somebody
    // who had been reported. They have a group of their own two rows down.
    fits: (item, { role }) => !isOtherSide(item, role),
  },
  {
    id: "ending",
    title: "결과까지 적힌 글",
    size: 6,
    note: "글쓴이가 자기 사건이 어떻게 끝났는지까지 적은 글입니다.",
    // The other side's endings are worth reading too, and this group is about
    // what the post contains rather than who wrote it — a 불송치 the complainant
    // is appealing tells a reported reader something no accused-side post does.
    fits: (item) => item.ending === true,
  },
  // Before 같은 매체, not after. Every post that survives the medium rule is on
  // the reader's medium or on none, so that group is the catch-all — put it
  // above this one and it swallows the other side's posts before this can claim
  // them, and 반대 입장 never appears at all. Measured on a Kakao case: two
  // victim-side posts existed and both were filed under 같은 매체.
  {
    id: "otherSide",
    title: "반대 입장에서 쓴 글",
    size: 6,
    note: "상대편이 같은 일을 어떻게 겪었는지 적은 글입니다.",
    fits: (item, { role }) => isOtherSide(item, role),
  },
  {
    id: "sameMedium",
    title: "같은 매체에서 벌어진 일",
    size: 6,
    fits: (item, { readerMedium }) => Boolean(readerMedium) && item.medium === readerMedium,
  },
];

function rowToCase(row) {
  return {
    url: row.url,
    title: row.title,
    quote: row.quote,
    sourceType: row.sourceType,
    medium: row.medium,
    expression: row.expression,
    writerRole: row.writerRole,
    ending: row.ending,
    situation: row.situation,
  };
}

const SELECT_COLUMNS = `c.url, c.title, c.quote, c.source_type AS "sourceType",
  c.medium, c.expression, c.writer_role AS "writerRole", c.ending, c.situation,
  c.link_checked_at AS "linkCheckedAt"`;

// Only posts whose address we have opened. The screen says the server checked
// every link on it, so an unchecked post cannot be on it.
const LIVE = "c.link_status BETWEEN 200 AND 399";

/**
 * A post about a different medium is not the same situation, whatever else it
 * shares — the rule `selectWebCases` applies after ranking, applied here before
 * it so the candidate window is not spent on posts that cannot be shown.
 * `unknown` passes: the rules failed to read a medium, which is not a mismatch.
 */
function mediumClause(readerMedium, index) {
  return readerMedium ? `AND (c.medium = $${index} OR c.medium = 'unknown')` : "";
}

/**
 * The candidates for one reader, closest first.
 *
 * Two paths. With a vector the whole pool is ordered by cosine distance, the
 * way the precedent search already works. Without one — a reader who has not
 * consented to anything leaving the server — the tags do the narrowing and the
 * scoring, which costs nothing and reaches no external service.
 */
export async function readWebCaseCandidates({ pool, queryVector = null, facts = {}, limit = CANDIDATE_LIMIT }) {
  const readerMedium = facts.medium && facts.medium !== "unknown" ? facts.medium : null;

  if (queryVector) {
    const params = [toVectorLiteral(queryVector), limit];
    if (readerMedium) params.push(readerMedium);
    // LEFT JOIN, not JOIN: a post collected but not yet embedded is unknown
    // rather than distant, and dropping it here would hide it until something
    // happened to embed it. It sorts last and takes a slot only if one is free.
    const { rows } = await pool.query(
      `SELECT ${SELECT_COLUMNS}, 1 - (e.embedding <=> $1::vector) AS semantic
         FROM web_cases c
         LEFT JOIN web_case_embeddings e ON e.url = c.url
        WHERE ${LIVE} ${mediumClause(readerMedium, 3)}
        ORDER BY e.embedding <=> $1::vector NULLS LAST, c.collected_at DESC
        LIMIT $2`,
      params,
    );
    return rows.map((row) => ({
      item: rowToCase(row),
      linkCheckedAt: row.linkCheckedAt,
      semantic: row.semantic === null ? null : Math.round(Math.max(0, Math.min(Number(row.semantic), 1)) * 100),
    }));
  }

  const params = [limit];
  if (readerMedium) params.push(readerMedium);
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS}
       FROM web_cases c
      WHERE ${LIVE} ${mediumClause(readerMedium, 2)}
      ORDER BY c.ending DESC, c.collected_at DESC
      LIMIT $1`,
    params,
  );
  return rows.map((row) => ({ item: rowToCase(row), linkCheckedAt: row.linkCheckedAt, semantic: null }));
}

/**
 * Sorts the candidates into the groups a reader sees.
 *
 * Pure, so the rules can be tested without a database — which is where the
 * things worth testing live: that a post is in one group and not three, that
 * nothing below the floor is anywhere, and that one site cannot own a group.
 */
export function groupWebCases({
  candidates, facts = {}, role = null,
  minimumBase = WEB_CASE_MINIMUM_BASE, limit = WEB_CASE_POOL_LIMIT,
} = {}) {
  const readerMedium = facts.medium && facts.medium !== "unknown" ? facts.medium : null;
  const strangerOnline = readerFacesStranger({ facts, role });

  const ranked = (candidates || [])
    .map(({ item, semantic }, index) => ({
      item, index, ...scoreWebCase({ item, facts, role, semantic, strangerOnline }),
    }))
    // The medium rule again, for callers that did not narrow in SQL.
    .filter(({ item }) => !readerMedium || !item.medium || item.medium === "unknown" || item.medium === readerMedium)
    .filter(({ base }) => base >= minimumBase)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const taken = new Set();
  const groups = [];
  let shown = 0;

  for (const group of WEB_CASE_GROUPS) {
    const size = Math.min(group.size, Math.max(limit - shown, 0));
    if (size === 0) break;
    const perSource = Math.max(MIN_PER_SOURCE, Math.floor(size * MAX_SOURCE_SHARE));
    const used = new Map();
    const items = [];

    for (const entry of ranked) {
      if (items.length >= size) break;
      if (taken.has(entry.item.url)) continue;
      if (!group.fits(entry.item, { readerMedium, role })) continue;
      const source = webCaseSource(entry.item);
      if (source) {
        if ((used.get(source) || 0) >= perSource) continue;
        used.set(source, (used.get(source) || 0) + 1);
      }
      items.push(entry.item);
      taken.add(entry.item.url);
    }

    if (items.length > 0) {
      groups.push({ id: group.id, title: group.title, note: group.note || null, cases: items });
      shown += items.length;
    }
  }

  return { groups, total: shown };
}

export async function searchWebCasePool({ pool, queryVector = null, facts = {}, role = null }) {
  const candidates = await readWebCaseCandidates({ pool, queryVector, facts });
  const found = groupWebCases({ candidates, facts, role });

  // The oldest check among what is actually on screen, not the newest. The
  // sentence under the list promises the server opened these addresses; the
  // weakest of those promises is the one that should be dated.
  const shown = new Set(found.groups.flatMap((group) => group.cases.map((item) => item.url)));
  const checks = candidates
    .filter((entry) => shown.has(entry.item.url) && entry.linkCheckedAt)
    .map((entry) => new Date(entry.linkCheckedAt).getTime());

  return {
    ...found,
    matching: queryVector ? "semantic" : "tags",
    checkedAt: checks.length > 0 ? new Date(Math.min(...checks)).toISOString() : null,
  };
}

/**
 * What the pool holds, for the dashboard and for the scripts to report.
 *
 * `live` is the number the panel can actually draw on — a post whose link has
 * not been checked is not shown, because the screen's own warning says the
 * server opened every address on it.
 */
export async function readWebCasePoolStats({ pool }) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE link_status BETWEEN 200 AND 399)::int AS live,
            count(*) FILTER (WHERE link_status IS NULL)::int AS unchecked,
            count(*) FILTER (WHERE ending)::int AS "withEnding",
            count(*) FILTER (WHERE collected_by = 'claude')::int AS "byClaude",
            count(DISTINCT medium)::int AS mediums
       FROM web_cases`,
  );
  const { rows: embedded } = await pool.query(
    `SELECT count(*)::int AS n
       FROM web_cases c JOIN web_case_embeddings e ON e.url = c.url`,
  );
  return { ...rows[0], embedded: embedded[0].n };
}
