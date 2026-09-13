/**
 * Fills the web case cache ahead of anyone asking.
 *
 * Not required — an empty cache serves nothing for one reader and fills itself
 * behind their response, so the next person sees it. This just buys that first
 * reader's experience for the combinations you care about.
 *
 * It is also the only place a refresh should be bought on purpose. Set
 * WEB_CACHE_TTL_HOURS high while testing and warm from here, rather than
 * letting a batch age out and charge whoever happens to open the page.
 */
import pg from "pg";
import { createAnalysisClientFromEnv } from "../server/analysis-client.mjs";
import { createEmbeddingClientFromEnv } from "../server/embedding-client.mjs";
import { COMMON_WEB_SEARCH_KEYS, WEB_SEARCH_KEYS, refreshWebCaseQuery } from "../server/web-case-refresh.mjs";
import { recordApiUsage } from "../server/api-usage.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const client = createAnalysisClientFromEnv();
if (!client) throw new Error("OPENAI_API_KEY_AND_ANALYSIS_MODEL_REQUIRED");

/**
 * Vectors too, not just the batch.
 *
 * Warming without this stored posts nobody had embedded, so the panel ranked
 * them on tags until the next refresh — which is the state the vectors exist to
 * end, arrived at by the very script meant to prepare for a reader.
 */
const embeddingClient = createEmbeddingClientFromEnv();

/**
 * The situations people actually arrive with.
 *
 * Taken from the fact tags on the judgments in this database — 51 cases that
 * reached a court — rather than from the gallery. The two disagree, and the
 * disagreement matters: the gallery is where someone reported for in-game trash
 * talk goes to vent, so counting it said game chat three ways. What gets
 * prosecuted is pictures sent over a messenger.
 *
 *   kakao / sexual_image              7
 *   digital_message / sexual_image    6
 *   game_chat / insult_with_sexual_terms  4
 *   sns_mention / sexual_image        4
 *
 * The gallery has nothing at all for the first of those — 카카오톡, 문자, 사진
 * and 트위터 searches each returned zero usable posts — so that key is served by
 * the web search alone, which is what it is good at. Two sources, two jobs.
 */
const SAMPLE_PAIRS = [
  ["카카오톡", "음란 사진 전송"],
  ["게임 채팅", "성적 욕설 패드립"],
  ["SNS 디엠", "음란 사진 전송"],
];
const SAMPLE_KEYS = SAMPLE_PAIRS
  .map(([medium, expression]) => WEB_SEARCH_KEYS.find((key) => key.startsWith(`${medium} ${expression}`)))
  .filter(Boolean);

const scope = process.argv[2] || "sample";
const keys = scope === "all" ? WEB_SEARCH_KEYS
  : scope === "common" ? COMMON_WEB_SEARCH_KEYS
  : SAMPLE_KEYS;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
console.log(`검색어 ${keys.length}개를 채웁니다 · 모델 ${client.model}`);
console.log(embeddingClient ? `임베딩 ${embeddingClient.model}\n` : "임베딩 없음 — 태그 랭킹으로만 동작합니다\n");

let stored = 0;
for (const queryKey of keys) {
  const started = Date.now();
  const result = await refreshWebCaseQuery({ pool, client, queryKey, embeddingClient });
  const seconds = Math.round((Date.now() - started) / 1000);
  await recordApiUsage({
    // The same purpose the runtime writes. Filed as case_analysis, warming
    // showed up in the same column as real searches and pulled the per-search
    // figure toward whatever had been warmed that day.
    pool, purpose: "web_batch", model: client.model,
    usage: result.usage, webSearches: result.webSearches, latencyMs: Date.now() - started, ok: result.ok,
  });
  if (result.stored) stored += 1;
  console.log(`  ${result.ok ? (result.stored ? "저장" : "빈 결과") : `실패 ${result.code}`}  ${String(result.count).padStart(2)}건 · ${seconds}초  ${queryKey}`);
}

await pool.end();
console.log(`\n${stored} / ${keys.length} 저장됨. 나머지는 실제로 검색될 때 자동으로 채워집니다.`);
