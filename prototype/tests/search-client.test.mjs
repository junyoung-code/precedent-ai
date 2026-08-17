import assert from "node:assert/strict";
import test from "node:test";
import { searchSimilarPrecedents } from "../src/lib/search-api.js";

const VALID_RESULT = {
  id: "p1",
  court: "대법원",
  caseNumber: "2025도12709",
  caseName: "통신매체이용음란",
  decisionDate: "2026-03-12",
  officialUrl: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=618503",
  verifiedAt: "2026-08-15",
  semanticScore: 82,
  tagScore: 75,
  issueScore: 50,
  retrievalScore: 76,
  matchedFacts: [{ field: "medium", queryValue: "game_chat", precedentValue: "game_chat" }],
  differentFacts: [{ field: "repetition", queryValue: "once", precedentValue: "repeated" }],
  summary: [{
    text: "법원은 메시지 전달 경위와 대화의 전체 맥락을 함께 살폈습니다.",
    sourceAnchor: "판결문 문단 p-0001",
  }],
};

test("posts the case description and maps only grounded API result fields", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({
        query: "게임 채팅 성적 욕설",
        availableCount: 51,
        comparedCount: 20,
        scoring: { status: "hybrid_embeddings" },
        results: [{ ...VALID_RESULT, outcome: "guilty" }],
      }),
    };
  };

  const response = await searchSimilarPrecedents({
    query: "게임 채팅에서 성적인 욕설을 보냈습니다",
    limit: 3,
    allowExternalEmbedding: true,
    fetchImpl,
  });

  assert.equal(request.url, "/api/search");
  assert.deepEqual(request.body, {
    query: "게임 채팅에서 성적인 욕설을 보냈습니다",
    limit: 3,
    allowExternalEmbedding: true,
  });
  assert.equal(response.availableCount, 51);
  assert.equal(response.results[0].similarity.total, 76);
  assert.equal(response.results[0].similarity.semantic, 82);
  assert.deepEqual(response.results[0].similarities, ["게임 채팅을 사용했다는 점"]);
  assert.match(response.results[0].differences[0], /한 차례/);
  assert.deepEqual(response.results[0].summary, VALID_RESULT.summary);
  assert.equal(Object.hasOwn(response.results[0], "outcome"), false);
});

test("defaults external embedding consent to false", async () => {
  let body;
  const fetchImpl = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ results: [] }) };
  };
  await searchSimilarPrecedents({ query: "게임 채팅", fetchImpl });
  assert.equal(body.allowExternalEmbedding, false);
});

test("drops records whose official identity or law.go.kr URL is invalid", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      availableCount: 51,
      comparedCount: 2,
      scoring: { status: "hybrid_embeddings" },
      results: [
        VALID_RESULT,
        { ...VALID_RESULT, id: "fake", officialUrl: "https://example.com/invented" },
        { ...VALID_RESULT, id: "missing", caseNumber: "" },
      ],
    }),
  });
  const response = await searchSimilarPrecedents({ query: "게임 채팅", fetchImpl });
  assert.deepEqual(response.results.map((item) => item.id), ["p1"]);
});

test("hides summaries unless every sentence has server-grounded text and source anchor", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      results: [
        { ...VALID_RESULT, summary: [{ text: "근거 없는 문장" }] },
      ],
    }),
  });
  const response = await searchSimilarPrecedents({ query: "게임 채팅", fetchImpl });
  assert.equal(response.results[0].summary, null);
});

test("passes through why a precedent carries no summary", async () => {
  const base = {
    id: "p1", court: "대법원", caseNumber: "2020도11185",
    caseName: "군인등강제추행·성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)",
    decisionDate: "2022-09-29",
    officialUrl: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=231731",
    retrievalScore: 70, summary: null,
  };
  const fetchImpl = async (_path, options) => new Response(JSON.stringify({
    results: [{ ...base, precedentFocus: JSON.parse(options.body).query }],
  }), { status: 200 });

  for (const focus of ["mixed", "peripheral", "focused"]) {
    const result = await searchSimilarPrecedents({ query: focus, fetchImpl });
    assert.equal(result.results[0].focus, focus);
  }
  // An unexpected value must not leak into the card as a missing reason.
  const unknown = await searchSimilarPrecedents({ query: "something-else", fetchImpl });
  assert.equal(unknown.results[0].focus, "focused");
});

test("uses a stable error code when the search server is unavailable", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  await assert.rejects(
    () => searchSimilarPrecedents({ query: "게임 채팅", fetchImpl }),
    { code: "SEARCH_API_UNAVAILABLE" },
  );
});
