import assert from "node:assert/strict";
import test from "node:test";
import { VERIFIED_PRECEDENTS, validatePrecedents } from "../src/lib/precedents.js";
import { extractCaseFacts, rankPrecedents } from "../src/lib/search.js";

test("the prototype exposes only verified official precedent records", () => {
  assert.equal(VERIFIED_PRECEDENTS.length, 6);
  assert.deepEqual(validatePrecedents(VERIFIED_PRECEDENTS), []);

  const expectedCaseNumbers = new Set([
    "2025도12709",
    "2015도17847",
    "2016노147",
    "2018도9775",
    "2023도17539",
    "2025도986",
  ]);

  for (const precedent of VERIFIED_PRECEDENTS) {
    assert.ok(expectedCaseNumbers.has(precedent.caseNumber));
    assert.match(precedent.officialUrl, /^https:\/\/(www\.)?law\.go\.kr\//);
    assert.equal(precedent.verified, true);
    assert.ok(precedent.sourceAnchors.length > 0);
  }
});

test("extracts neutral facts without producing a legal outcome", () => {
  const facts = extractCaseFacts(
    "온라인 게임에서 처음 만난 상대와 다투다가 카카오톡으로 성적인 욕설을 한 번 받았습니다.",
  );

  assert.equal(facts.medium, "kakao");
  assert.equal(facts.relationship, "game_user");
  assert.equal(facts.context, "conflict");
  assert.equal(facts.messageForm, "text");
  assert.equal("outcome" in facts, false);
  assert.equal("convictionProbability" in facts, false);
});

test("ranks a game dispute against verified precedents using 45/45/10 scores", () => {
  const results = rankPrecedents({
    role: "reported",
    description:
      "온라인 게임에서 처음 만난 상대와 말다툼을 하다가 카카오톡으로 성적인 욕설을 한 번 보냈습니다.",
  });

  assert.ok(results.length > 0);
  assert.equal(results[0].caseNumber, "2023도17539");
  assert.equal(
    results[0].similarity.total,
    Math.round(
      results[0].similarity.semantic * 0.45 +
        results[0].similarity.facts * 0.45 +
        results[0].similarity.issues * 0.1,
    ),
  );
  assert.ok(results.every((result) => result.similarity.total >= 55));
  assert.ok(results.length <= 5);
});

test("does not invent a precedent when the top score is below 55", () => {
  const results = rankPrecedents({
    role: "victim",
    description: "주차 위치를 두고 짧게 대화했습니다.",
  });

  assert.deepEqual(results, []);
});

test("deterministic comparison text is grounded in matching fact labels", () => {
  const [result] = rankPrecedents({
    role: "victim",
    description: "계좌로 1원을 보내며 송금메모에 성적인 욕설을 반복해서 적었습니다.",
  });

  assert.equal(result.caseNumber, "2025도12709");
  assert.ok(result.similarities.some((item) => item.includes("송금메모")));
  assert.ok(result.summary.every((sentence) => sentence.sourceAnchor));
});
