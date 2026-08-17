import assert from "node:assert/strict";
import test from "node:test";
import { createSearchApiServer } from "../server/search-api.mjs";
import {
  normalizeSearchQuery,
  rankHybridCandidates,
  rankTaggedCandidates,
  searchPrecedents,
} from "../server/search-precedents.mjs";
import { EMBEDDING_DIMENSIONS } from "../server/embedding-client.mjs";
import { SUMMARY_VERSION } from "../server/precedent-summaries.mjs";

test("normalizes a keyword query and caps result count at five", () => {
  assert.deepEqual(normalizeSearchQuery("  게임   채팅 성적 욕설  ", 20), {
    text: "게임 채팅 성적 욕설",
    expression: "게임 OR 채팅 OR 성적 OR 욕설",
    limit: 5,
  });
  assert.throws(() => normalizeSearchQuery("   "), { code: "SEARCH_QUERY_REQUIRED" });
});

test("returns no results when the query has no sexual expression", async () => {
  const queries = [];
  const pool = {
    query: async (sql) => {
      queries.push(sql);
      return { rows: [{ count: "34" }] };
    },
  };

  const result = await searchPrecedents({
    pool,
    query: "게임 실력이 나쁘다고 놀림을 받았습니다",
  });

  assert.equal(result.availableCount, 34);
  assert.equal(result.comparedCount, 0);
  assert.equal(result.scoring.status, "query_out_of_scope");
  assert.deepEqual(result.results, []);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /case_name ILIKE '%통신매체이용음란%'/);
});

test("searches only searchable records and returns repository metadata", async () => {
  const queries = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/count\(\*\)/.test(sql)) return { rows: [{ count: "51" }] };
      return { rows: [{
        id: "p1",
        court: "대법원",
        caseNumber: "2025도12709",
        caseName: "통신매체이용음란",
        decisionDate: "2026-03-12",
        officialUrl: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=618503",
        keywordScore: 0.75,
        snippet: "게임 채팅을 이용한 표현에 관한 판결문 일부",
        medium: "game_chat",
        messageForm: "text",
        recipientIdentification: "direct_account",
        reachedRecipient: "yes",
        relationship: "game_user",
        context: "conflict",
        expressionType: "insult_with_sexual_terms",
        repetition: "once",
        additionalChannels: [],
        issueTags: ["통신매체", "도달", "성적표현", "분노", "단발성"],
        summaryVersion: SUMMARY_VERSION,
        summarySentences: [{
          text: "법원은 메시지 전달 경위와 대화의 전체 맥락을 함께 살폈습니다.",
          paragraphIds: ["p-0001"],
        }],
      }] };
    },
  };

  const result = await searchPrecedents({ pool, query: "게임 채팅에서 성적인 욕설을 한 번 보냈습니다", limit: 3 });

  assert.equal(result.availableCount, 51);
  assert.equal(result.comparedCount, 1);
  assert.equal(result.results[0].caseNumber, "2025도12709");
  assert.equal(result.results[0].tagScore, 100);
  assert.equal(result.results[0].retrievalScore, 100);
  assert.ok(result.results[0].matchedFacts.some((item) => item.field === "medium"));
  assert.deepEqual(result.results[0].summary, [{
    text: "법원은 메시지 전달 경위와 대화의 전체 맥락을 함께 살폈습니다.",
    sourceAnchor: "판결문 문단 p-0001",
  }]);
  assert.match(queries[0].sql, /case_name ILIKE '%통신매체이용음란%'/);
  assert.match(queries[1].sql, /p\.searchable = true/);
  assert.match(queries[1].sql, /p\.case_name ILIKE '%통신매체이용음란%'/);
  assert.match(queries[1].sql, /LEFT JOIN precedent_summaries s/);
  assert.match(queries[1].sql, /s\.source_hash = p\.source_hash/);
  assert.match(queries[1].sql, /precedent_fact_tags/);
  assert.match(queries[1].sql, /f\.medium = \$2/);
  assert.match(queries[1].sql, /to_char\(p\.decision_date, 'YYYY-MM-DD'\)/);
  assert.equal(queries[1].params[1], "game_chat");
  assert.equal(queries[1].params.at(-1), 50);
});

test("uses stored fact tags as candidates when literal keyword overlap is weak", async () => {
  const base = {
    court: "대법원",
    caseName: "통신매체이용음란",
    decisionDate: "2026-03-12",
    officialUrl: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=1",
    snippet: "판결문 일부",
    messageForm: "text",
    recipientIdentification: "direct_account",
    reachedRecipient: "yes",
    relationship: "unknown",
    context: "unknown",
    expressionType: "sexual_text",
    repetition: "once",
    additionalChannels: [],
    issueTags: ["통신매체", "도달", "성적표현", "단발성"],
  };
  const pool = {
    query: async (sql) => /count\(\*\)/.test(sql)
      ? { rows: [{ count: "51" }] }
      : { rows: [
          {
            ...base,
            id: "keyword",
            caseNumber: "2024도1",
            medium: "digital_message",
            recipientIdentification: "public_post",
            reachedRecipient: "no",
            context: "conflict",
            expressionType: "sexual_image",
            repetition: "repeated",
            issueTags: ["분노", "반복성"],
            keywordScore: 0.8,
          },
          { ...base, id: "tag", caseNumber: "2024도2", medium: "kakao", keywordScore: 0 },
        ] },
  };

  const result = await searchPrecedents({
    pool,
    query: "카카오톡으로 성적인 글을 한 번 보냈습니다",
    limit: 2,
  });

  assert.equal(result.results[0].caseNumber, "2024도2");
  assert.equal(result.results[0].tagScore, 100);
  assert.equal(result.results.every((item) => Object.hasOwn(item, "outcome") === false), true);
});

