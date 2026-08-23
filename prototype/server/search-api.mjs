import http from "node:http";
import { normalizeSearchQuery, searchPrecedents } from "./search-precedents.mjs";
import { extractFactTags } from "../src/lib/fact-tags.js";
import { validateGroundedAnalysis } from "./grounded-analysis.mjs";
import { buildWebSearchQuery, validateWebCases, verifyWebCases } from "./web-cases.mjs";
import { mapFactsToArticle13 } from "./statute-elements.mjs";
import { COMMUNICATION_OBSCENITY_ARTICLE, readStatuteArticle } from "./statutes.mjs";
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

/**
 * Explains the statute against what the user wrote and what the search found.
 *
 * A separate request from the search on purpose: the precedent cards are ready
 * in a second and must not wait on a model that takes ten. Nothing here is
 * stored — the description arrives, is analysed, and is gone with the response.
 */
async function analyseCase({ pool, body, analysisClient, extractFacts, verifyWeb = verifyWebCases }) {
  const redactedText = String(body.redactedText || "").trim();
  if (!redactedText) throw intakeInputError();
  if (!analysisClient) return { analysis: null, unavailable: "ANALYSIS_DISABLED" };

  const statute = await readStatuteArticle({ pool, ...COMMUNICATION_OBSCENITY_ARTICLE });
  if (!statute) return { analysis: null, unavailable: "STATUTE_MISSING" };

  const precedents = Array.isArray(body.precedents) ? body.precedents.slice(0, 5) : [];
  const facts = extractFacts(redactedText);
  const elements = mapFactsToArticle13(facts);
  let payload;
  try {
    const result = await analysisClient.analyze({
      statute, elements, description: redactedText, precedents,
      searchQuery: buildWebSearchQuery(facts),
    });
    payload = result.analysis;
  } catch (error) {
    return { analysis: null, unavailable: error.code || "ANALYSIS_API_UNAVAILABLE" };
  }

  const allowed = new Set(precedents.map((item) => String(item?.caseNumber || "")).filter(Boolean));
  const checked = validateGroundedAnalysis(payload, allowed);

  // The model writes each link as free text, so nothing about a web item is
  // trusted until the page has answered for itself.
  const shaped = validateWebCases(payload?.webCases);
  const verified = shaped.cases.length > 0 ? await verifyWeb({ cases: shaped.cases }) : { cases: [] };

  return {
    statute: { lawName: statute.lawName, articleTitle: statute.articleTitle, body: statute.body, enforcedOn: statute.enforcedOn, officialUrl: statute.officialUrl },
    elements: elements.map(({ id, label, statuteQuote, mention, evidence }) => ({ id, label, statuteQuote, mention, evidence })),
    analysis: { overview: checked.overview, elementNotes: checked.elementNotes, precedentNotes: checked.precedentNotes, nextSteps: checked.nextSteps },
    webCases: verified.cases,
    unavailable: null,
  };
}

export function createSearchApiServer({
  pool,
  search = searchPrecedents,
  embeddingClient = null,
  analysisClient = null,
  intakeSessions = { createIntakeSession, answerIntakeSession, deleteIntakeSession, getIntakeSessionForCompletion },
  extractFacts = extractFactTags,
  buildQuestions = buildIntakeQuestions,
  verifyWeb = verifyWebCases,
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
          const requestEmbeddingClient = body.allowExternalAi === true ? embeddingClient : null;
          const result = await search({ pool, query: normalized.text, limit: normalized.limit, embeddingClient: requestEmbeddingClient });
          return sendJson(response, 200, result);
        } finally {
          await intakeSessions.deleteIntakeSession({ pool, sessionId });
        }
      }

      if (request.method === "POST" && url.pathname === "/api/analysis") {
        const body = await readJson(request);
        // Consent covers every external call, so a refusal reaches the model
        // client rather than being filtered after the fact.
        const consented = body.allowExternalAi === true;
        return sendJson(response, 200, await analyseCase({
          pool,
          body,
          analysisClient: consented ? analysisClient : null,
          extractFacts,
          verifyWeb,
        }));
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
      const requestEmbeddingClient = body.allowExternalAi === true ? embeddingClient : null;
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
