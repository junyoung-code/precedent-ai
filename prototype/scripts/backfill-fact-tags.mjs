import pg from "pg";
import { backfillPrecedentFactTags } from "../server/precedent-fact-tags.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const summary = await backfillPrecedentFactTags({
    pool,
    limit: Number(process.env.FACT_TAG_LIMIT || 1000),
  });
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await pool.end();
}
