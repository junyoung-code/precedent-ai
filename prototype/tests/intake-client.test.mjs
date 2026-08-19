import assert from "node:assert/strict";
import test from "node:test";
import { abandonIntake, answerIntake, cancelIntake, completeIntake, createIntake } from "../src/lib/intake-api.js";

function fakeFetch(expectedPath, expectedMethod) {
  return async (path, options) => {
    assert.equal(path, expectedPath);
    assert.equal(options.method, expectedMethod);
    assert.doesNotMatch(options.body || "", /image|fileName|010-1234-5678/);
    return new Response(JSON.stringify({ sessionId: "s1", questions: [] }), { status: 200 });
  };
}

test("sends only redacted text when creating intake", async () => {
  const result = await createIntake({ role: "victim", redactedText: "연락처 [가림]", fetchImpl: fakeFetch("/api/intake", "POST") });
  assert.equal(result.sessionId, "s1");
});

test("uses dedicated answer, completion, and cancellation paths", async () => {
  await answerIntake({ sessionId: "s1", answers: { medium: "카카오톡" }, fetchImpl: fakeFetch("/api/intake/s1/answers", "POST") });
  await completeIntake({ sessionId: "s1", allowExternalAi: false, fetchImpl: fakeFetch("/api/intake/s1/complete", "POST") });
  await cancelIntake({ sessionId: "s1", fetchImpl: fakeFetch("/api/intake/s1", "DELETE") });
});

test("abandons a session without waiting for the response", () => {
  const calls = [];
  const sent = abandonIntake({
    sessionId: "s1",
    fetchImpl: (path, options) => { calls.push([path, options]); return new Promise(() => {}); },
  });

  assert.equal(sent, true);
  assert.deepEqual(calls[0], ["/api/intake/s1", { method: "DELETE", keepalive: true }]);
});

test("does not fire an abandon request without a session", () => {
  let called = false;
  assert.equal(abandonIntake({ sessionId: null, fetchImpl: () => { called = true; } }), false);
  assert.equal(called, false);
});

test("swallows a teardown failure so page unload is never blocked", () => {
  assert.equal(abandonIntake({ sessionId: "s1", fetchImpl: () => { throw new Error("gone"); } }), true);
});

test("maps completion results into the shape the result cards read", async () => {
  const serverResult = {
    id: "p1",
    court: "대법원",
    caseNumber: "2023도7199",
    caseName: "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)",
    decisionDate: "2024-11-28",
    officialUrl: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=242145",
    semanticScore: 0,
    tagScore: 83,
    issueScore: 75,
    retrievalScore: 90,
    matchedFacts: [],
    differentFacts: [],
    summary: null,
  };
  const completed = await completeIntake({
    sessionId: "s1",
    fetchImpl: async () => new Response(JSON.stringify({
      availableCount: 34, comparedCount: 34, scoring: { status: "provisional_without_embeddings" }, results: [serverResult],
    }), { status: 200 }),
  });

  assert.equal(completed.availableCount, 34);
  // The card renders result.similarity.total; an unmapped payload crashed it.
  assert.equal(completed.results[0].similarity.total, 90);
  assert.equal(completed.results[0].similarity.facts, 83);
  assert.equal(completed.results[0].caseNumber, "2023도7199");
});

test("drops a completion result whose verified identity is incomplete", async () => {
  const completed = await completeIntake({
    sessionId: "s1",
    fetchImpl: async () => new Response(JSON.stringify({
      results: [{ id: "p1", court: "대법원", caseNumber: "", officialUrl: "", retrievalScore: 90 }],
    }), { status: 200 }),
  });
  assert.deepEqual(completed.results, []);
});
