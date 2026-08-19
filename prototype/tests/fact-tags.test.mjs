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

test("does not reward a precedent whose facts could not be extracted", () => {
  // messageForm defaults to "text" rather than being detected, so it is the one
  // field every pair can always compare. Seven stored judgments yield no other
  // fact, and on that single field alone they scored a perfect 100 — outranking
  // richly tagged precedents that disagreed on one detail.
  const query = extractFactTags("게임 채팅으로 모르는 사람이 성적인 욕설을 여러 번 보냈습니다.");
  const blank = {
    medium: "unknown", messageForm: "text", recipientIdentification: "unknown",
    reachedRecipient: "unknown", relationship: "unknown", context: "unknown",
    expressionType: "other", repetition: "unknown", additionalChannels: [], issueTags: [],
  };

  const blankComparison = compareFactTags(query, blank);
  assert.equal(blankComparison.comparableCount, 1);
  assert.deepEqual(blankComparison.matchedFacts.map((item) => item.field), ["messageForm"]);
  assert.equal(blankComparison.factScore, 0);

  // One more comparable field is enough for the ratio to mean something.
  const named = compareFactTags(query, { ...blank, medium: "game_chat" });
  assert.equal(named.factScore, 100);
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

test("reads the words a complaint is actually written in", () => {
  // The six terms the extractor started with — 성적, 음란, 야한, 나체, 성기,
  // 성관계 — are how a judgment describes an expression, not how anyone reports
  // receiving one. A real description quotes what was said, and the judgments in
  // this repository quote the same words back.
  const reported = extractFactTags(
    "리그오브레전드를 하다가 시비가 붙어서, 상대방이 나한테 니애미, 니애미 잘먹겠습니다, 등 패드립을 쳤어.",
  );
  assert.equal(reported.expressionType, "insult_with_sexual_terms");
  assert.equal(reported.issueTags.includes("성적표현"), true);

  for (const description of [
    "게임에서 진 뒤에 느금마 소리를 계속 들었습니다.",
    "상대가 저한테 씹새끼라고 했습니다.",
    "카톡으로 니꼬추 어쩌고 하는 메시지를 보냈습니다.",
    "모르는 사람이 자위하는 영상을 보냈습니다.",
  ]) {
    assert.notEqual(extractFactTags(description).expressionType, "other", description);
  }
});

test("does not read an insult, or an everyday word, as a sexual one", () => {
  // Widening the vocabulary must not drag unrelated complaints into scope: the
  // slur terms are substrings, and several of them live inside ordinary words.
  for (const description of [
    "상대가 저를 바보라고 욕했습니다.",
    "게임 실력이 나쁘다고 놀림을 받았습니다.",
    "밥을 씹어 먹다가 이가 부러졌습니다.",
    "비를 맞아서 옷이 다 젖었습니다.",
    "벽에 못을 박아 달라고 부탁했습니다.",
    "고추장을 사왔습니다.",
    "어머니가 편찮으셔서 병원에 갔습니다.",
  ]) {
    const facts = extractFactTags(description);
    assert.equal(facts.expressionType, "other", description);
    assert.equal(facts.issueTags.includes("성적표현"), false, description);
  }
});

test("names the medium the way a complaint names it", () => {
  // Taken from how people write in public legal Q&A: the Korean spelling of DM,
  // the games by their short names, the misspelling of 메시지. An unread medium
  // costs the fact-tag term even when the complaint is otherwise understood.
  const expected = [
    ["트위터로 개인 디엠을 보내 성적인 말을 했습니다.", "sns_mention"],
    ["틱톡 디엠으로 성적인 말을 들었습니다.", "sns_mention"],
    ["오픈카톡방에서 걸레년이라고 했습니다.", "kakao"],
    ["모르는 번호로 메세지가 왔는데 성적인 내용이었습니다.", "digital_message"],
    ["롤하다가 시비붙어서 패드립 들었어요.", "game_chat"],
    ["롤에서 상대가 느금마라고 계속 했습니다.", "game_chat"],
    ["배그 하다가 귓속말로 니애미 어쩌고 들었어요.", "game_chat"],
    ["옵치에서 제 어머니를 걸고 성적인 욕을 했습니다.", "game_chat"],
    ["겜매음으로 고소당할 수 있다고 해서 문의드립니다.", "game_chat"],
  ];
  for (const [description, medium] of expected) {
    assert.equal(extractFactTags(description).medium, medium, description);
  }
});

test("does not find a game in 컨트롤, 스크롤, 트롤 or 롤케이크", () => {
  // 롤 is what half the game complaints call it and also a fragment of several
  // ordinary words, so it is matched with a boundary rather than as a substring.
  for (const description of [
    "컨트롤이 안 돼서 스크롤을 내렸습니다.",
    "롤케이크를 샀습니다.",
    "트롤 짓을 했다고 욕먹었습니다.",
    "롤러스케이트를 탔습니다.",
  ]) {
    assert.equal(extractFactTags(description).medium, "unknown", description);
  }
  // 걸레 is a cleaning rag before it is an insult.
  assert.equal(extractFactTags("걸레로 바닥을 닦았습니다.").expressionType, "other");
});
