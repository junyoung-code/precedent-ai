/**
 * Opens every address in the pool and records whether it answered.
 *
 * A thin wrapper: the behaviour, and the reasons for it, live in
 * server/web-case-links.mjs so the import script cannot drift from it.
 *
 * Run it on a schedule. A pool nobody re-checks quietly fills with dead links,
 * and the screen promises the opposite.
 */
import pg from "pg";
import { checkWebCaseLinks } from "../server/web-case-links.mjs";
import { readWebCasePoolStats, readWebCaseUrls } from "../server/web-case-pool.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const delayMs = Number(process.argv[2]) || undefined;

// Oldest check first, which is what makes a run resumable and fair: a run that
// stops halfway has still refreshed the stalest half, and nothing is starved.
const rows = await readWebCaseUrls({ pool });
if (rows.length === 0) {
  console.log("풀이 비어 있습니다. npm run web:pool 을 먼저 돌리십시오.");
  await pool.end();
  process.exit(0);
}

console.log(`${rows.length}건 확인합니다. 한 사이트를 몰아치지 않도록 간격을 둡니다.\n`);

const result = await checkWebCaseLinks({
  pool, rows, delayMs,
  onProgress: ({ kind, host, index, total }) => {
    if (kind === "abandoned") {
      console.log(`  ${host} — 연속 거절. 건너뜁니다 (기존 상태 유지)`);
    } else if (index % 25 === 0) {
      console.log(`  ${index}/${total}…`);
    }
  },
});

console.log(`\n살아 있음 ${result.live} · 사라짐 ${result.gone} · 거절 ${result.refused} · 건너뜀 ${result.skipped} · 로봇 배제 ${result.disallowed}`);
if (result.abandoned.length > 0) {
  console.log(`거절한 호스트: ${result.abandoned.join(", ")} — 나중에 다시 돌리십시오. 이 호스트의 글은 죽은 것으로 표시하지 않았습니다.`);
}

const stats = await readWebCasePoolStats({ pool });
console.log(`풀 ${stats.total}건 중 화면에 나올 수 있는 것 ${stats.live}건 (임베딩 ${stats.embedded})`);

await pool.end();
