import pg from "pg";
import { verifyPrecedents } from "../server/source-verifier.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const summary = await verifyPrecedents({
    pool,
    limit: Number(process.env.VERIFY_LIMIT || 100),
  });
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await pool.end();
}
