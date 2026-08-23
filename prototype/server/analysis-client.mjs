import { ARTICLE_13_ELEMENTS } from "./statute-elements.mjs";
import {
  WEB_BATCH_SIZE, WEB_EXPRESSIONS, WEB_MEDIUMS, WEB_SOURCE_TYPES, WEB_WRITER_ROLES,
} from "./web-cases.mjs";

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/responses";

// No default model. The one to use is decided by measuring candidates against
// the same inputs, so it is configuration, not a constant someone guessed.
export const ANALYSIS_MODEL_ENV = "ANALYSIS_MODEL";

function textArray(maxItems, maxLength) {
  return { type: "array", maxItems, items: { type: "string", minLength: 1, maxLength } };
}

function analysisSchema({ caseNumbers = [] }) {
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
  "웹 검색으로 사용자와 비슷한 '상황'을 겪은 사람이 직접 쓴 글을 찾아 webCases에 담으세요.",
  "찾는 것은 개인이 쓴 글입니다: 네이버 지식iN 질문, 디시인사이드 같은 커뮤니티 글, 네이버 카페·블로그 경험담, 로톡 같은 곳에 올라온 실제 상담 질문.",
  "뉴스 기사, 연구보고서, 법무법인 홍보 글, 판례 해설은 담지 마세요. 사용자가 찾는 것은 자기와 같은 일을 겪은 사람의 글입니다.",
  "검색어는 입력의 웹검색_질의 값을 그대로 쓰거나 거기에 사이트 이름만 덧붙이세요. 사용자_입력의 문장을 검색어에 그대로 넣지 마세요.",
  "title은 그 글의 실제 제목을 그대로 옮기고, url은 그 글로 바로 가는 주소를 그대로 담으세요. 지어내지 마세요.",
  "quote는 그 글이 어떤 상황인지 두세 문장으로 요약하고, 글쓴이나 등장인물의 이름·연락처·계정·학교·회사는 옮기지 마세요.",
  "사건번호나 법원명을 근거처럼 내세우는 항목은 담지 마세요.",
].join(" ");

// A batch is fetched once for a whole query and then narrowed per reader, so it
// asks for more than any one screen shows and labels each post with the same
// tags the rules produce. Nothing here describes a user; the query is built from
// tags before it ever leaves the server.
function webCaseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["webCases"],
    properties: {
      webCases: {
        type: "array",
        maxItems: WEB_BATCH_SIZE,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "url", "sourceType", "quote", "medium", "expression", "writerRole"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            url: { type: "string", minLength: 1, maxLength: 500 },
            sourceType: { type: "string", enum: WEB_SOURCE_TYPES },
            quote: { type: "string", minLength: 1, maxLength: 300 },
            medium: { type: "string", enum: WEB_MEDIUMS },
            expression: { type: "string", enum: WEB_EXPRESSIONS },
            writerRole: { type: "string", enum: WEB_WRITER_ROLES },
          },
        },
      },
    },
  };
}

const WEB_BATCH_INSTRUCTIONS = [
  WEB_INSTRUCTIONS,
  `서로 다른 글 ${WEB_BATCH_SIZE}건을 모으세요. 같은 상황이라도 매체나 표현이 조금씩 다른 글을 섞으면 좋습니다.`,
  // A batch is shared by everyone who lands on this query, and they arrive from
  // both sides of the same event. A batch that happens to be all one side
  // leaves half of them nothing to read — measured, not guessed.
  "당한 사람이 쓴 글과 신고당할까 걱정하는 사람이 쓴 글을 절반씩 섞으세요. 한쪽으로 쏠리면 안 됩니다.",
  "각 글에 medium(매체), expression(표현 종류), writerRole(글쓴이가 피해자인지 신고당한 쪽인지)을 붙이세요.",
  "writerRole은 글에서 분명히 드러날 때만 victim 또는 reported로 하고, 애매하면 unclear로 두세요.",
].join(" ");

