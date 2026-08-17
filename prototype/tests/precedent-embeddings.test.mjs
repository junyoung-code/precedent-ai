import assert from "node:assert/strict";
import test from "node:test";
import { EMBEDDING_DIMENSIONS } from "../server/embedding-client.mjs";
import { backfillPrecedentEmbeddings, toVectorLiteral } from "../server/precedent-embeddings.mjs";

test("stores embedding metadata and skips unchanged records on later runs", async () => {
  const updates = [];
  const rows = [
    { id: "new", source_text: "카카오톡으로 성적인 표현을 한 번 전송했다.", hasEmbedding: false },
    {
      id: "old",
      source_text: "게임 채팅으로 성적인 표현을 전송했다.",
      hasEmbedding: true,
      embeddingModel: "text-embedding-3-small",
    },
  ];
  const vector = Array(EMBEDDING_DIMENSIONS).fill(0.01);
  const embeddingClient = { model: "text-embedding-3-small", embed: async () => vector };
  const pool = {
    query: async (sql, params) => {
      if (/^\s*SELECT/.test(sql)) return { rows };
      updates.push({ sql, params });
      return { rowCount: 1 };
    },
  };

  const first = await backfillPrecedentEmbeddings({ pool, embeddingClient, limit: 10 });
  assert.equal(first.embedded, 2);
  assert.equal(updates.length, 2);
  assert.match(updates[0].sql, /embedding_input_hash/);
  assert.match(updates[0].params[1], /^\[/);

  rows[0] = {
    ...rows[0],
    hasEmbedding: true,
    embeddingModel: first.model,
    embeddingInputHash: updates[0].params[3],
    embeddingSourceHash: updates[0].params[4],
  };
  const second = await backfillPrecedentEmbeddings({ pool, embeddingClient, limit: 10 });
  assert.equal(second.skipped, 1);
});

test("rejects vectors with the wrong dimensions before SQL interpolation", () => {
  assert.throws(() => toVectorLiteral([0.1]), { code: "EMBEDDING_VECTOR_INVALID" });
});
