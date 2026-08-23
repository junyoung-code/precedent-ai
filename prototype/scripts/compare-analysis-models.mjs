import pg from "pg";
import { OpenAiAnalysisClient } from "../server/analysis-client.mjs";
import { validateGroundedAnalysis } from "../server/grounded-analysis.mjs";
import { mapFactsToArticle13 } from "../server/statute-elements.mjs";
import { COMMUNICATION_OBSCENITY_ARTICLE, readStatuteArticle } from "../server/statutes.mjs";
import { searchPrecedents } from "../server/search-precedents.mjs";
import { createEmbeddingClientFromEnv } from "../server/embedding-client.mjs";
import { extractFactTags } from "../src/lib/fact-tags.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_REQUIRED");

const CANDIDATES = (process.argv[2] || "gpt-5.6-sol,gpt-5.6-luna,gpt-5.6-terra,gpt-5.5,gpt-5.4,gpt-5-mini").split(",");

const CASES = [
  ["송금 메모", "모르는 사람이 제 은행 계좌로 1원씩 여러 번 입금했습니다. 입금할 때마다 송금 메모란에 성적인 욕설과 제 신체를 비하하는 문구를 적어서 보냈고, 저는 은행 앱 거래내역에서 그 내용을 모두 확인했습니다."],
  ["게임 채팅", "온라인 게임을 하다가 같은 게임을 하던 상대와 시비가 붙었습니다. 그 사람이 게임 채팅창으로 제 부모를 성적으로 비하하는 표현이 담긴 메시지를 여러 차례 보냈고, 저는 채팅창에서 바로 확인했습니다."],
  ["트위터 멘션", "트위터에서 논쟁하다가 제가 그 사람 계정을 차단했습니다. 그 뒤에 그 사람이 자기 계정에 제 계정을 @로 멘션하면서 성적 수치심을 일으키는 글을 올렸습니다. 저는 차단한 상태여서 알림을 받지 못했고, 나중에 그 사람 계정을 직접 검색해서 그 글을 봤습니다."],
  ["판례 0건", "친구가 돈을 갚지 않아서 계속 연락했는데 답이 없습니다. 어떻게 해야 할지 모르겠습니다."],
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const embeddingClient = createEmbeddingClientFromEnv();
const statute = await readStatuteArticle({ pool, ...COMMUNICATION_OBSCENITY_ARTICLE });
if (!statute) throw new Error("STATUTE_MISSING: npm run sync:statute 먼저 실행하세요.");

// Build each case's context once so every model sees exactly the same input.
const prepared = [];
for (const [label, description] of CASES) {
  const facts = extractFactTags(description);
  let results = [];
  try {
    const found = await searchPrecedents({ pool, query: description, limit: 3, embeddingClient });
    results = found.results || [];
  } catch { /* out-of-scope queries legitimately return nothing */ }
  prepared.push({
    label,
    allowed: new Set(results.map((item) => item.caseNumber)),
    input: {
      statute,
      elements: mapFactsToArticle13(facts),
      description,
      precedents: results,
      searchQuery: null,
    },
  });
}
await pool.end();

console.log(`사례 ${prepared.length}개 · 모델 ${CANDIDATES.length}개`);

const rows = [];

for (const model of CANDIDATES) {
  const row = { model, ok: 0, failed: 0, ms: 0, inTok: 0, outTok: 0, verdictDrops: 0, fakeCites: 0, error: "" };
  for (const item of prepared) {
    const client = new OpenAiAnalysisClient({ apiKey: process.env.OPENAI_API_KEY, model });
    const started = Date.now();
    try {
      const { analysis, usage } = await client.analyze(item.input);
      row.ms += Date.now() - started;
      row.inTok += usage?.input_tokens || 0;
      row.outTok += usage?.output_tokens || 0;
      const checked = validateGroundedAnalysis(analysis, item.allowed);
      row.verdictDrops += checked.dropped.filter((d) => d !== "precedentNote").length;
      row.fakeCites += (analysis.precedentNotes || []).filter((n) => !item.allowed.has(String(n?.caseNumber))).length;
        row.ok += 1;
    } catch (error) {
      row.failed += 1;
      row.error = row.error || `${error.code || error.name}`;
    }
  }
  rows.push(row);
  console.log(
    `${model.padEnd(16)} 성공 ${row.ok}/${prepared.length}` +
    `  평균 ${row.ok ? Math.round(row.ms / row.ok / 1000) : "-"}초` +
    `  토큰 ${row.inTok}/${row.outTok}` +
    `  금지표현삭제 ${row.verdictDrops}` +
    `  없는판례인용 ${row.fakeCites}` +
    (row.error ? `  [${row.error}]` : ""),
  );
}

console.log("\n" + JSON.stringify(rows, null, 2));
