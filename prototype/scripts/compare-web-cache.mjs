/**
 * Measures what caching the web search would cost in quality, before building it.
 *
 * Today each search asks the model to find similar posts while it can see the
 * reader's own sentences. A cache cannot: it is keyed on the generalized query,
 * which is all thousands of readers share. The question this answers is whether
 * that difference shows up in what lands on screen.
 *
 * Nothing is written anywhere. This is a measurement, not the feature.
 */
import pg from "pg";
import { OpenAiAnalysisClient } from "../server/analysis-client.mjs";
import { buildWebSearchQuery, selectWebCases, validateWebCases, verifyWebCases } from "../server/web-cases.mjs";
import { mapFactsToArticle13 } from "../server/statute-elements.mjs";
import { COMMUNICATION_OBSCENITY_ARTICLE, readStatuteArticle } from "../server/statutes.mjs";
import { extractFactTags } from "../src/lib/fact-tags.js";

const MODEL = process.env.ANALYSIS_MODEL;
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_REQUIRED");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
if (!MODEL) throw new Error("ANALYSIS_MODEL_REQUIRED");

// The pair at the top is the point of the exercise: identical tags, opposite
// sides. If a shared cache row cannot tell them apart, that is worth knowing
// before it ships.
const CASES = [
  ["게임채팅·피해자", "victim", "롤 하다가 시비가 붙었는데 상대가 채팅으로 제 어머니를 성적으로 비하하는 패드립을 여러 번 쳤습니다. 캡처해뒀고 고소하고 싶습니다."],
  ["게임채팅·피신고인", "reported", "롤 하다가 시비가 붙어서 제가 상대한테 패드립을 쳤습니다. 상대가 캡처했다고 하는데 고소당할까요."],
  ["카카오톡·피해자", "victim", "카카오톡 오픈채팅방에서 모르는 사람이 저에게 성적인 메시지를 계속 보냈습니다."],
  ["SNS디엠·피신고인", "reported", "인스타 디엠으로 상대에게 성적인 농담을 몇 번 보냈는데 차단당했습니다. 신고당할까 걱정입니다."],
  ["문자·피해자", "victim", "모르는 번호로 성적인 내용의 문자가 여러 차례 왔습니다."],
  ["송금메모·피해자", "victim", "모르는 사람이 제 계좌로 1원씩 입금하면서 송금 메모에 성적인 욕설을 적어 보냈습니다."],
];

// The live side is the expensive half and does not change between runs, so a
// re-measurement after tuning the batch can skip it.
const SKIP_LIVE = process.env.COMPARE_SKIP_LIVE === "true";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const statute = await readStatuteArticle({ pool, ...COMMUNICATION_OBSCENITY_ARTICLE });
await pool.end();
if (!statute) throw new Error("STATUTE_MISSING");

const live = new OpenAiAnalysisClient({ apiKey: process.env.OPENAI_API_KEY, model: MODEL, webSearch: true });
const batch = new OpenAiAnalysisClient({ apiKey: process.env.OPENAI_API_KEY, model: MODEL });

const key = (item) => item.url.replace(/[?#].*$/, "");
const totals = { liveIn: 0, liveOut: 0, batchIn: 0, batchOut: 0, liveMs: 0, batchMs: 0, overlap: 0, pairs: 0 };
const batchCache = new Map();
const rows = [];

for (const [label, role, description] of CASES) {
  const facts = extractFactTags(description);
  const query = buildWebSearchQuery(facts);

  // Today's path: the model sees the description while picking.
  let started = Date.now();
  let liveCases = [];
  if (!SKIP_LIVE) {
    const { analysis, usage: liveUsage } = await live.analyze({
      statute, elements: mapFactsToArticle13(facts), description, precedents: [], searchQuery: query,
    });
    totals.liveMs += Date.now() - started;
    totals.liveIn += liveUsage?.input_tokens || 0;
    totals.liveOut += liveUsage?.output_tokens || 0;
    liveCases = (await verifyWebCases({ cases: validateWebCases(analysis.webCases, { limit: 3 }).cases })).cases;
  }

  // Cached path: one batch per query, reused by everyone who lands on it.
  if (!batchCache.has(query)) {
    started = Date.now();
    const { webCases, usage } = await batch.searchWebCases({ query });
    totals.batchMs += Date.now() - started;
    totals.batchIn += usage?.input_tokens || 0;
    totals.batchOut += usage?.output_tokens || 0;
    batchCache.set(query, (await verifyWebCases({ cases: validateWebCases(webCases).cases })).cases);
  }
  const stored = batchCache.get(query);
  const picked = selectWebCases({ cases: stored, facts, role, limit: 3 });

  const shared = picked.filter((item) => liveCases.some((other) => key(other) === key(item)));
  totals.overlap += shared.length;
  totals.pairs += Math.max(liveCases.length, picked.length);
  rows.push({ label, role, query, liveCases, stored, picked, shared: shared.length });

  console.log(`\n${"=".repeat(74)}\n${label}  ·  ${query}\n${"=".repeat(74)}`);
  console.log(`\n[즉석본 — 사용자 문장을 보고 고름]`);
  liveCases.forEach((item) => console.log(`   · ${item.title}\n     ${key(item)}`));
  console.log(`\n[캐시본 — 저장 ${stored.length}건 중 태그로 고른 3건]`);
  picked.forEach((item) => console.log(`   · ${item.title}  (${item.medium}/${item.expression}/${item.writerRole})\n     ${key(item)}`));
  console.log(`\n겹친 글: ${shared.length} / ${Math.max(liveCases.length, picked.length)}`);
}

// Does the writer-role signal change anything for two readers sharing a row?
const pair = rows.filter((row) => row.query === rows[0].query);
if (pair.length === 2) {
  const [a, b] = pair;
  const same = a.picked.map(key).join("|") === b.picked.map(key).join("|");
  console.log(`\n${"=".repeat(74)}\n역할 쌍 (같은 캐시 줄 공유)\n${"=".repeat(74)}`);
  console.log(`  ${a.label}: ${a.picked.map((item) => item.title).join(" / ")}`);
  console.log(`  ${b.label}: ${b.picked.map((item) => item.title).join(" / ")}`);
  console.log(`  순서가 ${same ? "같습니다 — 입장 태그가 아무 일도 하지 않았습니다" : "다릅니다 — 입장 태그가 순서를 바꿨습니다"}`);
  console.log(`  저장분의 입장 태그 분포: ${JSON.stringify(a.stored.reduce((count, item) => ({ ...count, [item.writerRole]: (count[item.writerRole] || 0) + 1 }), {}))}`);
}

console.log(`\n${"=".repeat(74)}\n합계\n${"=".repeat(74)}`);
console.log(`겹친 글          ${totals.overlap} / ${totals.pairs}`);
if (!SKIP_LIVE) console.log(`즉석본  호출 ${CASES.length}회 · 토큰 ${totals.liveIn}/${totals.liveOut} · 평균 ${Math.round(totals.liveMs / CASES.length / 1000)}초`);
console.log(`캐시본  호출 ${batchCache.size}회 · 토큰 ${totals.batchIn}/${totals.batchOut} · 평균 ${Math.round(totals.batchMs / batchCache.size / 1000)}초`);
console.log(`\n캐시 적중 시 사용자당 웹 호출 0회 · 위 ${CASES.length}건은 캐시 줄 ${batchCache.size}개로 덮인다`);
