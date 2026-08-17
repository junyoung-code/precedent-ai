import assert from "node:assert/strict";
import test from "node:test";
import { answerIntake, cancelIntake, completeIntake, createIntake } from "../src/lib/intake-api.js";

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
  await completeIntake({ sessionId: "s1", allowExternalEmbedding: false, fetchImpl: fakeFetch("/api/intake/s1/complete", "POST") });
  await cancelIntake({ sessionId: "s1", fetchImpl: fakeFetch("/api/intake/s1", "DELETE") });
});
