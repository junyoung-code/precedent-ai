import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiSummaryClient } from "../server/summary-client.mjs";

const VALID_PAYLOAD = {
  sentences: [{ text: "법원은 메시지 전달 경위와 전체 대화 맥락을 함께 살폈습니다.", paragraphIds: ["p-0001"] }],
};

test("requests strict grounded JSON from the Responses API without storage", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({
        output: [{ content: [{ type: "output_text", text: JSON.stringify(VALID_PAYLOAD) }] }],
      }),
    };
  };
  const client = new OpenAiSummaryClient({ apiKey: "test-key", model: "gpt-5-mini", fetchImpl });
  const result = await client.summarize({
    paragraphs: [{ paragraphId: "p-0001", text: "판결문 문단입니다." }],
  });

  assert.deepEqual(result, VALID_PAYLOAD);
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.body.model, "gpt-5-mini");
  assert.equal(request.body.store, false);
  assert.equal(request.body.text.format.type, "json_schema");
  assert.equal(request.body.text.format.strict, true);
  assert.match(request.body.input, /p-0001/);
  assert.match(request.body.input, /판결문 문단입니다/);
  assert.doesNotMatch(request.body.input, /caseNumber|officialUrl|userQuery/);
});

test("requires a key and maps response failures to stable summary errors", async () => {
  assert.throws(() => new OpenAiSummaryClient(), { code: "OPENAI_API_KEY_REQUIRED" });

  const unavailable = new OpenAiSummaryClient({
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(
    () => unavailable.summarize({ paragraphs: [{ paragraphId: "p-1", text: "본문" }] }),
    { code: "SUMMARY_API_UNAVAILABLE" },
  );

  const invalid = new OpenAiSummaryClient({
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, json: async () => ({ output: [] }) }),
  });
  await assert.rejects(
    () => invalid.summarize({ paragraphs: [{ paragraphId: "p-1", text: "본문" }] }),
    { code: "SUMMARY_RESPONSE_INVALID" },
  );
});
