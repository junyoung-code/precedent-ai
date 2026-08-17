const DEFAULT_ENDPOINT = "https://api.openai.com/v1/embeddings";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

function embeddingError(code, message) {
  return Object.assign(new Error(message), { code });
}

export class OpenAiEmbeddingClient {
  constructor({ apiKey, model = DEFAULT_EMBEDDING_MODEL, endpoint = DEFAULT_ENDPOINT, fetchImpl = fetch } = {}) {
    if (!apiKey) throw embeddingError("OPENAI_API_KEY_REQUIRED", "OpenAI API 키가 필요합니다.");
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
  }

  async embed(input) {
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
          input,
          dimensions: EMBEDDING_DIMENSIONS,
          encoding_format: "float",
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw embeddingError("EMBEDDING_API_UNAVAILABLE", `임베딩 API를 호출할 수 없습니다: ${error.name}`);
    }

    if (!response.ok) {
      throw embeddingError("EMBEDDING_API_UNAVAILABLE", `임베딩 API가 ${response.status}로 응답했습니다.`);
    }

    const payload = await response.json();
    const vector = payload?.data?.[0]?.embedding;
    if (!Array.isArray(vector)
      || vector.length !== EMBEDDING_DIMENSIONS
      || vector.some((value) => !Number.isFinite(value))) {
      throw embeddingError("EMBEDDING_RESPONSE_INVALID", "임베딩 응답 형식이 올바르지 않습니다.");
    }
    return vector;
  }
}

export function createEmbeddingClientFromEnv(env = process.env) {
  if (env.EMBEDDING_SEARCH_ENABLED !== "true" || !env.OPENAI_API_KEY) return null;
  return new OpenAiEmbeddingClient({
    apiKey: env.OPENAI_API_KEY,
    model: env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
  });
}
