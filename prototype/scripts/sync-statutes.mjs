import pg from "pg";
import { LawOpenDataClient } from "../server/law-open-data.mjs";
import { COMMUNICATION_OBSCENITY_ARTICLE, syncStatuteArticle } from "../server/statutes.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const api = new LawOpenDataClient({ oc: process.env.LAW_OPEN_DATA_OC });

try {
  const article = await syncStatuteArticle({ pool, api, ...COMMUNICATION_OBSCENITY_ARTICLE });
  console.log(JSON.stringify(article, null, 2));
} finally {
  await pool.end();
}
