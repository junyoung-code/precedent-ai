import assert from "node:assert/strict";
import test from "node:test";
import { createEmbeddingClientFromEnv, EMBEDDING_DIMENSIONS, OpenAiEmbeddingClient } from "../server/embedding-client.mjs";

test("validates and returns a 1536-dimensional embedding", async () => {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index / EMBEDDING_DIMENSIONS);
  let request;
  const client = new OpenAiEmbeddingClient({
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, json: async () => ({ data: [{ embedding: vector }] }) };
    },
  });
  assert.deepEqual(await client.embed("사실관계"), vector);
  assert.equal(request.model, "text-embedding-3-small");
  assert.equal(request.dimensions, 1536);
});

test("rejects malformed responses and stays disabled without explicit opt-in", async () => {
  const client = new OpenAiEmbeddingClient({
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ embedding: [0.1] }] }) }),
  });
  await assert.rejects(() => client.embed("사실관계"), { code: "EMBEDDING_RESPONSE_INVALID" });
  assert.equal(createEmbeddingClientFromEnv({ OPENAI_API_KEY: "test-key" }), null);
  assert.ok(createEmbeddingClientFromEnv({ OPENAI_API_KEY: "test-key", EMBEDDING_SEARCH_ENABLED: "true" }));
});
