const ELEMENT_IDS = new Set(["purpose", "medium", "expression", "reached"]);
const MENTIONS = new Set(["present", "absent", "unclear"]);
const SOURCE_TYPES = new Set(["community", "qna", "lawyer_qna", "blog", "news"]);

function cleanSentences(value, limit) {
  return (Array.isArray(value) ? value : [])
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, limit);
}

function mapStatute(value) {
  const body = typeof value?.body === "string" ? value.body.trim() : "";
  const officialUrl = typeof value?.officialUrl === "string" ? value.officialUrl : "";
  // The article is shown as a quotation, so it ships only with its source link.
  if (!body || !officialUrl.startsWith("https://www.law.go.kr/")) return null;
  return {
    lawName: String(value.lawName || ""),
    articleTitle: String(value.articleTitle || ""),
    body,
    enforcedOn: String(value.enforcedOn || ""),
    officialUrl,
  };
}

function mapElements(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => ELEMENT_IDS.has(item?.id) && MENTIONS.has(item?.mention))
    .map((item) => ({
      id: item.id,
      label: String(item.label || ""),
      statuteQuote: String(item.statuteQuote || ""),
      mention: item.mention,
      evidence: String(item.evidence || ""),
    }));
}

/**
 * Asks for the statute reading of a case the search has already answered.
 *
 * Kept separate from the search so the precedent cards render without waiting,
 * and so a failure here leaves those cards untouched.
 */
function mapWebCases(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => SOURCE_TYPES.has(item?.sourceType)
      && typeof item?.url === "string"
      && /^https?:\/\//.test(item.url)
      && typeof item?.title === "string" && item.title.trim()
      && typeof item?.quote === "string" && item.quote.trim())
    .map((item) => ({
      title: item.title.trim(),
      url: item.url,
      sourceType: item.sourceType,
      quote: item.quote.trim(),
    }))
    .slice(0, 6);
}

export async function analyseCase({
  redactedText,
  precedents = [],
  allowExternalAi = false,
  fetchImpl = fetch,
  signal,
} = {}) {
  let response;
  try {
    response = await fetchImpl("/api/analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redactedText,
        allowExternalAi: allowExternalAi === true,
        // Only what the analysis is allowed to cite travels with the request.
        precedents: precedents.slice(0, 5).map((item) => ({
          caseNumber: item.caseNumber,
          court: item.court,
          caseName: item.caseName,
          disposition: item.disposition ? { orderText: item.disposition.orderText } : null,
          similarities: item.similarities || [],
          differences: item.differences || [],
        })),
      }),
      signal,
    });
  } catch {
    return { statute: null, elements: [], analysis: null, webCases: [], unavailable: "ANALYSIS_API_UNAVAILABLE" };
  }
  if (!response.ok) {
    return { statute: null, elements: [], analysis: null, webCases: [], unavailable: "ANALYSIS_API_UNAVAILABLE" };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { statute: null, elements: [], analysis: null, webCases: [], unavailable: "ANALYSIS_RESPONSE_INVALID" };
  }

  const allowed = new Set(precedents.map((item) => item.caseNumber));
  return {
    statute: mapStatute(payload?.statute),
    elements: mapElements(payload?.elements),
    analysis: payload?.analysis
      ? {
        overview: cleanSentences(payload.analysis.overview, 4),
        elementNotes: (Array.isArray(payload.analysis.elementNotes) ? payload.analysis.elementNotes : [])
          .filter((item) => ELEMENT_IDS.has(item?.id) && typeof item?.text === "string" && item.text.trim())
          .map((item) => ({ id: item.id, text: item.text.trim() })),
        // The card list is the only place a case number may come from.
        precedentNotes: (Array.isArray(payload.analysis.precedentNotes) ? payload.analysis.precedentNotes : [])
          .filter((item) => allowed.has(item?.caseNumber) && typeof item?.text === "string" && item.text.trim())
          .map((item) => ({ caseNumber: item.caseNumber, text: item.text.trim() })),
        nextSteps: cleanSentences(payload.analysis.nextSteps, 5),
      }
      : null,
    // Every link here was fetched by the server before it was returned.
    webCases: mapWebCases(payload?.webCases),
    unavailable: payload?.unavailable || null,
  };
}
