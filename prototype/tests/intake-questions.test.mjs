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
  assert.match(questions[0].hint, /그대로 적으셔도 됩니다/);

  // Once the rules can read it, the slot goes back to the other gaps.
  const known = buildIntakeQuestions({ expressionType: "insult_with_sexual_terms" });
  assert.equal(known.some((item) => item.field === "expressionType"), false);
});

test("never says 상대방, which meant both sides on one screen", () => {
  // Three questions used it for the sender and the next for the reader, so a
  // victim was being asked whether they had sent it.
  for (const role of ["victim", "reported"]) {
    for (const question of buildIntakeQuestions({}, { role })) {
      assert.equal(question.prompt.includes("상대방"), false, `${role}: ${question.prompt}`);
      assert.equal(question.hint.includes("상대방"), false, `${role}: ${question.hint}`);
    }
  }
});

test("asks each side about its own position", () => {
  const promptFor = (role, field) => buildIntakeQuestions({}, { role })
    .concat(buildIntakeQuestions({ expressionType: "sexual_text", medium: "kakao", recipientIdentification: "direct_account" }, { role }))
    .find((item) => item.field === field).prompt;

  // The question that was actually backwards: arriving where, exactly.
  assert.match(promptFor("victim", "reachedRecipient"), /회원님에게 도착/);
  assert.match(promptFor("reported", "reachedRecipient"), /상대에게 도착/);
  assert.notEqual(promptFor("victim", "medium"), promptFor("reported", "medium"));
});

test("does not tell the reported side they did it", () => {
  // Someone answering a complaint they deny still has to describe it.
  const questions = buildIntakeQuestions({}, { role: "reported" });
  const text = questions.map((item) => `${item.prompt} ${item.hint}`).join(" ");
  for (const banned of ["회원님이 보낸", "회원님이 한", "회원님의 범행", "가해"]) {
    assert.equal(text.includes(banned), false, banned);
  }
  assert.match(questions[0].prompt, /문제가 된 내용/);
});

test("falls back to one side rather than breaking on an unknown role", () => {
  const fallback = buildIntakeQuestions({}, { role: "정체불명" });
  assert.deepEqual(fallback.map((item) => item.prompt), buildIntakeQuestions({}, { role: "victim" }).map((item) => item.prompt));
  assert.equal(buildIntakeQuestions({}).length, 3);
});
