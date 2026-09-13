/**
 * Puts hand-collected posts into the pool.
 *
 * The other way in is `refreshWebCaseQuery`, which pays a model with the
 * web_search tool to find posts and write summaries. It works, and it is what
 * fills a combination nobody has collected yet — but 63 of the first 90 posts
 * it produced are from one site, because that site is the only one a search
 * index holds in full. Naver blocks its own crawler from `/qna/detail` and
 * DCInside blocks the AI crawlers by name, so a model searching the web cannot
 * reach either, however plainly it is asked to.
 *
 * This path has no such limit. The posts are found, opened and read first, and
 * the summary is written against the page rather than a search result — which
 * matters more than it sounds: the vector is built from that summary, so the
 * summary is the match quality.
 *
 * Reads every *.json under data/web-cases/. Safe to run repeatedly: the upsert
 * refuses to let a weaker collector overwrite a stronger one, and embedding
 * skips anything whose summary has not changed.
 */
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { createEmbeddingClientFromEnv } from "../server/embedding-client.mjs";
import { embedWebCases } from "../server/web-case-embeddings.mjs";
import { checkWebCaseLinks } from "../server/web-case-links.mjs";
import { readWebCasePoolStats, upsertWebCases } from "../server/web-case-pool.mjs";
import { validateWebCases } from "../server/web-cases.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const directory = new URL("../data/web-cases/", import.meta.url);
let files = [];
try {
  files = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
} catch {
  console.log("data/web-cases/ 가 없습니다.");
  await pool.end();
  process.exit(0);
}
if (files.length === 0) {
  console.log("data/web-cases/ 에 파일이 없습니다.");
  await pool.end();
  process.exit(0);
}

const collected = [];
for (const name of files) {
  const parsed = JSON.parse(await readFile(new URL(name, directory), "utf8"));
  const cases = Array.isArray(parsed.cases) ? parsed.cases : [];

  // The same door the model's output goes through: no unreachable address, no
  // third party's identity in the summary, nothing dressed up as a judgment,
  // no explicit words copied onto our page. Collecting by hand is not a reason
  // to skip the checks — it is a reason they should pass.
  const shaped = validateWebCases(cases, { limit: cases.length });
  const dropped = shaped.dropped.length;
  console.log(`${name.padEnd(34)} ${String(shaped.cases.length).padStart(3)}건${dropped > 0 ? `  (거절 ${dropped}: ${[...new Set(shaped.dropped)].join(", ")})` : ""}`);
  collected.push(...shaped.cases);
}

// One address can be in two files — a post that answers two situations is worth
// filing under both while collecting, but it is one row.
const unique = [...new Map(collected.map((item) => [item.url, item])).values()];
console.log(`\n합계 ${collected.length}건 · 고유 주소 ${unique.length}건`);

const result = await upsertWebCases({ pool, cases: unique, collectedBy: "claude" });
console.log(`저장: 새로 ${result.inserted} · 갱신 ${result.updated} · 유지 ${result.kept} · 거절 ${result.rejected}`);

// Only what this run added or changed. Re-opening pages that were checked last
// week is what `npm run web:verify` is for, and doing it here would make an
// import of three posts take as long as a full sweep.
const fresh = unique.filter((item) => item.url);
console.log(`\n링크 확인 ${fresh.length}건…`);
const checked = await checkWebCaseLinks({
  pool, rows: fresh,
  onProgress: ({ kind, host, index, total }) => {
    if (kind === "abandoned") console.log(`  ${host} — 연속 거절. 건너뜁니다`);
    else if (index % 20 === 0) console.log(`  ${index}/${total}…`);
  },
});
console.log(`살아 있음 ${checked.live} · 사라짐 ${checked.gone} · 거절 ${checked.refused}`);

// After the link check, not before: a vector for a page that turned out to be
// gone is one nobody will ever compare against.
const embeddingClient = createEmbeddingClientFromEnv();
if (!embeddingClient) {
  console.log("\n임베딩 없음 — OPENAI_API_KEY 가 없어 태그 랭킹으로만 동작합니다.");
} else {
  // Everything live and unembedded, not only what this run added. The pool was
  // seeded from cached batches and some of those had never been embedded — they
  // sort last in the semantic path forever, which looks like the ranking
  // disliking them rather than the vector being absent. Cheap to close: a post
  // is about 150 tokens against $0.02 per million.
  const { rows: pending } = await pool.query(
    `SELECT c.url, c.title, c.quote, c.medium, c.expression
       FROM web_cases c
       LEFT JOIN web_case_embeddings e ON e.url = c.url
      WHERE c.link_status BETWEEN 200 AND 399 AND e.url IS NULL`,
  );
  if (pending.length > 0) console.log(`벡터 없는 글 ${pending.length}건까지 함께 임베딩합니다.`);
  const embedded = await embedWebCases({ pool, embeddingClient, cases: pending });
  console.log(`\n임베딩: 새로 ${embedded.embedded} · 이미 있음 ${embedded.skipped} · 실패 ${embedded.failed}`);
}

const stats = await readWebCasePoolStats({ pool });
console.log(`\n풀 ${stats.total}건 · 화면에 나올 수 있는 것 ${stats.live}건 · 임베딩 ${stats.embedded}건 · 결말 있음 ${stats.withEnding}건 · 직접 수집 ${stats.byClaude}건`);

await pool.end();
