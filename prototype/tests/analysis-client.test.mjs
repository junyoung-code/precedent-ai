import assert from "node:assert/strict";
import test from "node:test";
import { analyseCase } from "../src/lib/analysis-api.js";

const PRECEDENTS = [{
  caseNumber: "2023도7199",
  court: "대법원",
  caseName: "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)",
  disposition: { orderText: "원심판결을 파기하고, 사건을 서울중앙지방법원에 환송한다.", kind: "remand" },
  similarities: ["게임 채팅을 사용했다는 점"],
  differences: [],
  summary: [{ text: "요약", sourceAnchor: "판결문 문단 p011" }],
}];

const BODY = {
  statute: {
    lawName: "성폭력범죄의 처벌 등에 관한 특례법",
    articleTitle: "통신매체를 이용한 음란행위",
    body: "제13조(통신매체를 이용한 음란행위) 자기 또는 다른 사람의 성적 욕망을 …",
    enforcedOn: "2025-10-01",
    officialUrl: "https://www.law.go.kr/법령/성폭력범죄의처벌등에관한특례법/제13조",
  },
  elements: [{ id: "medium", label: "통신매체를 통한 전달", statuteQuote: "…통신매체를 통하여", mention: "present", evidence: "게임 채팅" }],
  analysis: {
    overview: ["입력에는 게임 채팅을 통한 전달이 나타나 있습니다."],
    elementNotes: [{ id: "medium", text: "통신매체는 전화·우편·컴퓨터 같은 전달 수단을 말합니다." }],
    precedentNotes: [{ caseNumber: "2023도7199", text: "이 판례의 주문은 파기환송입니다." }],
    nextSteps: ["대화 화면을 원본 그대로 보관하세요."],
  },
  unavailable: null,
};

test("sends only the redacted text and the cards the analysis may cite", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify(BODY), { status: 200 });
  };

  await analyseCase({
    redactedText: "게임 채팅으로 성적인 욕설을 받았습니다.",
    precedents: PRECEDENTS,
    allowExternalAi: true,
    fetchImpl,
  });

  assert.equal(request.url, "/api/analysis");
  assert.equal(request.body.redactedText, "게임 채팅으로 성적인 욕설을 받았습니다.");
  assert.equal(request.body.allowExternalAi, true);
  assert.deepEqual(request.body.precedents[0].caseNumber, "2023도7199");
  // The judgment text and the grounded summary stay out of the request.
  assert.equal(Object.hasOwn(request.body.precedents[0], "summary"), false);
  assert.equal(Object.hasOwn(request.body, "description"), false);
});

test("defaults consent to false", async () => {
  let body;
  const fetchImpl = async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ unavailable: "ANALYSIS_DISABLED" }), { status: 200 });
  };
  await analyseCase({ redactedText: "게임 채팅", fetchImpl });
  assert.equal(body.allowExternalAi, false);
});

test("maps a full analysis and keeps the statute's official link", async () => {
  const fetchImpl = async () => new Response(JSON.stringify(BODY), { status: 200 });
  const result = await analyseCase({ redactedText: "게임 채팅", precedents: PRECEDENTS, fetchImpl });

  assert.match(result.statute.body, /^제13조/);
  assert.equal(result.statute.enforcedOn, "2025-10-01");
  assert.deepEqual(result.elements.map((item) => item.mention), ["present"]);
  assert.equal(result.analysis.overview.length, 1);
  assert.equal(result.analysis.precedentNotes[0].caseNumber, "2023도7199");
});

test("drops a statute without an official law.go.kr link", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    ...BODY,
    statute: { ...BODY.statute, officialUrl: "https://example.com/제13조" },
  }), { status: 200 });
  const result = await analyseCase({ redactedText: "게임 채팅", fetchImpl });
  assert.equal(result.statute, null);
});

test("drops a citation to a card the screen is not showing", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    ...BODY,
    analysis: { ...BODY.analysis, precedentNotes: [{ caseNumber: "2099도1", text: "지어낸 판례" }] },
  }), { status: 200 });
  const result = await analyseCase({ redactedText: "게임 채팅", precedents: PRECEDENTS, fetchImpl });
  assert.deepEqual(result.analysis.precedentNotes, []);
});

test("reports why an analysis is missing instead of throwing", async () => {
  for (const [fetchImpl, expected] of [
    [async () => { throw new Error("offline"); }, "ANALYSIS_API_UNAVAILABLE"],
    [async () => new Response("nope", { status: 500 }), "ANALYSIS_API_UNAVAILABLE"],
    [async () => new Response("not json", { status: 200 }), "ANALYSIS_RESPONSE_INVALID"],
    [async () => new Response(JSON.stringify({ unavailable: "ANALYSIS_DISABLED" }), { status: 200 }), "ANALYSIS_DISABLED"],
  ]) {
    const result = await analyseCase({ redactedText: "게임 채팅", fetchImpl });
    assert.equal(result.unavailable, expected);
    assert.equal(result.analysis, null);
  }
});
