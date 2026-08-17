import pg from "pg";
import { evaluateSearchQuality } from "../server/search-quality-evaluator.mjs";
import { searchPrecedents } from "../server/search-precedents.mjs";
import { SEARCH_QUALITY_CASES } from "../tests/fixtures/search-quality-cases.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const report = await evaluateSearchQuality({
    cases: SEARCH_QUALITY_CASES,
    search: ({ query, limit }) => searchPrecedents({ pool, query, limit, embeddingClient: null }),
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await pool.end();
}
