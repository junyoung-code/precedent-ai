import pg from "pg";
import { OpenAiAnalysisClient } from "../server/analysis-client.mjs";
import { validateGroundedAnalysis } from "../server/grounded-analysis.mjs";
import { ARTICLE_13_ELEMENTS, mapFactsToArticle13 } from "../server/statute-elements.mjs";
import { COMMUNICATION_OBSCENITY_ARTICLE, readStatuteArticle } from "../server/statutes.mjs";
import { searchPrecedents } from "../server/search-precedents.mjs";
import { createEmbeddingClientFromEnv } from "../server/embedding-client.mjs";
import { extractFactTags } from "../src/lib/fact-tags.js";

const MODELS = (process.argv[2] || "gpt-5.6-sol").split(",");
const DESCRIPTION = process.argv[3]
  || "온라인 게임을 하다가 같은 게임을 하던 상대와 시비가 붙었습니다. 그 사람이 게임 채팅창으로 제 부모를 성적으로 비하하는 표현이 담긴 메시지를 여러 차례 보냈고, 저는 채팅창에서 바로 확인했습니다.";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const statute = await readStatuteArticle({ pool, ...COMMUNICATION_OBSCENITY_ARTICLE });
const facts = extractFactTags(DESCRIPTION);
const elements = mapFactsToArticle13(facts);
let results = [];
try {
  results = (await searchPrecedents({ pool, query: DESCRIPTION, limit: 3, embeddingClient: createEmbeddingClientFromEnv() })).results || [];
} catch { /* an out-of-scope query legitimately returns nothing */ }
await pool.end();

const label = { present: "언급됨", absent: "아니라고 적음", unclear: "확인 안 됨" };
console.log(`입력: ${DESCRIPTION}\n검색된 판례: ${results.map((r) => r.caseNumber).join(", ") || "없음"}`);
console.log(`\n[규칙으로 정한 요건별 판정 — 모델이 바꿀 수 없음]`);
for (const item of elements) console.log(`  ${item.label.padEnd(22)} ${label[item.mention]}  — ${item.evidence}`);

for (const model of MODELS) {
  const client = new OpenAiAnalysisClient({ apiKey: process.env.OPENAI_API_KEY, model });
  const started = Date.now();
  const { analysis, usage } = await client.analyze({ statute, elements, description: DESCRIPTION, precedents: results });
  const checked = validateGroundedAnalysis(analysis, new Set(results.map((r) => r.caseNumber)));

  console.log(`\n${"=".repeat(72)}\n${model}  (${Math.round((Date.now() - started) / 1000)}초 · 입력 ${usage?.input_tokens} · 출력 ${usage?.output_tokens} · 버려진 문장 ${checked.dropped.length})\n${"=".repeat(72)}`);
  console.log("\n▸ 종합 설명");
  checked.overview.forEach((t) => console.log(`   ${t}`));
  console.log("\n▸ 요건 설명");
  checked.elementNotes.forEach((n) => console.log(`   [${ARTICLE_13_ELEMENTS.find((e) => e.id === n.id)?.label}] ${n.text}`));
  console.log("\n▸ 판례 설명");
  checked.precedentNotes.forEach((n) => console.log(`   (${n.caseNumber}) ${n.text}`));
  console.log("\n▸ 다음 단계");
  checked.nextSteps.forEach((t) => console.log(`   · ${t}`));
}