test("combines semantic, fact and issue scores as 45/45/10 with a 55 point threshold", () => {
  const queryFacts = {
    medium: "game_chat",
    messageForm: "text",
    recipientIdentification: "direct_account",
    reachedRecipient: "yes",
    relationship: "game_user",
    context: "conflict",
    expressionType: "insult_with_sexual_terms",
    repetition: "once",
    additionalChannels: [],
    issueTags: ["통신매체", "도달"],
  };
  const matching = {
    id: "matching",
    decisionDate: "2026-03-12",
    semanticScore: 0.8,
    ...queryFacts,
  };
  const result = rankHybridCandidates(queryFacts, [matching], 3);
  assert.equal(result[0].semanticScore, 80);
  assert.equal(result[0].retrievalScore, 91);
  assert.equal(Object.hasOwn(result[0], "outcome"), false);
  assert.deepEqual(rankHybridCandidates(queryFacts, [{ ...matching, semanticScore: 0, medium: "unknown", issueTags: [] }], 3), []);
});

test("uses a fixed lexical cap instead of candidate-relative normalization", () => {
  const queryFacts = {
    medium: "game_chat",
    messageForm: "text",
    recipientIdentification: "direct_account",
    reachedRecipient: "yes",
    relationship: "game_user",
    context: "conflict",
    expressionType: "sexual_text",
    repetition: "once",
    issueTags: ["통신매체"],
  };
  const base = { id: "p", caseName: "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)", ...queryFacts };

  const weakOnly = rankTaggedCandidates(queryFacts, [{ ...base, id: "weak", keywordScore: 0.1 }], 3);
  const withStrongCandidate = rankTaggedCandidates(queryFacts, [
    { ...base, id: "weak", keywordScore: 0.1 },
    { ...base, id: "strong", keywordScore: 0.5 },
  ], 3);

  assert.equal(weakOnly[0].retrievalScore, 64);
  assert.equal(withStrongCandidate.find((item) => item.id === "weak").retrievalScore, 64);
  assert.equal(withStrongCandidate.find((item) => item.id === "strong").retrievalScore, 100);
});

test("penalizes mixed cases and removes results below 55", () => {
  const queryFacts = {
    medium: "game_chat",
    messageForm: "text",
    recipientIdentification: "direct_account",
    reachedRecipient: "yes",
    relationship: "game_user",
    context: "conflict",
    expressionType: "sexual_text",
    repetition: "once",
    issueTags: ["통신매체"],
  };
  const base = { ...queryFacts, keywordScore: 0.5 };
  const result = rankTaggedCandidates(queryFacts, [
    { ...base, id: "focused", caseName: "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)" },
    { ...base, id: "mixed", caseName: "협박·성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)" },
    { ...base, id: "peripheral", caseName: "강간·성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)·부착명령" },
    { ...base, id: "below", caseName: "협박·성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)", keywordScore: 0, medium: "unknown", issueTags: [] },
  ], 5);

  assert.deepEqual(result.map((item) => [item.id, item.retrievalScore]), [
    ["focused", 100],
    ["mixed", 85],
    ["peripheral", 70],
  ]);
  assert.equal(result.some((item) => item.id === "below"), false);
});

test("hides malformed or outdated stored summaries without dropping the precedent", () => {
  const queryFacts = {
    medium: "game_chat",
    messageForm: "text",
    recipientIdentification: "direct_account",
    reachedRecipient: "yes",
    relationship: "game_user",
    context: "conflict",
    expressionType: "sexual_text",
    repetition: "once",
    additionalChannels: [],
    issueTags: ["통신매체"],
  };
  const rows = [{
    id: "p1",
    decisionDate: "2026-01-01",
    semanticScore: 1,
    summaryVersion: "old-version",
    summarySentences: [{ text: "오래된 요약", paragraphIds: ["p-1"] }],
    ...queryFacts,
  }];
  assert.equal(rankHybridCandidates(queryFacts, rows, 1)[0].summary, null);
});

test("hides grounded summaries for mixed-offense precedents", () => {
  const queryFacts = {
    medium: "game_chat",
    messageForm: "text",
    recipientIdentification: "direct_account",
    reachedRecipient: "yes",
    relationship: "game_user",
    context: "conflict",
    expressionType: "sexual_text",
    repetition: "once",
    additionalChannels: [],
    issueTags: ["통신매체"],
  };
  const rows = [{
    id: "mixed-summary",
    caseName: "재물손괴·성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)",
    decisionDate: "2026-01-01",
    semanticScore: 1,
    summaryVersion: SUMMARY_VERSION,
    summarySentences: [{ text: "다른 범죄의 형량을 요약한 문장", paragraphIds: ["p-1"] }],
    ...queryFacts,
  }];

  assert.equal(rankHybridCandidates(queryFacts, rows, 1)[0].summary, null);
});

