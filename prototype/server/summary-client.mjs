const DEFAULT_ENDPOINT = "https://api.openai.com/v1/responses";
export const DEFAULT_SUMMARY_MODEL = "gpt-5-mini";

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sentences"],
  properties: {
    sentences: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "paragraphIds"],
        properties: {
          text: { type: "string", minLength: 1, maxLength: 500 },
          paragraphIds: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: { type: "string" },
          },
        },
      },
    },
  },
};

const INSTRUCTIONS = [
  "주어진 한 판례의 판결문 문단만 근거로 한국어 핵심 요약을 작성하세요.",
  "사실관계와 법원이 중요하게 판단한 이유만 중립적으로 설명하세요.",
  "각 문장은 반드시 제공된 paragraphId를 하나 이상 그대로 인용하세요.",
  "사용자 사건 판단, 신고·고소 가능성, 유무죄·형량 예측, 법률 조언을 작성하지 마세요.",
  "사건번호, 법원, 날짜, URL을 만들거나 출력하지 마세요.",
].join(" ");

function summaryError(code, message) {
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

export class OpenAiSummaryClient {
  constructor({ apiKey, model = DEFAULT_SUMMARY_MODEL, endpoint = DEFAULT_ENDPOINT, fetchImpl = fetch } = {}) {
    if (!apiKey) throw summaryError("OPENAI_API_KEY_REQUIRED", "OpenAI API 키가 필요합니다.");
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
  }

  async summarize({ paragraphs } = {}) {
    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      throw summaryError("SUMMARY_INPUT_REQUIRED", "요약할 판결문 문단이 필요합니다.");
    }

    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          store: false,
          instructions: INSTRUCTIONS,
          input: JSON.stringify({ paragraphs }),
          text: {
            format: {
              type: "json_schema",
              name: "grounded_precedent_summary",
              strict: true,
              schema: SUMMARY_SCHEMA,
            },
          },
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw summaryError("SUMMARY_API_UNAVAILABLE", `요약 API를 호출할 수 없습니다: ${error.name}`);
    }
    if (!response.ok) {
      throw summaryError("SUMMARY_API_UNAVAILABLE", `요약 API가 ${response.status}로 응답했습니다.`);
    }

    let payload;
    try {
      payload = await response.json();
      const text = outputText(payload);
      if (!text) throw new Error("OUTPUT_TEXT_REQUIRED");
      return JSON.parse(text);
    } catch {
      throw summaryError("SUMMARY_RESPONSE_INVALID", "요약 응답 형식이 올바르지 않습니다.");
    }
  }
}
