import assert from "node:assert/strict";
import test from "node:test";

import { embedWebCases, readWebCaseSimilarity, webCaseEmbeddingInput } from "../server/web-case-embeddings.mjs";
import { EMBEDDING_DIMENSIONS } from "../server/embedding-client.mjs";

const vector = () => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01);

const item = {
  title: "통매음 불송치 후기",
  url: "https://gall.dcinside.com/mini/board/view/?id=tongtong&no=1",
  quote: "게임 채팅으로 성적인 욕설을 했다가 조사를 받았고, 불송치로 끝났다고 적은 글입니다.",
  medium: "game_chat",
  expression: "insult_with_sexual_terms",
};

test("compares posts on the situation, not on how they ended", () => {
  // A gallery post is worth reading because it says how it ended — and that is
  // exactly why the ending has to come out of the vector. Somebody who has not
  // been charged with anything should not be matched to a post on the word
  // 불송치. The precedent side removes the same sentences for the same reason;
  // whether a post has an ending is carried separately, by its own flag.
  const input = webCaseEmbeddingInput(item);
  assert.equal(/불송치|벌금|징역|처벌/.test(input), false, "결과 문장이 벡터에 남았습니다");
  assert.equal(input.includes("game_chat"), true, "알려진 태그는 벡터에 들어가야 합니다");
});

test("buys a vector once per post, however often the batch is rewritten", async () => {
  // The batch is rewritten daily and holds the same posts most days. Paying for
  // those again every night is the thing the address key exists to prevent.
  let embedded = 0;
  const hashes = [];
  const pool = {
    query: async (sql, values) => {
      if (sql.includes("SELECT url")) {
        return { rows: [{ url: item.url, inputHash: hashes[0], model: "e" }] };
      }
      hashes.push(values[3]);
      return { rows: [] };
    },
  };
  const embeddingClient = { model: "e", embed: async () => { embedded += 1; return vector(); } };

  const first = await embedWebCases({ pool, embeddingClient, cases: [item] });
  assert.deepEqual([first.embedded, first.skipped], [1, 0]);

  const second = await embedWebCases({ pool, embeddingClient, cases: [item] });
  assert.deepEqual([second.embedded, second.skipped], [0, 1]);
  assert.equal(embedded, 1, "같은 글을 두 번 임베딩했습니다");
});

test("embeds again when the summary it was built from changed", async () => {
  const pool = {
    query: async (sql) => (sql.includes("SELECT url")
      ? { rows: [{ url: item.url, inputHash: "0".repeat(64), model: "e" }] }
      : { rows: [] }),
  };
  const embeddingClient = { model: "e", embed: async () => vector() };
  const result = await embedWebCases({ pool, embeddingClient, cases: [item] });
  assert.equal(result.embedded, 1);
});

test("asks for nothing when there is no client to ask", async () => {
  let asked = 0;
  const pool = { query: async () => { asked += 1; return { rows: [] }; } };
  const result = await embedWebCases({ pool, embeddingClient: null, cases: [item] });
  assert.deepEqual(result, { embedded: 0, skipped: 0, failed: 0 });
  assert.equal(asked, 0);
});

test("a batch whose vectors failed is still a batch", async () => {
  // The ranking falls back to the tags, which is what it did before any of this
  // existed. Refusing to store a batch over it would be worse than showing it.
  const pool = { query: async (sql) => (sql.includes("SELECT url") ? { rows: [] } : { rows: [] }) };
  const embeddingClient = { model: "e", embed: async () => { throw new Error("down"); } };
  const result = await embedWebCases({ pool, embeddingClient, cases: [item] });
  assert.deepEqual([result.embedded, result.failed], [0, 1]);
});

test("leaves a post out rather than calling it distant when it has no vector", async () => {
  // A post nobody has embedded yet is unknown, not dissimilar. Returning 0 for
  // it would push every newly collected post to the bottom for a day.
  const pool = {
    query: async () => ({ rows: [{ url: item.url, semanticScore: 0.82 }] }),
  };
  const scores = await readWebCaseSimilarity({
    pool, queryVector: vector(), urls: [item.url, "https://gall.dcinside.com/board/view/?id=a&no=2"],
  });
  assert.equal(scores.get(item.url), 82);
  assert.equal(scores.has("https://gall.dcinside.com/board/view/?id=a&no=2"), false);
});

test("hands back nothing rather than failing the request when the lookup breaks", async () => {
  const pool = { query: async () => { throw new Error("down"); } };
  const scores = await readWebCaseSimilarity({ pool, queryVector: vector(), urls: [item.url] });
  assert.equal(scores.size, 0);
});
