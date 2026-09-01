import http from "node:http";
import { readFile } from "node:fs/promises";
import { normalizeSearchQuery, searchPrecedents } from "./search-precedents.mjs";
import { extractFactTags } from "../src/lib/fact-tags.js";
import { validateGroundedAnalysis } from "./grounded-analysis.mjs";
import { buildWebSearchQuery, selectWebCases } from "./web-cases.mjs";
import { readWebCasesWithRefresh } from "./web-case-refresh.mjs";
import { resolveEntitlement } from "./entitlements.mjs";
import { buildFixtureAnalysis, readAnalysisFixture } from "./offline-mode.mjs";
import { mapFactsToArticle13 } from "./statute-elements.mjs";
import { COMMUNICATION_OBSCENITY_ARTICLE, readStatuteArticle } from "./statutes.mjs";
import { buildIntakeQuestions } from "./intake-questions.mjs";
import { readCorpusHealth, readModelPrices, readUsageSummary, recordApiUsage } from "./api-usage.mjs";
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
async function analyseCase({ pool, body, analysisClient, extractFacts, entitlement = { analysis: true }, offline = false }) {
  const redactedText = String(body.redactedText || "").trim();
  if (!redactedText) throw intakeInputError();
  if (!analysisClient) return { analysis: null, unavailable: "ANALYSIS_DISABLED" };

  const statute = await readStatuteArticle({ pool, ...COMMUNICATION_OBSCENITY_ARTICLE });
  if (!statute) return { analysis: null, unavailable: "STATUTE_MISSING" };

  const precedents = Array.isArray(body.precedents) ? body.precedents.slice(0, 5) : [];
  const facts = extractFacts(redactedText);
  const elements = mapFactsToArticle13(facts);
  const publicElements = elements.map(({ id, label, statuteQuote, mention, evidence }) => ({ id, label, statuteQuote, mention, evidence }));
  const publicStatute = {
    lawName: statute.lawName, articleTitle: statute.articleTitle,
    body: statute.body, enforcedOn: statute.enforcedOn, officialUrl: statute.officialUrl,
  };

  // The statute is public law and the four verdicts come from the rules, so
  // both cost nothing to produce and are shown either way. Only the sentences a
  // model writes are behind the gate — and they are not written at all.
  if (!entitlement.analysis) {
    return { statute: publicStatute, elements: publicElements, analysis: null, unavailable: entitlement.reason };
  }

  // Offline: the same shape, from a response we already paid for once.
  if (offline) {
    const fixture = await readAnalysisFixture();
    return {
      statute: publicStatute,
      elements: publicElements,
      analysis: buildFixtureAnalysis(fixture, precedents.map((item) => item.caseNumber).filter(Boolean)),
      fixture: true,
      unavailable: null,
    };
  }

  let payload;
  const started = Date.now();
  try {
    const result = await analysisClient.analyze({
      statute, elements, description: redactedText, precedents,
    });
    payload = result.analysis;
    await recordApiUsage({
      pool, purpose: "case_analysis", model: analysisClient.model,
      usage: result.usage, webSearches: result.webSearches, latencyMs: Date.now() - started,
    });
  } catch (error) {
    await recordApiUsage({
      pool, purpose: "case_analysis", model: analysisClient.model,
      latencyMs: Date.now() - started, ok: false,
    });
    return { analysis: null, unavailable: error.code || "ANALYSIS_API_UNAVAILABLE" };
  }

  const allowed = new Set(precedents.map((item) => String(item?.caseNumber || "")).filter(Boolean));
  const checked = validateGroundedAnalysis(payload, allowed);

  return {
    statute: publicStatute,
    elements: publicElements,
    analysis: { overview: checked.overview, elementNotes: checked.elementNotes, precedentNotes: checked.precedentNotes, nextSteps: checked.nextSteps },
    unavailable: null,
  };
}

