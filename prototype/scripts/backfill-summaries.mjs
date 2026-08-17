import pg from "pg";
import { backfillPrecedentSummaries } from "../server/precedent-summaries.mjs";
import { DEFAULT_SUMMARY_MODEL, OpenAiSummaryClient } from "../server/summary-client.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_REQUIRED");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const summaryClient = new OpenAiSummaryClient({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL,
});

try {
  const result = await backfillPrecedentSummaries({
    pool,
    summaryClient,
    limit: Number(process.env.SUMMARY_BACKFILL_LIMIT || 100),
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
