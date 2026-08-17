import { DEFAULT_EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "./embedding-client.mjs";
import { buildPrecedentEmbeddingInput, hashEmbeddingInput } from "./embedding-input.mjs";

export function toVectorLiteral(vector) {
  if (!Array.isArray(vector)
    || vector.length !== EMBEDDING_DIMENSIONS
    || vector.some((value) => !Number.isFinite(value))) {
    throw Object.assign(new Error("1536차원 벡터가 필요합니다."), { code: "EMBEDDING_VECTOR_INVALID" });
  }
  return `[${vector.join(",")}]`;
}

export async function backfillPrecedentEmbeddings({ pool, embeddingClient, limit = 100 }) {
  if (!embeddingClient) {
    throw Object.assign(new Error("임베딩 클라이언트가 필요합니다."), { code: "EMBEDDING_CLIENT_REQUIRED" });
  }
  const model = embeddingClient.model || DEFAULT_EMBEDDING_MODEL;
  const records = await pool.query(
    `SELECT id, source_text, embedding IS NOT NULL AS "hasEmbedding",
            embedding_model AS "embeddingModel",
            embedding_input_hash AS "embeddingInputHash",
            embedding_source_hash AS "embeddingSourceHash"
     FROM precedents
     WHERE searchable = true
       AND verified_at IS NOT NULL
       AND link_status BETWEEN 200 AND 399
     ORDER BY decision_date DESC, id
     LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 1000)],
  );

  let embedded = 0;
  let skipped = 0;
  for (const record of records.rows) {
    const input = buildPrecedentEmbeddingInput({ sourceText: record.source_text });
    const inputHash = hashEmbeddingInput(input);
    const sourceHash = hashEmbeddingInput(record.source_text);
    if (record.hasEmbedding
      && record.embeddingModel === model
      && record.embeddingInputHash === inputHash
      && record.embeddingSourceHash === sourceHash) {
      skipped += 1;
      continue;
    }

    const vector = await embeddingClient.embed(input);
    await pool.query(
      `UPDATE precedents
       SET embedding = $2::vector,
           embedding_model = $3,
           embedding_input_hash = $4,
           embedding_source_hash = $5,
           embedded_at = now()
       WHERE id = $1`,
      [record.id, toVectorLiteral(vector), model, inputHash, sourceHash],
    );
    embedded += 1;
  }

  return { selected: records.rows.length, embedded, skipped, model };
}
