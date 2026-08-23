import assert from "node:assert/strict";
import test from "node:test";
import { priceUsage, readCorpusHealth, readUsageSummary, recordApiUsage } from "../server/api-usage.mjs";

const row = {
  model: "gpt-5.6-terra",
  inputTokens: 17_000,
  cachedInputTokens: 4_000,
  outputTokens: 2_000,
  webSearches: 1,
};

test("bills cached input at its own rate and adds the tool call", () => {
  const prices = {
    webSearchPerCall: 0.01,
    models: { "gpt-5.6-terra": { inputPerMillion: 1, cachedInputPerMillion: 0.1, outputPerMillion: 8 } },
  };
  // 13,000 fresh + 4,000 cached + 2,000 out, plus one search.
  const expected = (13_000 / 1e6) * 1 + (4_000 / 1e6) * 0.1 + (2_000 / 1e6) * 8 + 0.01;
  const priced = priceUsage(row, prices);
  assert.equal(priced.priced, true);
  assert.ok(Math.abs(priced.usd - expected) < 1e-9);
});

test("charges cached input at the normal rate when no cached rate is given", () => {
  const prices = { webSearchPerCall: 0, models: { "gpt-5.6-terra": { inputPerMillion: 1, outputPerMillion: 8 } } };
  assert.ok(Math.abs(priceUsage(row, prices).usd - ((17_000 / 1e6) * 1 + (2_000 / 1e6) * 8)) < 1e-9);
});

test("reports a missing price as missing rather than as free", () => {
  // A dashboard that treats an unpriced model as zero looks finished while
  // being wrong, which is the failure this whole table exists to avoid.
  for (const prices of [
    { models: {} },
    { models: { "gpt-5.6-terra": { inputPerMillion: null, outputPerMillion: 8 } } },
    { webSearchPerCall: null, models: { "gpt-5.6-terra": { inputPerMillion: 1, outputPerMillion: 8 } } },
  ]) {
    const priced = priceUsage(row, prices);
    assert.equal(priced.priced, false);
    assert.equal(priced.usd, null);
  }
});

test("does not charge for a web search that did not happen", () => {
  const prices = { webSearchPerCall: null, models: { "gpt-5.6-terra": { inputPerMillion: 1, outputPerMillion: 8 } } };
  assert.equal(priceUsage({ ...row, webSearches: 0 }, prices).priced, true);
});

test("writes down the shape of a call and nothing about its content", async () => {
  const calls = [];
  const pool = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; } };
  await recordApiUsage({
    pool,
    purpose: "case_analysis",
    model: "gpt-5.6-terra",
    usage: { input_tokens: 17_123, output_tokens: 1_878, input_tokens_details: { cached_tokens: 4_498 } },
    webSearches: 2,
    latencyMs: 18_400,
  });
  assert.deepEqual(calls[0].values, ["case_analysis", "gpt-5.6-terra", 17123, 4498, 1878, 2, 18400, true]);
  // Every value is a name or a number. There is nowhere for a description to go.
  for (const value of calls[0].values) assert.ok(["string", "number", "boolean"].includes(typeof value));
});

test("does not fail the search it is measuring", async () => {
  // The bill is the least important thing in the request.
  const pool = { query: async () => { throw new Error("db is down"); } };
  assert.equal(await recordApiUsage({ pool, purpose: "case_analysis", model: "m", usage: {} }), false);
  assert.equal(await recordApiUsage({ pool: null, purpose: "case_analysis", model: "m" }), false);
  assert.equal(await recordApiUsage({ pool, purpose: "정체불명", model: "m" }), false);
});

test("reads the token count under whichever name the endpoint uses", async (t) => {
  // The embeddings endpoint says prompt_tokens where the responses endpoint
  // says input_tokens. Reading one name files every embedding call as free.
  const calls = [];
  const pool = { query: async (sql, values) => { calls.push(values); return { rows: [] }; } };
  await recordApiUsage({
    pool, purpose: "search_embedding", model: "text-embedding-3-small",
    usage: { prompt_tokens: 61, total_tokens: 61 },
  });
  assert.equal(calls[0][2], 61);
});

test("says when semantic search has quietly stopped working", async () => {
  // Link checks lapse after 24 hours and the search drops to keyword matching
  // without saying so — the cards keep coming, they are just worse.
  const health = async (fresh) => readCorpusHealth({
    pool: { query: async () => ({ rows: [{ searchable: 51, fresh, embedded: 51, newest_check: "2026-08-18T08:48:32.912Z" }] }) },
  });
  assert.equal((await health(0)).semanticSearchReady, false);
  assert.equal((await health(0)).staleCount, 51);
  assert.equal((await health(51)).semanticSearchReady, true);
  assert.equal((await health(51)).staleCount, 0);
  // A dashboard that cannot read the corpus must not claim it is healthy.
  assert.equal(await readCorpusHealth({ pool: { query: async () => { throw new Error("down"); } } }), null);
});

test("refuses to report a total while any model is unpriced", async () => {
  // The first build of this dashboard rendered "검색 1회당 0원" for a search that
  // had just spent real money, because the unpriced model summed to nothing.
  const rows = [
    { purpose: "case_analysis", model: "gpt-5.6-terra", calls: 1, failed: 0, input_tokens: 14301, cached_input_tokens: 0, output_tokens: 1838, web_searches: 1, avg_latency_ms: 19351 },
    { purpose: "search_embedding", model: "text-embedding-3-small", calls: 3, failed: 0, input_tokens: 380, cached_input_tokens: 0, output_tokens: 0, web_searches: 0, avg_latency_ms: 767 },
  ];
  const pool = { query: async (sql) => {
    if (String(sql).includes("AS searches")) return { rows: [{ searches: 1 }] };
    if (String(sql).includes("AS day")) return { rows: [] };
    return { rows };
  } };
  const prices = { krwPerUsd: 1400, webSearchPerCall: null, models: { "text-embedding-3-small": { inputPerMillion: 0.02, outputPerMillion: 0 } } };

  const partial = await readUsageSummary({ pool, prices });
  assert.equal(partial.complete, false);
  assert.equal(partial.unpricedModels, 1);
  assert.equal(partial.totalKrw, null);
  assert.equal(partial.perSearchKrw, null);
  // The priced share is still reported, just never as the answer.
  assert.ok(partial.pricedOnlyUsd > 0);

  const full = await readUsageSummary({ pool, prices: {
    ...prices, webSearchPerCall: 0.01,
    models: { ...prices.models, "gpt-5.6-terra": { inputPerMillion: 1, outputPerMillion: 8 } },
  } });
  assert.equal(full.complete, true);
  assert.ok(full.perSearchKrw > 0);
});
