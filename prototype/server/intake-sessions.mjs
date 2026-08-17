function notFound() {
  return Object.assign(new Error("입력 세션을 찾을 수 없습니다."), { code: "INTAKE_SESSION_NOT_FOUND" });
}

function requiredAnswer() {
  return Object.assign(new Error("모든 추가 질문에 답해주세요."), { code: "INTAKE_ANSWER_REQUIRED" });
}

export async function createIntakeSession({ pool, role, redactedText, facts, questions }) {
  const result = await pool.query(
    `INSERT INTO intake_sessions (role, redacted_text, facts, questions, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '1 hour')
     RETURNING id, questions, expires_at`,
    [role, redactedText, JSON.stringify(facts), JSON.stringify(questions)],
  );
  return result.rows[0];
}

export async function answerIntakeSession({ pool, sessionId, answers }) {
  const found = await pool.query(
    `SELECT questions FROM intake_sessions WHERE id = $1 AND expires_at > now()`,
    [sessionId],
  );
  if (found.rowCount !== 1) throw notFound();
  const questions = found.rows[0].questions;
  const allowedIds = new Set(questions.map((question) => question.id));
  const accepted = {};
  for (const [id, value] of Object.entries(answers || {})) {
    if (allowedIds.has(id) && String(value || "").trim()) accepted[id] = String(value).trim();
  }
  if ([...allowedIds].some((id) => !accepted[id])) throw requiredAnswer();
  await pool.query(`UPDATE intake_sessions SET answers = $2 WHERE id = $1`, [sessionId, JSON.stringify(accepted)]);
  return { sessionId, ready: true, questions };
}

export async function getIntakeSessionForCompletion({ pool, sessionId }) {
  const result = await pool.query(
    `SELECT id, role, redacted_text AS "redactedText", facts, questions, answers
     FROM intake_sessions WHERE id = $1 AND expires_at > now()`,
    [sessionId],
  );
  if (result.rowCount !== 1) throw notFound();
  const session = result.rows[0];
  if (session.questions.some((question) => !String(session.answers?.[question.id] || "").trim())) throw requiredAnswer();
  return session;
}

export async function deleteIntakeSession({ pool, sessionId }) {
  await pool.query(`DELETE FROM intake_sessions WHERE id = $1`, [sessionId]);
  return { deleted: true };
}

export async function purgeExpiredIntakeSessions({ pool }) {
  const result = await pool.query(`DELETE FROM intake_sessions WHERE expires_at <= now()`);
  return { deleted: result.rowCount || 0 };
}
