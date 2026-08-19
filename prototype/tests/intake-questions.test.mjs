import assert from "node:assert/strict";
import test from "node:test";
import { buildIntakeQuestions } from "../server/intake-questions.mjs";

test("asks for at most three missing neutral facts in a stable order", () => {
  assert.deepEqual(
    buildIntakeQuestions({ expressionType: "sexual_text", medium: "unknown", reachedRecipient: "unknown", repetition: "once" })
      .map((question) => question.field),
    ["medium", "recipientIdentification", "reachedRecipient"],
  );
});

test("does not ask for known facts", () => {
  assert.deepEqual(
    buildIntakeQuestions({
      expressionType: "sexual_text",
      medium: "kakao",
      recipientIdentification: "direct_account",
      reachedRecipient: "yes",
      relationship: "unknown",
      repetition: "repeated",
    }).map((question) => question.field),
    ["relationship"],
  );
});

test("asks what was sent before anything else it cannot read", () => {
  // An unreadable expression is the one gap that ends the search with nothing,
  // so it is worth a question rather than a silent out-of-scope result.
  const questions = buildIntakeQuestions({});
  assert.equal(questions[0].field, "expressionType");
  assert.match(questions[0].prompt, /받은 말을 그대로 적으셔도 됩니다/);

  // Once the rules can read it, the slot goes back to the other gaps.
  const known = buildIntakeQuestions({ expressionType: "insult_with_sexual_terms" });
  assert.equal(known.some((item) => item.field === "expressionType"), false);
});
