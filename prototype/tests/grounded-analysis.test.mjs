import assert from "node:assert/strict";
import test from "node:test";
import { validateGroundedAnalysis } from "../server/grounded-analysis.mjs";

const ALLOWED = new Set(["2023도7199", "2025도12709"]);

test("keeps neutral analysis and reports nothing dropped", () => {
  const result = validateGroundedAnalysis({
    overview: ["회원님은 게임 채팅으로 성적인 표현을 받았다고 적었습니다."],
    elementNotes: [{ id: "medium", text: "제13조의 통신매체는 전화·우편·컴퓨터처럼 내용을 전달하는 수단을 말합니다." }],
    precedentNotes: [{ caseNumber: "2023도7199", text: "이 판례에서 법원은 목적의 존재를 여러 사정을 종합해 판단했습니다." }],
    nextSteps: ["대화 화면을 삭제하지 말고 그대로 보관하세요."],
  }, ALLOWED);

  assert.equal(result.overview.length, 1);
  assert.equal(result.elementNotes.length, 1);
  assert.equal(result.precedentNotes.length, 1);
  assert.equal(result.nextSteps.length, 1);
  assert.deepEqual(result.dropped, []);
});

test("drops a sentence that decides the reader's case", () => {
  const result = validateGroundedAnalysis({
    overview: [
      "회원님의 상황은 통신매체이용음란에 해당합니다.",
      "입력하신 내용에는 전달 수단과 도달에 관한 언급이 있습니다.",
    ],
    nextSteps: ["고소하면 처벌받게 할 수 있습니다.", "증거를 보관하세요."],
  }, ALLOWED);

  assert.deepEqual(result.overview, ["입력하신 내용에는 전달 수단과 도달에 관한 언급이 있습니다."]);
  assert.deepEqual(result.nextSteps, ["증거를 보관하세요."]);
  assert.equal(result.dropped.includes("overview"), true);
  assert.equal(result.dropped.includes("nextStep"), true);
});

test("drops a citation the search did not return", () => {
  const result = validateGroundedAnalysis({
    precedentNotes: [
      { caseNumber: "2023도7199", text: "법원은 메시지 전달 경위를 함께 살폈습니다." },
      // Case numbers are the easiest thing for a model to invent.
      { caseNumber: "2021도9999", text: "이 판례에서도 같은 판단이 있었습니다." },
    ],
  }, ALLOWED);

  assert.deepEqual(result.precedentNotes.map((item) => item.caseNumber), ["2023도7199"]);
  assert.equal(result.dropped.includes("precedentNote"), true);
});

test("lets a precedent note say what that court did, but not what it means for the reader", () => {
  const result = validateGroundedAnalysis({
    precedentNotes: [
      { caseNumber: "2025도12709", text: "원심은 송금메모를 통신매체로 보기 어렵다고 보아 무죄로 판단했습니다." },
      { caseNumber: "2025도12709", text: "따라서 회원님의 사건도 유죄가 됩니다." },
    ],
  }, ALLOWED);

  assert.equal(result.precedentNotes.length, 1);
  assert.match(result.precedentNotes[0].text, /원심은/);
});

test("drops a note attached to an element that does not exist", () => {
  const result = validateGroundedAnalysis({
    elementNotes: [
      { id: "reached", text: "도달은 상대방이 내용을 알 수 있는 상태에 놓이는 것을 말합니다." },
      { id: "invented_element", text: "이런 요건도 있습니다." },
      { id: "reached", text: "중복된 항목입니다." },
    ],
  }, ALLOWED);

  assert.deepEqual(result.elementNotes.map((item) => item.id), ["reached"]);
  assert.equal(result.dropped.filter((item) => item === "elementNote").length, 2);
});

test("survives a malformed payload instead of failing the request", () => {
  // The analysis sits under a result that already stands on its own.
  for (const payload of [null, "text", [], { overview: "not an array" }]) {
    const result = validateGroundedAnalysis(payload, ALLOWED);
    assert.deepEqual(result.overview, []);
    assert.deepEqual(result.precedentNotes, []);
  }
});
