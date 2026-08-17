import { mapSearchPayload } from "./search-api.js";

async function request(path, options = {}, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(path, options);
  } catch {
    throw Object.assign(new Error("입력 서버에 연결하지 못했습니다."), { code: "INTAKE_UNAVAILABLE" });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || "INTAKE_FAILED"), { code: payload.error || "INTAKE_FAILED" });
  return payload;
}

export const createIntake = ({ role, redactedText, fetchImpl }) => request("/api/intake", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role, redactedText }),
}, fetchImpl);

export const answerIntake = ({ sessionId, answers, fetchImpl }) => request(`/api/intake/${encodeURIComponent(sessionId)}/answers`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers }),
}, fetchImpl);

// Completion returns the same body as /api/search, so it needs the same mapping
// before the result cards read it.
export const completeIntake = async ({ sessionId, allowExternalEmbedding, fetchImpl }) => mapSearchPayload(
  await request(`/api/intake/${encodeURIComponent(sessionId)}/complete`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allowExternalEmbedding, limit: 5 }),
  }, fetchImpl),
);

export const cancelIntake = ({ sessionId, fetchImpl }) => request(`/api/intake/${encodeURIComponent(sessionId)}`, { method: "DELETE" }, fetchImpl);

/**
 * Release a session while the page is going away. `pagehide` leaves no time to
 * read a response and a normal fetch would be cancelled mid-flight, so this is
 * fire-and-forget with keepalive. (sendBeacon cannot issue DELETE.)
 */
export function abandonIntake({ sessionId, fetchImpl = fetch }) {
  if (!sessionId) return false;
  try {
    fetchImpl(`/api/intake/${encodeURIComponent(sessionId)}`, { method: "DELETE", keepalive: true });
  } catch {
    // Nothing to recover during teardown; the 1-hour purge is the backstop.
  }
  return true;
}
