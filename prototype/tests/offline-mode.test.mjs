import assert from "node:assert/strict";
import test from "node:test";
import { createSearchApiServer } from "../server/search-api.mjs";
import { buildFixtureAnalysis, readAnalysisFixture } from "../server/offline-mode.mjs";

const STATUTE_ROW = {
  lawId: "011187", articleNo: "13", lawName: "성폭력범죄의 처벌 등에 관한 특례법",
  articleTitle: "통신매체를 이용한 음란행위",
  body: "제13조(통신매체를 이용한 음란행위) 자기 또는 다른 사람의 성적 욕망을 …",
  enforcedOn: "2025-10-01",
  officialUrl: "https://www.law.go.kr/법령/성폭력범죄의처벌등에관한특례법/제13조",
};

function listen(server, t) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    t.after(() => new Promise((done) => server.close(done)));
    resolve(server.address().port);
  }));
}

const post = (port, path, body) => fetch(`http://127.0.0.1:${port}${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}).then((response) => response.json());

test("offline mode makes no external call of any kind", async (t) => {
  // Working on the screens means loading the result page over and over. Every
  // one of those was an analysis call, an embedding, and sometimes a paid web
  // refresh — which is a bad reason to hesitate before trying a layout.
  const calls = [];
  const server = createSearchApiServer({
    pool: { query: async () => ({ rows: [STATUTE_ROW] }) },
    analysisClient: { model: "m", analyze: async () => { calls.push("analyze"); return {}; } },
    embeddingClient: { model: "e", embed: async () => { calls.push("embed"); return []; } },
    search: async ({ embeddingClient }) => {
      if (embeddingClient) await embeddingClient.embed("x");
      return { results: [{ caseNumber: "2023도7199" }] };
    },
    readWeb: async ({ client }) => {
      // A client here is what would start a paid refresh on a stale row.
      if (client) calls.push("webRefresh");
      return { cases: [], fetchedAt: null, stale: true };
    },
    offline: true,
  });
  const port = await listen(server, t);
  const body = { redactedText: "게임 채팅으로 성적인 욕설을 여러 번 들었습니다.", allowExternalAi: true };

  await post(port, "/api/search", { query: body.redactedText, allowExternalAi: true });
  const analysis = await post(port, "/api/analysis", body);
  await post(port, "/api/web-cases", body);

  assert.deepEqual(calls, [], "오프라인에서 나간 외부 호출");
  // The screen still gets a full result to lay out.
  assert.equal(analysis.fixture, true);
  assert.ok(analysis.analysis.overview.length > 0);
  assert.ok(analysis.statute.body.length > 0);
  assert.equal(analysis.elements.length, 4);
});

test("offline output is marked, so it cannot pass for a real result", async (t) => {
  const server = createSearchApiServer({
    pool: { query: async () => ({ rows: [STATUTE_ROW] }) },
    analysisClient: { model: "m", analyze: async () => ({ analysis: { overview: ["진짜"], elementNotes: [], precedentNotes: [], nextSteps: [] } }) },
    offline: false,
  });
  const port = await listen(server, t);
  const live = await post(port, "/api/analysis", { redactedText: "게임 채팅으로 성적인 욕설을 들었습니다.", allowExternalAi: true });
  assert.equal(live.fixture, undefined);
  assert.deepEqual(live.analysis.overview, ["진짜"]);
});

test("the fixture cites the precedents this search returned, not the ones it was recorded with", async () => {
  // The same grounding check that guards a live response runs offline too. A
  // fixture that failed it would send someone chasing a bug that is not real.
  const fixture = await readAnalysisFixture();
  const analysis = buildFixtureAnalysis(fixture, ["2023도7199", "2022도10688"]);
  assert.deepEqual(analysis.precedentNotes.map((note) => note.caseNumber), ["2023도7199", "2022도10688"]);

  // No precedents found is not an error; there is simply nothing to cite.
  assert.deepEqual(buildFixtureAnalysis(fixture, []).precedentNotes, []);
  assert.ok(buildFixtureAnalysis(fixture, []).overview.length > 0);
});

test("the fixture is a real recorded response, not invented prose", async () => {
  // Laying out a screen against three tidy sentences and then meeting a real
  // answer is how a layout breaks after it was signed off.
  const fixture = await readAnalysisFixture();
  assert.match(fixture._note, /실제로 반환한 응답/);
  assert.ok(fixture.overview.some((text) => text.length > 80), "실제 응답만큼 긴 문장이 있어야 합니다");
  assert.equal(fixture.elementNotes.length, 4);
  assert.ok(fixture.nextSteps.length >= 3);
});
