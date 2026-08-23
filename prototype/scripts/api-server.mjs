import pg from "pg";
import { createSearchApiServer } from "../server/search-api.mjs";
import { createEmbeddingClientFromEnv } from "../server/embedding-client.mjs";
import { createAnalysisClientFromEnv } from "../server/analysis-client.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.API_PORT || 8787);
const embeddingClient = createEmbeddingClientFromEnv();
const analysisClient = createAnalysisClientFromEnv();
const devDashboard = process.env.DEV_DASHBOARD === "true";
const server = createSearchApiServer({ pool, embeddingClient, analysisClient, devDashboard });

server.listen(port, "127.0.0.1", () => {
  console.log(`Search API listening on http://127.0.0.1:${port}`);
  console.log(`Embedding search: ${embeddingClient ? "enabled" : "disabled (2B fallback)"}`);
  console.log(`Case analysis: ${analysisClient ? `enabled (${analysisClient.model})` : "disabled (ANALYSIS_MODEL unset)"}`);
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
