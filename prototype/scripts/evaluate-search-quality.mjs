import pg from "pg";
import { createEmbeddingClientFromEnv } from "../server/embedding-client.mjs";
import { evaluateSearchQuality } from "../server/search-quality-evaluator.mjs";
import { searchPrecedents } from "../server/search-precedents.mjs";
import { SEARCH_QUALITY_CASES } from "../tests/fixtures/search-quality-cases.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

// Measure whichever path this environment is configured for, so the numbers
// describe what users actually get. Without a key this stays the local path,
// which is what it has always measured. Costs one embedding per case.
const embeddingClient = createEmbeddingClientFromEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const report = await evaluateSearchQuality({
    cases: SEARCH_QUALITY_CASES,
    search: ({ query, limit }) => searchPrecedents({ pool, query, limit, embeddingClient }),
  });
  console.log(JSON.stringify({ mode: embeddingClient ? "embedding" : "local", ...report }, null, 2));
} finally {
  await pool.end();
}
