import assert from "node:assert/strict";
import test from "node:test";
import {
  answerIntakeSession,
  createIntakeSession,
  deleteIntakeSession,
  getIntakeSessionForCompletion,
  purgeExpiredIntakeSessions,
} from "../server/intake-sessions.mjs";

test("creates an expiring session using only redacted text", async () => {
  const calls = [];
  const pool = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: "session-1", questions: [], expires_at: "2026-08-16T01:00:00Z" }] };
  } };
  const result = await createIntakeSession({ pool, role: "victim", redactedText: "연락처 [가림]", facts: {}, questions: [] });
  assert.equal(result.id, "session-1");
  assert.match(calls[0].sql, /now\(\) \+ interval '1 hour'/);
  assert.equal(calls[0].params.includes("010-1234-5678"), false);
});

test("requires every asked answer and accepts only asked ids", async () => {
  const calls = [];
  const pool = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT")) return { rowCount: 1, rows: [{ questions: [{ id: "medium" }] }] };
    return { rowCount: 1, rows: [] };
  } };
  await assert.rejects(() => answerIntakeSession({ pool, sessionId: "s", answers: {} }), { code: "INTAKE_ANSWER_REQUIRED" });
  const result = await answerIntakeSession({ pool, sessionId: "s", answers: { medium: "카카오톡", ignored: "x" } });
  assert.equal(result.ready, true);
  assert.match(calls.at(-1).params[1], /카카오톡/);
  assert.doesNotMatch(calls.at(-1).params[1], /ignored/);
});

test("rejects expired sessions and deletes idempotently", async () => {
  const pool = { query: async (sql) => sql.startsWith("SELECT") ? { rowCount: 0, rows: [] } : { rowCount: 0, rows: [] } };
  await assert.rejects(() => getIntakeSessionForCompletion({ pool, sessionId: "gone" }), { code: "INTAKE_SESSION_NOT_FOUND" });
  assert.deepEqual(await deleteIntakeSession({ pool, sessionId: "gone" }), { deleted: true });
});

test("purges only expired sessions", async () => {
  const calls = [];
  const pool = { query: async (sql) => { calls.push(sql); return { rowCount: 2, rows: [] }; } };
  assert.deepEqual(await purgeExpiredIntakeSessions({ pool }), { deleted: 2 });
  assert.match(calls[0], /expires_at <= now\(\)/);
});
