import assert from "node:assert/strict";
import test from "node:test";
import { redactSensitiveText } from "../src/lib/privacy-redaction.js";

test("redacts contact details and account identifiers before submission", () => {
  assert.deepEqual(redactSensitiveText("연락처 010-1234-5678, @case_user, a@b.kr"), {
    text: "연락처 [가림], [가림], [가림]",
    redactionCount: 3,
  });
});

test("redacts resident-like identifiers, profile links, and road addresses", () => {
  const result = redactSensitiveText("주민 900101-1234567, https://example.com/@person, 서울로 12번지");
  assert.equal(result.redactionCount, 3);
  assert.equal(result.text, "주민 [가림], [가림], [가림]");
});

test("keeps empty input empty", () => {
  assert.deepEqual(redactSensitiveText(""), { text: "", redactionCount: 0 });
});