function analysisError(code, message) {
  return Object.assign(new Error(message), { code });
}

// Each web_search_call is billed as a tool call on top of the tokens, and the
// usage block does not mention them, so the count has to come from the output.
function countWebSearches(payload) {
  return (payload?.output || []).filter((item) => item?.type === "web_search_call").length;
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
  constructor({ apiKey, model, endpoint = DEFAULT_ENDPOINT, fetchImpl = fetch, timeoutMs = 90_000 } = {}) {
    if (!apiKey) throw analysisError("OPENAI_API_KEY_REQUIRED", "OpenAI API 키가 필요합니다.");
    if (!model) throw analysisError("ANALYSIS_MODEL_REQUIRED", "ANALYSIS_MODEL을 지정해야 합니다.");
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  /**
   * One POST to the Responses API, with the two failure modes both callers need
   * told apart: the service being unreachable, and it answering with something
   * we cannot read.
   */
  async request(body) {
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
    try {
      return await response.json();
    } catch {
      throw analysisError("ANALYSIS_RESPONSE_INVALID", "분석 응답을 읽지 못했습니다.");
    }
  }

  /**
   * Reads the statute against what the user wrote and what the search found.
   *
   * No web search rides along any more. Carrying one turned a nine-second call
   * into a nineteen-second one and made the whole analysis thirteen times more
   * expensive in input tokens, for posts that are the same for everyone whose
   * facts reduce to the same tags — so those are fetched once per query and
   * cached instead.
   */
  async analyze(input) {
    const payload = await this.request({
      model: this.model,
      store: false,
      instructions: INSTRUCTIONS,
      input: buildAnalysisInput(input),
      text: {
        format: {
          type: "json_schema",
          name: "grounded_case_analysis",
          strict: true,
          schema: analysisSchema({
            caseNumbers: (input?.precedents || []).map((item) => item.caseNumber).filter(Boolean),
          }),
        },
      },
    });
    const text = outputText(payload);
    if (!text) throw analysisError("ANALYSIS_RESPONSE_INVALID", "분석 응답이 비어 있습니다.");
    try {
      return {
        analysis: JSON.parse(text),
        usage: payload?.usage || null,
        webSearches: countWebSearches(payload),
      };
    } catch {
      throw analysisError("ANALYSIS_RESPONSE_INVALID", "분석 응답 형식이 올바르지 않습니다.");
    }
  }

  /**
   * Fetches a batch of similar posts for one generalized query.
   *
   * Separate from analyze() because the two have different lifetimes: an
   * analysis belongs to one reader and is thrown away with their description,
   * while a batch belongs to a query that thousands of readers share.
   */
  async searchWebCases({ query }) {
    const text = String(query || "").trim();
    if (!text) throw analysisError("WEB_QUERY_REQUIRED", "웹 검색어가 필요합니다.");

    const payload = await this.request({
      model: this.model,
      store: false,
      instructions: WEB_BATCH_INSTRUCTIONS,
      input: JSON.stringify({ 웹검색_질의: text }),
      tools: [{ type: "web_search" }],
      text: { format: { type: "json_schema", name: "similar_web_cases", strict: true, schema: webCaseSchema() } },
    });

    const body = outputText(payload);
    if (!body) throw analysisError("ANALYSIS_RESPONSE_INVALID", "웹 검색 응답이 비어 있습니다.");
    try {
      return {
        webCases: JSON.parse(body).webCases || [],
        usage: payload?.usage || null,
        webSearches: countWebSearches(payload),
      };
    } catch {
      throw analysisError("ANALYSIS_RESPONSE_INVALID", "웹 검색 응답 형식이 올바르지 않습니다.");
    }
  }
}

export function createAnalysisClientFromEnv(env = process.env) {
  if (!env.OPENAI_API_KEY || !env[ANALYSIS_MODEL_ENV]) return null;
  return new OpenAiAnalysisClient({ apiKey: env.OPENAI_API_KEY, model: env[ANALYSIS_MODEL_ENV] });
}
