import pg from "pg";
import { pruneUnrelatedPrecedents } from "../server/prune-precedents.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

// Deleting is not reversible, so the default run only reports what it would
// remove. Mirrors `rights:law -- --confirm-approved`.
const confirm = process.argv.includes("--confirm");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const summary = await pruneUnrelatedPrecedents({ pool, confirm });
  console.log(JSON.stringify(summary, null, 2));
  if (!confirm && summary.unrelated > 0) {
    console.log("\n삭제하려면: npm run data:prune -- --confirm");
  }
} finally {
  await pool.end();
}
