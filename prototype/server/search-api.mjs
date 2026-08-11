import http from "node:http";
import { normalizeSearchQuery, searchPrecedents } from "./search-precedents.mjs";

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

export function createSearchApiServer({ pool, search = searchPrecedents }) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true });
    }
    if (request.method !== "POST" || url.pathname !== "/api/search") {
      return sendJson(response, 404, { error: "NOT_FOUND" });
    }

    try {
      const body = await readJson(request);
      const normalized = normalizeSearchQuery(body.query, body.limit);
      const result = await search({ pool, query: normalized.text, limit: normalized.limit });
      return sendJson(response, 200, result);
    } catch (error) {
      const clientErrors = new Set(["SEARCH_QUERY_REQUIRED", "REQUEST_TOO_LARGE", "INVALID_JSON"]);
      const status = clientErrors.has(error.code) ? 400 : 500;
      return sendJson(response, status, { error: clientErrors.has(error.code) ? error.code : "SEARCH_FAILED" });
    }
  });
}
