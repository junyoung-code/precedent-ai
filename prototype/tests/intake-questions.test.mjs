import assert from "node:assert/strict";
import test from "node:test";
import { buildIntakeQuestions } from "../server/intake-questions.mjs";

test("asks for at most three missing neutral facts in a stable order", () => {
  assert.deepEqual(
    buildIntakeQuestions({ medium: "unknown", reachedRecipient: "unknown", repetition: "once" })
      .map((question) => question.field),
    ["medium", "recipientIdentification", "reachedRecipient"],
  );
});

test("does not ask for known facts", () => {
  assert.deepEqual(
    buildIntakeQuestions({
      medium: "kakao",
      recipientIdentification: "direct_account",
      reachedRecipient: "yes",
      relationship: "unknown",
      repetition: "repeated",
    }).map((question) => question.field),
    ["relationship"],
  );
});
