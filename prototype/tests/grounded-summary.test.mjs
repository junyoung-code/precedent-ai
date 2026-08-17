import assert from "node:assert/strict";
import test from "node:test";
import { validateGroundedSummary } from "../server/grounded-summary.mjs";

const allowed = new Set(["p-0001", "p-0002"]);

test("accepts one to three neutral sentences grounded in allowed paragraph ids", () => {
  const result = validateGroundedSummary({
    sentences: [
      { text: "  법원은 메시지 전달 경위와 대화의 전체 맥락을 함께 살폈습니다.  ", paragraphIds: ["p-0001"] },
      { text: "표현이 전달된 매체와 상대방에게 도달한 과정도 판단 요소로 확인했습니다.", paragraphIds: ["p-0001", "p-0002"] },
    ],
  }, allowed);

  assert.deepEqual(result, [
    { text: "법원은 메시지 전달 경위와 대화의 전체 맥락을 함께 살폈습니다.", paragraphIds: ["p-0001"] },
    { text: "표현이 전달된 매체와 상대방에게 도달한 과정도 판단 요소로 확인했습니다.", paragraphIds: ["p-0001", "p-0002"] },
  ]);
});

test("rejects the entire response when evidence or shape is invalid", () => {
  const invalidPayloads = [
    { sentences: [] },
    { sentences: Array.from({ length: 4 }, () => ({ text: "근거가 있는 중립 문장입니다.", paragraphIds: ["p-0001"] })) },
    { sentences: [{ text: "", paragraphIds: ["p-0001"] }] },
    { sentences: [{ text: "근거 없는 중립 문장입니다.", paragraphIds: [] }] },
    { sentences: [{ text: "존재하지 않는 문단을 인용한 문장입니다.", paragraphIds: ["p-9999"] }] },
    { sentences: [{ text: "메타데이터를 포함한 문장입니다.", paragraphIds: ["p-0001"], caseNumber: "2023도1" }] },
    { sentences: [{ text: "중립 문장입니다.", paragraphIds: ["p-0001"] }], officialUrl: "https://law.go.kr" },
  ];

  for (const payload of invalidPayloads) {
    assert.throws(() => validateGroundedSummary(payload, allowed), { code: "SUMMARY_RESPONSE_INVALID" });
  }
});

test("rejects predictions and advice about the user's case", () => {
  for (const text of [
    "이 사례는 고소 가능성이 높습니다.",
    "사용자 사건도 유죄가 될 가능성이 높습니다.",
    "신고하면 처벌될 수 있습니다.",
  ]) {
    assert.throws(
      () => validateGroundedSummary({ sentences: [{ text, paragraphIds: ["p-0001"] }] }, allowed),
      { code: "SUMMARY_RESPONSE_INVALID" },
    );
  }
});
