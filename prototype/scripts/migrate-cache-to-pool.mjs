/**
 * Moves the posts already collected into the pool, once.
 *
 * Everything in `web_case_cache` was paid for — model calls with the web_search
 * tool, plus a gallery crawl — and most of it is good. Starting the pool empty
 * would mean buying it again, so this seeds it from what is there.
 *
 * Safe to run twice: the upsert refuses to let a weaker source overwrite a
 * stronger one, and everything here is the weakest kind.
 */
import pg from "pg";
import { COLLECTORS, readWebCasePoolStats, upsertWebCases } from "../server/web-case-pool.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Which collector a stored post came from, read off its address.
 *
 * The batches did not record this — everything in them arrived through
 * `refreshWebCaseQuery`, which merges a paid web search with the gallery crawl
 * and does not mark which half an item came from. The host is the honest
 * reconstruction: only the gallery collector ever produced a dcinside URL.
 */
function collectorFor(url) {
  try {
    return new URL(url).hostname.endsWith("dcinside.com") ? "dcinside" : "openai_web_search";
  } catch {
    return "openai_web_search";
  }
}

const { rows } = await pool.query("SELECT query_key, cases FROM web_case_cache");

const byUrl = new Map();
let seen = 0;
for (const row of rows) {
  const cases = Array.isArray(row.cases) ? row.cases : [];
  for (const item of cases) {
    seen += 1;
    // A post can sit in several batches — 10 of them do. The first copy wins;
    // they are the same summary, written in the same refresh.
    if (item?.url && !byUrl.has(item.url)) byUrl.set(item.url, item);
  }
}

console.log(`캐시 ${rows.length}개 키 · 글 ${seen}건 · 고유 주소 ${byUrl.size}건\n`);

let total = { inserted: 0, updated: 0, kept: 0, rejected: 0 };
for (const collector of COLLECTORS) {
  const mine = [...byUrl.values()].filter((item) => collectorFor(item.url) === collector);
  if (mine.length === 0) continue;
  const result = await upsertWebCases({ pool, cases: mine, collectedBy: collector });
  console.log(`  ${collector.padEnd(18)} 새로 ${result.inserted} · 갱신 ${result.updated} · 유지 ${result.kept} · 거절 ${result.rejected}`);
  for (const key of Object.keys(total)) total[key] += result[key];
}

const stats = await readWebCasePoolStats({ pool });
console.log(`\n풀 ${stats.total}건 (임베딩 ${stats.embedded} · 결말 있음 ${stats.withEnding} · 링크 미확인 ${stats.unchecked})`);
if (total.rejected > 0) console.log(`거절 ${total.rejected}건 — 주소·제목·요약·출처 중 빠진 것이 있는 항목입니다.`);
console.log(`\n다음: npm run web:verify 로 링크를 확인해야 화면에 나옵니다.`);

await pool.end();
