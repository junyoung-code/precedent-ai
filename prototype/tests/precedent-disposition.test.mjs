import assert from "node:assert/strict";
import test from "node:test";
import {
  DISPOSITION_EXTRACTION_VERSION,
  classifyDisposition,
  extractDisposition,
  upsertPrecedentDisposition,
} from "../server/precedent-disposition.mjs";

function paragraphs(...bodies) {
  return bodies.map((body, index) => ({
    paragraphId: `p${String(index + 1).padStart(3, "0")}`,
    ordinal: index + 1,
    body,
  }));
}

test("takes the order between its heading and the next one", () => {
  const disposition = extractDisposition(paragraphs(
    "【원심판결】 부산지법 2025. 7. 16. 선고 2024노4052 판결",
    "【주 문】",
    "원심판결을 파기하고, 사건을 부산지방법원에 환송한다.",
    "【이 유】 상고이유를 판단한다.",
    "1. 검사의 상고이유에 관하여",
  ));

  assert.equal(disposition.orderText, "원심판결을 파기하고, 사건을 부산지방법원에 환송한다.");
  assert.deepEqual(disposition.paragraphIds, ["p003"]);
  assert.equal(disposition.kind, "remand");
  assert.equal(disposition.extractionVersion, DISPOSITION_EXTRACTION_VERSION);
});

test("keeps every line of a multi-part order together", () => {
  const disposition = extractDisposition(paragraphs(
    "【주 문】",
    "원심판결을 파기한다.",
    "피고인을 징역 1년 6월에 처한다.",
    "다만, 이 판결 확정일부터 3년간 위 형의 집행을 유예한다.",
    "【이 유】",
  ));

  assert.match(disposition.orderText, /^원심판결을 파기한다\. 피고인을 징역 1년 6월에 처한다\./);
  assert.deepEqual(disposition.paragraphIds, ["p002", "p003", "p004"]);
  assert.equal(disposition.kind, "reversed_and_sentenced");
});

test("returns nothing when the judgment carries no order section", () => {
  assert.equal(extractDisposition(paragraphs("【이 유】", "상고이유를 판단한다.")), null);
  assert.equal(extractDisposition([]), null);
  assert.equal(extractDisposition(null), null);
});

test("labels the orders this repository actually holds", () => {
  const cases = [
    ["원심판결을 파기하고, 사건을 부산지방법원에 환송한다.", "remand"],
    ["원심판결을 파기하고, 사건을 서울고등법원에 이송한다.", "remand"],
    ["상고를 기각한다.", "final_appeal_dismissed"],
    ["상고를 모두 기각한다.", "final_appeal_dismissed"],
    ["이 사건 비상상고를 기각한다.", "final_appeal_dismissed"],
    ["피고인과 검사의 항소를 모두 기각한다.", "appeal_dismissed"],
    ["원심판결을 파기한다. 피고인은 무죄. 이 판결의 요지를 공시한다.", "acquitted"],
    ["피고인을 징역 1년에 처한다. 피고인에게 40시간의 이수를 명한다.", "sentenced"],
    ["원심판결을 파기한다. 피고인을 징역 8월에 처한다.", "reversed_and_sentenced"],
    ["피고는 원고에게 10,000,000원을 지급하라.", "civil"],
  ];
  for (const [orderText, expected] of cases) {
    assert.equal(classifyDisposition(orderText), expected, orderText);
  }
});

test("refuses to reduce an order that decides several things at once", () => {
  // Real orders from the repository that mix outcomes. Naming one of them would
  // misstate the rest, so the reader is sent back to the quoted text.
  const mixed = [
    "원심판결을 파기한다. 피고인을 징역 8월에 처한다. 이 사건 공소사실 중 통신매체이용음란의 점은 무죄.",
    "원심판결 중 판시 재물손괴죄에 대한 부분을 파기하고, 이 부분 사건을 서울서부지방법원에 환송한다. 나머지 상고를 기각한다.",
    "피고인 1에 대한 검사의 항소를 기각한다. 원심판결 무죄 부분을 파기한다. 피고인 2 회사를 벌금 1,000만 원에 처한다.",
  ];
  for (const orderText of mixed) {
    assert.equal(classifyDisposition(orderText), "multiple", orderText);
  }
  assert.equal(classifyDisposition(""), "other");
});

test("clears a stored order when the judgment no longer has one", async () => {
  const calls = [];
  const connection = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };

  const written = await upsertPrecedentDisposition({
    connection,
    precedentId: "p1",
    paragraphs: paragraphs("【주 문】", "상고를 기각한다.", "【이 유】"),
  });
  assert.equal(written.kind, "final_appeal_dismissed");
  assert.match(calls[0].sql, /INSERT INTO precedent_dispositions/);
  assert.deepEqual(calls[0].params.slice(0, 3), ["p1", DISPOSITION_EXTRACTION_VERSION, "상고를 기각한다."]);

  const cleared = await upsertPrecedentDisposition({
    connection,
    precedentId: "p1",
    paragraphs: paragraphs("【이 유】", "상고이유를 판단한다."),
  });
  assert.equal(cleared, null);
  assert.match(calls[1].sql, /DELETE FROM precedent_dispositions/);
});
