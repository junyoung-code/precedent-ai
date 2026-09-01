import pg from "pg";
import { createSearchApiServer } from "../server/search-api.mjs";
import { createEmbeddingClientFromEnv } from "../server/embedding-client.mjs";
import { createAnalysisClientFromEnv } from "../server/analysis-client.mjs";
import { isOfflineMode } from "../server/offline-mode.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.API_PORT || 8787);
const embeddingClient = createEmbeddingClientFromEnv();
const analysisClient = createAnalysisClientFromEnv();
const devDashboard = process.env.DEV_DASHBOARD === "true";
const offline = isOfflineMode();
const server = createSearchApiServer({ pool, embeddingClient, analysisClient, devDashboard, offline });

server.listen(port, "127.0.0.1", () => {
  console.log(`Search API listening on http://127.0.0.1:${port}`);
  console.log(`Embedding search: ${embeddingClient ? "enabled" : "disabled (2B fallback)"}`);
  console.log(`Case analysis: ${analysisClient ? `enabled (${analysisClient.model})` : "disabled (ANALYSIS_MODEL unset)"}`);
  if (offline) {
    console.log("");
    console.log("  ▶ 오프라인 모드 — 외부 호출 0회, 비용 0원");
    console.log("    분석은 저장된 실제 응답을 씁니다. 웹 사례는 캐시만 읽고 갱신하지 않습니다.");
    console.log("    화면 오른쪽 아래에 표시가 뜹니다. 끄려면 .env.local 의 OFFLINE_MODE 를 지우십시오.");
    console.log("");
  }
  console.log(devDashboard
    ? `사용량 대시보드: http://127.0.0.1:${port}/dev/usage`
    : "사용량 대시보드: 꺼짐 (DEV_DASHBOARD=true 로 켜기)");
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
