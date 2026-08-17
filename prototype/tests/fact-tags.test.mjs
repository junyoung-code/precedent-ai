import assert from "node:assert/strict";
import test from "node:test";
import { compareFactTags, extractFactTags } from "../src/lib/fact-tags.js";

test("uses the rule-v2 extraction version", () => {
  assert.equal(extractFactTags("통신매체이용음란").extractionVersion, "rule-v2");
});

test("extracts neutral communication facts without legal conclusions", () => {
  const facts = extractFactTags(
    "온라인 게임에서 처음 만난 상대가 채팅창으로 성적인 욕설을 한 번 보냈습니다.",
    { role: "victim" },
  );

  assert.equal(facts.medium, "game_chat");
  assert.equal(facts.relationship, "game_user");
  assert.equal(facts.context, "conflict");
  assert.equal(facts.messageForm, "text");
  assert.equal(facts.expressionType, "insult_with_sexual_terms");
  assert.equal(facts.repetition, "once");
  assert.equal(facts.reachedRecipient, "yes");
  assert.ok(facts.issueTags.includes("통신매체"));
  assert.ok(facts.issueTags.includes("성적표현"));
  for (const forbidden of ["outcome", "guilt", "complaintPossible", "punishment"]) {
    assert.equal(Object.hasOwn(facts, forbidden), false);
  }
});

test("extracts image, repeated delivery, recipient identification, and additional channels", () => {
  const facts = extractFactTags("카카오톡과 인스타 DM으로 나체 사진을 여러 번 받았습니다.");

  assert.equal(facts.medium, "kakao");
  assert.equal(facts.messageForm, "image");
  assert.equal(facts.expressionType, "sexual_image");
  assert.equal(facts.repetition, "repeated");
  assert.equal(facts.reachedRecipient, "yes");
  assert.equal(facts.recipientIdentification, "direct_account");
  assert.deepEqual(facts.additionalChannels, ["sns_mention"]);
});

test("does not change tags or scores based on the selected user role", () => {
  const description = "카카오톡으로 성적인 메시지를 한 번 보냈습니다.";
  const victim = extractFactTags(description, { role: "victim" });
  const reported = extractFactTags(description, { role: "reported" });

  assert.deepEqual(victim, reported);
  assert.equal(compareFactTags(victim, reported).factScore, 100);
});

test("compares only known neutral fields and returns match evidence", () => {
  const query = extractFactTags("게임 채팅에서 모르는 사람에게 성적인 욕설을 한 번 보냈습니다.");
  const precedent = extractFactTags("게임 채팅에서 모르는 사람에게 성적인 욕설을 여러 번 보냈습니다.");
  const comparison = compareFactTags(query, precedent);

  assert.ok(comparison.factScore > 0 && comparison.factScore < 100);
  assert.ok(comparison.issueScore >= 0 && comparison.issueScore <= 100);
  assert.ok(comparison.matchedFacts.some((item) => item.field === "medium"));
  assert.ok(comparison.differentFacts.some((item) => item.field === "repetition"));
  assert.equal(Object.hasOwn(comparison, "outcome"), false);
});
