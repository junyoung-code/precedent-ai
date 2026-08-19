import { ARTICLE_13_ELEMENTS } from "./statute-elements.mjs";

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/responses";

// No default model. The one to use is decided by measuring candidates against
// the same inputs, so it is configuration, not a constant someone guessed.
export const ANALYSIS_MODEL_ENV = "ANALYSIS_MODEL";

const SOURCE_TYPES = ["community", "qna", "lawyer_qna", "blog", "news"];

function textArray(maxItems, maxLength) {
  return { type: "array", maxItems, items: { type: "string", minLength: 1, maxLength } };
}

function analysisSchema({ webSearch, caseNumbers = [] }) {
  // Constrain the identifiers in the schema itself. Left as free strings, a
  // model labels the elements in its own words and cites case numbers that were
  // never in the search result, and both only get caught after the fact.
  const caseNumber = caseNumbers.length > 0
    ? { type: "string", enum: [...caseNumbers] }
    : { type: "string" };

  const properties = {
    overview: textArray(4, 400),
    elementNotes: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text"],
        properties: {
          id: { type: "string", enum: ARTICLE_13_ELEMENTS.map((item) => item.id) },
          text: { type: "string", minLength: 1, maxLength: 400 },
        },
      },
    },
    precedentNotes: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["caseNumber", "text"],
        properties: { caseNumber, text: { type: "string", minLength: 1, maxLength: 400 } },
      },
    },
    nextSteps: textArray(5, 200),
  };

  if (webSearch) {
    properties.webCases = {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url", "sourceType", "quote"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          url: { type: "string", minLength: 1, maxLength: 500 },
          sourceType: { type: "string", enum: SOURCE_TYPES },
          quote: { type: "string", minLength: 1, maxLength: 300 },
        },
      },
    };
  }

  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

const INSTRUCTIONS = [
  "주어진 법조문과 검색 결과로 받은 판례만 근거로 한국어 설명을 작성하세요.",
  "요건별 판정(mention)은 이미 정해져 제공됩니다. 판정을 바꾸거나 새로 만들지 말고, 각 요건이 무엇을 뜻하는지만 설명하세요.",
  "present·absent·unclear 같은 내부 값이나 id를 문장에 그대로 쓰지 마세요. '판정:' 같은 접두어도 붙이지 마세요. 사용자가 읽는 한국어 문장만 쓰세요.",
  "사용자 사건의 성립 여부, 유무죄, 형량, 고소·신고 가능성, 승패 전망을 쓰지 마세요.",
  "'해당합니다', '성립합니다', '충족합니다', '처벌받습니다' 같은 표현을 쓰지 마세요.",
  "판례 문장은 제공된 사건번호만 인용하고, 목록에 없는 사건번호나 법원명을 만들지 마세요.",
  "nextSteps는 증거 보관·기록 정리·전문가 상담 같은 절차 안내만 담고 법적 결론을 담지 마세요.",
].join(" ");

const WEB_INSTRUCTIONS = [
  "웹 검색으로 사용자와 비슷한 '상황'을 겪은 글을 찾아 webCases에 담으세요.",
  "출처의 권위가 아니라 상황의 유사도로 고르세요. 커뮤니티 글, 지식iN 질문, 변호사 Q&A, 블로그 모두 좋습니다.",
  "각 항목은 실제로 접근 가능한 URL을 그대로 담고, 인용은 세 문장 이내로 짧게 하세요.",
  "글쓴이나 등장인물의 이름·연락처·계정·학교·회사를 인용에 옮기지 마세요.",
  "판례를 소개하는 글이라도 사건번호를 근거처럼 내세우지 마세요.",
].join(" ");

function analysisError(code, message) {
  return Object.assign(new Error(message), { code });
}

function outputText(payload) {
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

export function buildAnalysisInput({ statute, elements, description, precedents, searchQuery }) {
  return JSON.stringify({
    법조문: statute
      ? { 법령명: statute.lawName, 조문: statute.articleTitle, 본문: statute.body, 시행일: statute.enforcedOn }
      : null,
    요건별_판정: (elements || []).map((item) => ({
      id: item.id, 요건: item.label, 조문문구: item.statuteQuote, mention: item.mention, 근거: item.evidence,
    })),
    사용자_입력: description,
    검색된_판례: (precedents || []).map((item) => ({
      사건번호: item.caseNumber, 법원: item.court, 사건명: item.caseName,
      주문: item.disposition?.orderText || null,
      닮은점: item.similarities || [], 다른점: item.differences || [],
    })),
    웹검색_질의: searchQuery || null,
  });
}

export class OpenAiAnalysisClient {
  constructor({ apiKey, model, endpoint = DEFAULT_ENDPOINT, fetchImpl = fetch, webSearch = false, timeoutMs = 90_000 } = {}) {
    if (!apiKey) throw analysisError("OPENAI_API_KEY_REQUIRED", "OpenAI API 키가 필요합니다.");
    if (!model) throw analysisError("ANALYSIS_MODEL_REQUIRED", "ANALYSIS_MODEL을 지정해야 합니다.");
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.webSearch = webSearch === true;
    this.timeoutMs = timeoutMs;
  }

  async analyze(input) {
    const body = {
      model: this.model,
      store: false,
      instructions: this.webSearch ? `${INSTRUCTIONS} ${WEB_INSTRUCTIONS}` : INSTRUCTIONS,
      input: buildAnalysisInput(input),
      text: {
        format: {
          type: "json_schema",
          name: "grounded_case_analysis",
          strict: true,
          schema: analysisSchema({
            webSearch: this.webSearch,
            caseNumbers: (input?.precedents || []).map((item) => item.caseNumber).filter(Boolean),
          }),
        },
      },
    };
    if (this.webSearch) body.tools = [{ type: "web_search" }];

    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw analysisError("ANALYSIS_API_UNAVAILABLE", `분석 API를 호출할 수 없습니다: ${error.name}`);
    }
    if (!response.ok) {
      throw analysisError("ANALYSIS_API_UNAVAILABLE", `분석 API가 ${response.status}로 응답했습니다.`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw analysisError("ANALYSIS_RESPONSE_INVALID", "분석 응답을 읽지 못했습니다.");
    }
    const text = outputText(payload);
    if (!text) throw analysisError("ANALYSIS_RESPONSE_INVALID", "분석 응답이 비어 있습니다.");
    try {
      return { analysis: JSON.parse(text), usage: payload?.usage || null };
    } catch {
      throw analysisError("ANALYSIS_RESPONSE_INVALID", "분석 응답 형식이 올바르지 않습니다.");
    }
  }
}

export function createAnalysisClientFromEnv(env = process.env) {
  if (!env.OPENAI_API_KEY || !env[ANALYSIS_MODEL_ENV]) return null;
  return new OpenAiAnalysisClient({
    apiKey: env.OPENAI_API_KEY,
    model: env[ANALYSIS_MODEL_ENV],
    webSearch: env.ANALYSIS_WEB_SEARCH === "true",
  });
}