test("uses only verified recent linked embeddings for semantic candidates", async () => {
  const queries = [];
  const vector = Array(EMBEDDING_DIMENSIONS).fill(0.01);
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/count\(\*\)/.test(sql)) return { rows: [{ count: "12" }] };
      return { rows: [{
        id: "p1",
        court: "대법원",
        caseNumber: "2025도12709",
        caseName: "통신매체이용음란",
        decisionDate: "2026-03-12",
        officialUrl: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=618503",
        semanticScore: 0.9,
        medium: "game_chat",
        messageForm: "text",
        recipientIdentification: "direct_account",
        reachedRecipient: "yes",
        relationship: "game_user",
        context: "conflict",
        expressionType: "insult_with_sexual_terms",
        repetition: "once",
        additionalChannels: [],
        issueTags: ["통신매체", "도달", "성적표현", "분노", "단발성"],
      }] };
    },
  };
  const embeddingClient = { embed: async () => vector };

  const result = await searchPrecedents({
    pool,
    embeddingClient,
    query: "게임 채팅에서 성적인 욕설을 한 번 보냈습니다",
    limit: 3,
  });

  assert.equal(result.scoring.status, "hybrid_embeddings");
  assert.equal(result.availableCount, 12);
  assert.equal(result.comparedCount, 1);
  assert.equal(result.results[0].caseNumber, "2025도12709");
  assert.match(queries[0].sql, /verified_at IS NOT NULL/);
  assert.match(queries[0].sql, /case_name ILIKE '%통신매체이용음란%'/);
  assert.match(queries[0].sql, /link_checked_at >= now\(\) - interval '24 hours'/);
  assert.match(queries[1].sql, /embedding IS NOT NULL/);
  assert.match(queries[1].sql, /p\.case_name ILIKE '%통신매체이용음란%'/);
  assert.match(queries[1].sql, /LEFT JOIN precedent_summaries s/);
  assert.match(queries[1].sql, /s\.source_hash = p\.source_hash/);
  assert.match(queries[1].sql, /p\.embedding <=> \$1::vector/);
  assert.equal(queries[1].params[0].split(",").length, EMBEDDING_DIMENSIONS);
});

test("falls back to 2B search when query embedding fails", async () => {
  const pool = {
    query: async (sql) => /count\(\*\)/.test(sql)
      ? { rows: [{ count: "51" }] }
      : { rows: [] },
  };
  const embeddingClient = {
    embed: async () => { throw Object.assign(new Error("offline"), { code: "EMBEDDING_API_UNAVAILABLE" }); },
  };
  const result = await searchPrecedents({ pool, embeddingClient, query: "게임 채팅에서 성적인 욕설을 보냄", limit: 3 });
  assert.equal(result.scoring.status, "fallback_without_embeddings");
  assert.equal(result.scoring.fallbackCode, "EMBEDDING_API_UNAVAILABLE");
});

test("falls back once when the database has no eligible embedded candidates", async () => {
  const vector = Array(EMBEDDING_DIMENSIONS).fill(0.01);
  let calls = 0;
  const pool = {
    query: async (sql) => {
      calls += 1;
      if (/count\(\*\)/.test(sql)) return { rows: [{ count: "0" }] };
      return { rows: [] };
    },
  };
  const result = await searchPrecedents({
    pool,
    embeddingClient: { embed: async () => vector },
    query: "게임 채팅에서 성적인 욕설을 보냄",
    limit: 3,
  });
  assert.equal(result.scoring.status, "fallback_without_embeddings");
  assert.equal(result.scoring.fallbackCode, "NO_EMBEDDED_CANDIDATES");
  assert.equal(calls, 4);
});

test("POST /api/search validates input and returns search results", async (t) => {
  const search = async ({ query, limit }) => ({ query, comparedCount: 51, results: [{ caseNumber: "2025도12709", limit }] });
  const server = createSearchApiServer({ pool: {}, search });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "게임 채팅", limit: 3 }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results[0].caseNumber, "2025도12709");

  const invalid = await fetch(`http://127.0.0.1:${port}/api/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "" }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, "SEARCH_QUERY_REQUIRED");
});

test("POST /api/search passes the embedding client only after explicit request consent", async (t) => {
  const receivedClients = [];
  const embeddingClient = { embed: async () => [] };
  const search = async ({ embeddingClient: received }) => {
    receivedClients.push(received);
    return { results: [] };
  };
  const server = createSearchApiServer({ pool: {}, search, embeddingClient });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  for (const allowExternalEmbedding of [false, true]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "게임 채팅", allowExternalEmbedding }),
    });
    assert.equal(response.status, 200);
  }

  assert.equal(receivedClients[0], null);
  assert.equal(receivedClients[1], embeddingClient);
});
