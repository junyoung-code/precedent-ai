import pg from "pg";
import { purgeExpiredIntakeSessions } from "../server/intake-sessions.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await purgeExpiredIntakeSessions({ pool });
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
