import { readFile } from "node:fs/promises";

const PURPOSES = new Set(["search_embedding", "case_analysis", "summary", "backfill_embedding", "other"]);

const INSERT_SQL = `INSERT INTO api_usage
  (purpose, model, input_tokens, cached_input_tokens, output_tokens, web_searches, latency_ms, ok)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

/**
 * Writes down what a call cost, and never why it was made.
 *
 * The service deletes a description as the search settles, so this must not
 * become where it survives: the row carries a model name and some integers.
 *
 * It also never throws. A search that worked must not be reported as failed
 * because the bookkeeping behind it did.
 */
export async function recordApiUsage({ pool, purpose, model, usage, webSearches = 0, latencyMs = 0, ok = true }) {
  if (!pool || !PURPOSES.has(purpose) || !model) return false;
  try {
    await pool.query(INSERT_SQL, [
      purpose,
      String(model),
      // Two endpoints, two names for the same number: the responses API says
      // input_tokens and the embeddings API says prompt_tokens. Reading only
      // one of them files every embedding call as having cost nothing.
      count(usage?.input_tokens ?? usage?.prompt_tokens),
      count(usage?.input_tokens_details?.cached_tokens ?? usage?.prompt_tokens_details?.cached_tokens),
      count(usage?.output_tokens ?? usage?.completion_tokens),
      count(webSearches),
      count(latencyMs),
      ok !== false,
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function readModelPrices(path = new URL("../config/model-prices.json", import.meta.url)) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return { krwPerUsd: null, webSearchPerCall: null, models: {} };
  }
}

function money(tokens, perMillion) {
  return perMillion == null ? null : (tokens / 1_000_000) * perMillion;
}

/**
 * Turns rows and a price table into what the calls cost.
 *
 * A missing price is reported as missing rather than as zero. A dashboard that
 * quietly treats an unpriced model as free is worse than one that says it does
 * not know, because the number looks finished.
 */
export function priceUsage(row, prices) {
  const model = prices?.models?.[row.model];
  if (!model) return { usd: null, priced: false };

  const fresh = Math.max(row.inputTokens - row.cachedInputTokens, 0);
  const parts = [
    money(fresh, model.inputPerMillion),
    money(row.cachedInputTokens, model.cachedInputPerMillion ?? model.inputPerMillion),
    money(row.outputTokens, model.outputPerMillion),
    row.webSearches > 0 ? (prices.webSearchPerCall == null ? null : row.webSearches * prices.webSearchPerCall) : 0,
  ];
  if (parts.some((part) => part == null)) return { usd: null, priced: false };
  return { usd: parts.reduce((total, part) => total + part, 0), priced: true };
}

const SUMMARY_SQL = `SELECT
    purpose, model,
    count(*)::int AS calls,
    count(*) FILTER (WHERE NOT ok)::int AS failed,
    coalesce(sum(input_tokens), 0)::bigint AS input_tokens,
    coalesce(sum(cached_input_tokens), 0)::bigint AS cached_input_tokens,
    coalesce(sum(output_tokens), 0)::bigint AS output_tokens,
    coalesce(sum(web_searches), 0)::bigint AS web_searches,
    coalesce(round(avg(latency_ms)), 0)::int AS avg_latency_ms
  FROM api_usage
  WHERE created_at >= now() - ($1 || ' days')::interval
  GROUP BY purpose, model
  ORDER BY sum(input_tokens + output_tokens) DESC`;

// A search is one analysis call. Counting those rather than rows is what makes
// "per search" mean the thing anyone actually wants to know.
const SEARCH_COUNT_SQL = `SELECT count(*)::int AS searches
  FROM api_usage
  WHERE purpose = 'case_analysis' AND created_at >= now() - ($1 || ' days')::interval`;

const DAILY_SQL = `SELECT
    (created_at AT TIME ZONE 'Asia/Seoul')::date AS day,
    count(*) FILTER (WHERE purpose = 'case_analysis')::int AS searches,
    coalesce(sum(input_tokens), 0)::bigint AS input_tokens,
    coalesce(sum(output_tokens), 0)::bigint AS output_tokens,
    coalesce(sum(web_searches), 0)::bigint AS web_searches
  FROM api_usage
  WHERE created_at >= now() - ($1 || ' days')::interval
  GROUP BY 1 ORDER BY 1 DESC`;

function toRow(raw) {
  return {
    purpose: raw.purpose,
    model: raw.model,
    calls: Number(raw.calls),
    failed: Number(raw.failed),
    inputTokens: Number(raw.input_tokens),
    cachedInputTokens: Number(raw.cached_input_tokens),
    outputTokens: Number(raw.output_tokens),
    webSearches: Number(raw.web_searches),
    avgLatencyMs: Number(raw.avg_latency_ms),
  };
}

export async function readUsageSummary({ pool, days = 30, prices }) {
  const window = String(Math.min(Math.max(Number(days) || 30, 1), 365));
  const [rows, searchRows, daily] = await Promise.all([
    pool.query(SUMMARY_SQL, [window]),
    pool.query(SEARCH_COUNT_SQL, [window]),
    pool.query(DAILY_SQL, [window]),
  ]);

  const searches = searchRows.rows[0]?.searches || 0;
  const priceTable = prices || { models: {} };
  let usd = 0;
  let unpriced = 0;

  const byModel = rows.rows.map(toRow).map((row) => {
    const priced = priceUsage(row, priceTable);
    if (priced.priced) usd += priced.usd;
    else unpriced += 1;
    return { ...row, usd: priced.usd, priced: priced.priced };
  });

  const krwPerUsd = Number(priceTable.krwPerUsd) || null;
  // One unpriced model makes every total a lie in the direction that matters.
  // Summing what is known and showing it as the answer renders "0원" for a
  // service that is spending money, which is worse than admitting the gap.
  const complete = unpriced === 0 && byModel.length > 0;
  const totalUsd = complete ? usd : null;
  const perSearchUsd = complete && searches > 0 ? usd / searches : null;
  return {
    days: Number(window),
    searches,
    byModel,
    daily: daily.rows.map((row) => ({
      day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day),
      searches: Number(row.searches),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      webSearches: Number(row.web_searches),
    })),
    // Every unpriced model makes the total a floor rather than a total, and the
    // dashboard has to say so instead of rounding the gap away.
    unpricedModels: unpriced,
    complete,
    // What the priced share alone came to, so a partly filled table still shows
    // something — labelled as a floor, never as the total.
    pricedOnlyUsd: usd,
    totalUsd,
    totalKrw: totalUsd == null || krwPerUsd == null ? null : totalUsd * krwPerUsd,
    perSearchUsd,
    perSearchKrw: perSearchUsd == null || krwPerUsd == null ? null : perSearchUsd * krwPerUsd,
    krwPerUsd,
  };
}

// Semantic search only considers a precedent whose link was checked in the last
// 24 hours. Nothing tells anyone when that lapses: the search quietly drops to
// keyword matching and still returns cards, so the only visible symptom is that
// results get worse. It cost a day of chasing a quality number that had not
// actually moved, which is why it is on the dashboard.
const CORPUS_SQL = `SELECT
    count(*)::int AS searchable,
    count(*) FILTER (WHERE link_checked_at >= now() - interval '24 hours')::int AS fresh,
    count(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded,
    max(link_checked_at) AS newest_check
  FROM precedents
  WHERE searchable = true AND verified_at IS NOT NULL`;

export async function readCorpusHealth({ pool }) {
  try {
    const { rows } = await pool.query(CORPUS_SQL);
    const row = rows[0] || {};
    const searchable = Number(row.searchable) || 0;
    const fresh = Number(row.fresh) || 0;
    return {
      searchable,
      fresh,
      embedded: Number(row.embedded) || 0,
      newestCheck: row.newest_check ? new Date(row.newest_check).toISOString() : null,
      // Below this the hybrid search has nothing to rank and falls back.
      semanticSearchReady: fresh > 0,
      staleCount: searchable - fresh,
    };
  } catch {
    return null;
  }
}
