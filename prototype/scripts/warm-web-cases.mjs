/**
 * Fills the web case cache ahead of anyone asking.
 *
 * Not required — an empty cache serves nothing for one reader and fills itself
 * behind their response, so the next person sees it. This just buys that first
 * reader's experience for the combinations you care about.
 */
import pg from "pg";
import { createAnalysisClientFromEnv } from "../server/analysis-client.mjs";
import { COMMON_WEB_SEARCH_KEYS, WEB_SEARCH_KEYS, refreshWebCaseQuery } from "../server/web-case-refresh.mjs";
import { recordApiUsage } from "../server/api-usage.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const client = createAnalysisClientFromEnv();
if (!client) throw new Error("OPENAI_API_KEY_AND_ANALYSIS_MODEL_REQUIRED");

// One key per common medium: enough to click through every screen without
// paying for combinations nobody has asked for yet.
const SAMPLE_KEYS = ["카카오톡", "게임 채팅", "SNS 디엠", "문자 메시지"]
  .map((word) => COMMON_WEB_SEARCH_KEYS.find((key) => key.startsWith(word) && key.includes("성적 욕설 패드립")))
  .filter(Boolean);

const scope = process.argv[2] || "sample";
const keys = scope === "all" ? WEB_SEARCH_KEYS
  : scope === "common" ? COMMON_WEB_SEARCH_KEYS
  : SAMPLE_KEYS;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
console.log(`검색어 ${keys.length}개를 채웁니다 · 모델 ${client.model}\n`);

let stored = 0;
for (const queryKey of keys) {
  const started = Date.now();
  const result = await refreshWebCaseQuery({ pool, client, queryKey });
  const seconds = Math.round((Date.now() - started) / 1000);
  await recordApiUsage({
    pool, purpose: "case_analysis", model: client.model,
    usage: result.usage, webSearches: result.webSearches, latencyMs: Date.now() - started, ok: result.ok,
  });
  if (result.stored) stored += 1;
  console.log(`  ${result.ok ? (result.stored ? "저장" : "빈 결과") : `실패 ${result.code}`}  ${String(result.count).padStart(2)}건 · ${seconds}초  ${queryKey}`);
}

await pool.end();
console.log(`\n${stored} / ${keys.length} 저장됨. 나머지는 실제로 검색될 때 자동으로 채워집니다.`);
