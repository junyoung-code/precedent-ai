import assert from "node:assert/strict";
import test from "node:test";
import { createSearchApiServer } from "../server/search-api.mjs";

async function start(t, options) {
  const server = createSearchApiServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("creates an intake session from redacted text only", async (t) => {
  const received = [];
  const base = await start(t, {
    pool: {},
    extractFacts: () => ({ medium: "kakao" }),
    buildQuestions: () => [],
    intakeSessions: {
      createIntakeSession: async (input) => { received.push(input); return { id: "s1", questions: [] }; },
    },
  });
  const response = await fetch(`${base}/api/intake`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "victim", redactedText: "연락처 [가림] 카카오톡 메시지" }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).sessionId, "s1");
  assert.equal(received[0].redactedText.includes("010-1234-5678"), false);
});

test("returns client errors for missing or expired intake sessions", async (t) => {
  const base = await start(t, {
    pool: {},
    intakeSessions: {
      answerIntakeSession: async () => { throw Object.assign(new Error(), { code: "INTAKE_SESSION_NOT_FOUND" }); },
    },
  });
  const response = await fetch(`${base}/api/intake/missing/answers`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers: {} }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INTAKE_SESSION_NOT_FOUND");
});

test("always deletes an intake session after complete search", async (t) => {
  let deleted = 0;
  const base = await start(t, {
    pool: {},
    search: async () => ({ results: [] }),
    intakeSessions: {
      getIntakeSessionForCompletion: async () => ({ id: "s1", redactedText: "게임 채팅 성적 욕설", answers: {} }),
      deleteIntakeSession: async () => { deleted += 1; return { deleted: true }; },
    },
  });
  const response = await fetch(`${base}/api/intake/s1/complete`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
  });
  assert.equal(response.status, 200);
  assert.equal(deleted, 1);
});
