import pg from "pg";
import { LawOpenDataClient } from "../server/law-open-data.mjs";
import { syncLawOpenData } from "../server/sync-law-open-data.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

const query = process.argv.slice(2).join(" ") || "통신매체이용음란";
const limit = Number(process.env.SYNC_LIMIT || 20);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const api = new LawOpenDataClient({ oc: process.env.LAW_OPEN_DATA_OC });

try {
  const summary = await syncLawOpenData({ pool, api, query, limit });
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await pool.end();
}
