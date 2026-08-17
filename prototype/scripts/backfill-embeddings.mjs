import pg from "pg";
import { OpenAiEmbeddingClient } from "../server/embedding-client.mjs";
import { backfillPrecedentEmbeddings } from "../server/precedent-embeddings.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_REQUIRED");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const embeddingClient = new OpenAiEmbeddingClient({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDING_MODEL,
});

try {
  const summary = await backfillPrecedentEmbeddings({
    pool,
    embeddingClient,
    limit: Number(process.env.EMBEDDING_BACKFILL_LIMIT || 100),
  });
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await pool.end();
}