/**
 * Similar posts, served from the cache rather than fetched per reader.
 *
 * Free and separate from the analysis on purpose: this is a database read, so
 * it lands with the precedent cards instead of behind a model that takes ten
 * seconds, and a reader without a plan still gets it.
 */
async function readWebCases({ pool, body, analysisClient, extractFacts, readWeb = readWebCasesWithRefresh, offline = false }) {
  const redactedText = String(body.redactedText || "").trim();
  if (!redactedText) throw intakeInputError();
  if (body.allowExternalAi !== true) return { webCases: [], fetchedAt: null, unavailable: "ANALYSIS_DISABLED" };

  const facts = extractFacts(redactedText);
  const queryKey = buildWebSearchQuery(facts);
  // Passing no client is what stops a stale row from starting a paid refresh.
  const cached = await readWeb({ pool, client: offline ? null : analysisClient, queryKey });
  return {
    webCases: selectWebCases({ cases: cached.cases, facts, role: body.role || null, limit: 3 }),
    fetchedAt: cached.fetchedAt ? new Date(cached.fetchedAt).toISOString() : null,
    fixture: offline || undefined,
    unavailable: cached.cases.length === 0 ? "WEB_CASES_EMPTY" : null,
  };
}

/**
 * Wraps the embedding client so a search writes down what it spent.
 *
 * The client is handed to searchPrecedents, which does not know or care about
 * billing, so the hook goes on the client rather than into the search.
 */
function meteredEmbeddingClient({ client, pool }) {
  if (!client) return null;
  client.onUsage = ({ model, usage, latencyMs, ok }) => {
    void recordApiUsage({ pool, purpose: "search_embedding", model, usage, latencyMs, ok });
  };
  return client;
}

export function createSearchApiServer({
  pool,
  search = searchPrecedents,
  embeddingClient = null,
  analysisClient = null,
  intakeSessions = { createIntakeSession, answerIntakeSession, deleteIntakeSession, getIntakeSessionForCompletion },
  extractFacts = extractFactTags,
  buildQuestions = buildIntakeQuestions,
  entitlements = resolveEntitlement,
  readWeb = readWebCasesWithRefresh,
  // Nothing external is called at all: no model, no embedding, no refresh.
  offline = false,
  // Off unless asked for. It is a window onto spending, not something a
  // deployed service should answer to anyone who guesses the path.
  devDashboard = false,
}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true });
    }
    if (devDashboard && request.method === "GET" && url.pathname === "/dev/usage") {
      const page = await readFile(new URL("./dev-dashboard.html", import.meta.url), "utf8");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return response.end(page);
    }
    if (devDashboard && request.method === "GET" && url.pathname === "/api/dev/usage") {
      const prices = await readModelPrices();
      const [usage, corpus] = await Promise.all([
        readUsageSummary({ pool, days: url.searchParams.get("days"), prices }),
        readCorpusHealth({ pool }),
      ]);
      return sendJson(response, 200, { ...usage, corpus });
    }

    try {
      if (request.method === "POST" && url.pathname === "/api/intake") {
        const body = await readJson(request);
        if (!["victim", "reported"].includes(body.role) || !String(body.redactedText || "").trim()) throw intakeInputError();
        const facts = extractFacts(body.redactedText);
        const questions = buildQuestions(facts, { role: body.role });
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
          const requestEmbeddingClient = !offline && body.allowExternalAi === true
            ? meteredEmbeddingClient({ client: embeddingClient, pool })
            : null;
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
          entitlement: entitlements(),
          offline,
        }));
      }

      if (request.method === "POST" && url.pathname === "/api/web-cases") {
        const body = await readJson(request);
        return sendJson(response, 200, await readWebCases({
          pool, body, analysisClient, extractFacts, readWeb, offline,
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
      const requestEmbeddingClient = !offline && body.allowExternalAi === true
        ? meteredEmbeddingClient({ client: embeddingClient, pool })
        : null;
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
