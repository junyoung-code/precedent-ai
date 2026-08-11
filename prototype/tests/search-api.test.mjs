import assert from "node:assert/strict";
import test from "node:test";
import { createSearchApiServer } from "../server/search-api.mjs";
import { normalizeSearchQuery, searchPrecedents } from "../server/search-precedents.mjs";

test("normalizes a keyword query and caps result count at five", () => {
  assert.deepEqual(normalizeSearchQuery("  게임   채팅 성적 욕설  ", 20), {
    text: "게임 채팅 성적 욕설",
    expression: "게임 OR 채팅 OR 성적 OR 욕설",
    limit: 5,
  });
  assert.throws(() => normalizeSearchQuery("   "), { code: "SEARCH_QUERY_REQUIRED" });
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
      }] };
    },
  };

  const result = await searchPrecedents({ pool, query: "게임 채팅", limit: 3 });

  assert.equal(result.comparedCount, 51);
  assert.equal(result.results[0].caseNumber, "2025도12709");
  assert.match(queries[1].sql, /p\.searchable = true/);
  assert.match(queries[1].sql, /to_char\(p\.decision_date, 'YYYY-MM-DD'\)/);
  assert.deepEqual(queries[1].params, ["게임 OR 채팅", 3]);
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
