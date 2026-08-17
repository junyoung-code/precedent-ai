import pg from "pg";
import { createSearchApiServer } from "../server/search-api.mjs";
import { createEmbeddingClientFromEnv } from "../server/embedding-client.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.API_PORT || 8787);
const embeddingClient = createEmbeddingClientFromEnv();
const server = createSearchApiServer({ pool, embeddingClient });

server.listen(port, "127.0.0.1", () => {
  console.log(`Search API listening on http://127.0.0.1:${port}`);
  console.log(`Embedding search: ${embeddingClient ? "enabled" : "disabled (2B fallback)"}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
