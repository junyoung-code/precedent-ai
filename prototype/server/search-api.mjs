import http from "node:http";
import { normalizeSearchQuery, searchPrecedents } from "./search-precedents.mjs";
import { extractFactTags } from "../src/lib/fact-tags.js";
import { buildIntakeQuestions } from "./intake-questions.mjs";
import {
  answerIntakeSession,
  createIntakeSession,
  deleteIntakeSession,
  getIntakeSessionForCompletion,
} from "./intake-sessions.mjs";

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) throw Object.assign(new Error("요청이 너무 큽니다."), { code: "REQUEST_TOO_LARGE" });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("JSON 형식이 올바르지 않습니다."), { code: "INVALID_JSON" });
  }
}

function intakeInputError() {
  return Object.assign(new Error("가려진 사례 설명을 입력해주세요."), { code: "INTAKE_INPUT_REQUIRED" });
}

export function createSearchApiServer({
  pool,
  search = searchPrecedents,
  embeddingClient = null,
  intakeSessions = { createIntakeSession, answerIntakeSession, deleteIntakeSession, getIntakeSessionForCompletion },
  extractFacts = extractFactTags,
  buildQuestions = buildIntakeQuestions,
}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true });
    }
    try {
      if (request.method === "POST" && url.pathname === "/api/intake") {
        const body = await readJson(request);
        if (!["victim", "reported"].includes(body.role) || !String(body.redactedText || "").trim()) throw intakeInputError();
        const facts = extractFacts(body.redactedText);
        const questions = buildQuestions(facts);
        const session = await intakeSessions.createIntakeSession({
          pool,
          role: body.role,
          redactedText: String(body.redactedText).trim(),
          facts,
          questions,
        });
        return sendJson(response, 201, { sessionId: session.id, questions: session.questions });
      }

      const answerMatch = url.pathname.match(/^\/api\/intake\/([^/]+)\/answers$/);
      if (request.method === "POST" && answerMatch) {
        const body = await readJson(request);
        const result = await intakeSessions.answerIntakeSession({ pool, sessionId: answerMatch[1], answers: body.answers });
        return sendJson(response, 200, result);
      }

      const completeMatch = url.pathname.match(/^\/api\/intake\/([^/]+)\/complete$/);
      if (request.method === "POST" && completeMatch) {
        const body = await readJson(request);
        const sessionId = completeMatch[1];
        try {
          const session = await intakeSessions.getIntakeSessionForCompletion({ pool, sessionId });
          const query = [session.redactedText, ...Object.values(session.answers)].join("\n");
          const normalized = normalizeSearchQuery(query, body.limit);
          const requestEmbeddingClient = body.allowExternalEmbedding === true ? embeddingClient : null;
          const result = await search({ pool, query: normalized.text, limit: normalized.limit, embeddingClient: requestEmbeddingClient });
          return sendJson(response, 200, result);
        } finally {
          await intakeSessions.deleteIntakeSession({ pool, sessionId });
        }
      }

      const cancelMatch = url.pathname.match(/^\/api\/intake\/([^/]+)$/);
      if (request.method === "DELETE" && cancelMatch) {
        return sendJson(response, 200, await intakeSessions.deleteIntakeSession({ pool, sessionId: cancelMatch[1] }));
      }

      if (request.method !== "POST" || url.pathname !== "/api/search") {
        return sendJson(response, 404, { error: "NOT_FOUND" });
      }
      const body = await readJson(request);
      const normalized = normalizeSearchQuery(body.query, body.limit);
      const requestEmbeddingClient = body.allowExternalEmbedding === true ? embeddingClient : null;
      const result = await search({
        pool,
        query: normalized.text,
        limit: normalized.limit,
        embeddingClient: requestEmbeddingClient,
      });
      return sendJson(response, 200, result);
    } catch (error) {
      const clientErrors = new Set(["SEARCH_QUERY_REQUIRED", "REQUEST_TOO_LARGE", "INVALID_JSON", "INTAKE_INPUT_REQUIRED", "INTAKE_ANSWER_REQUIRED", "INTAKE_SESSION_NOT_FOUND"]);
      const status = clientErrors.has(error.code) ? 400 : 500;
      return sendJson(response, status, { error: clientErrors.has(error.code) ? error.code : "SEARCH_FAILED" });
    }
  });
}
