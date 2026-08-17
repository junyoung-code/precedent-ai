import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPrecedentFocus,
  focusPenalty,
  isFocusedCommunicationObscenity,
  selectCommunicationObscenityParagraphs,
} from "../server/precedent-scope.mjs";

test("classifies focused, mixed, and peripheral precedent names", () => {
  assert.equal(
    classifyPrecedentFocus("성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)"),
    "focused",
  );
  assert.equal(
    classifyPrecedentFocus("협박·성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)"),
    "mixed",
  );
  assert.equal(
    classifyPrecedentFocus("성폭력범죄의처벌등에관한특례법위반(13세미만미성년자강간)·성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)·부착명령"),
    "peripheral",
  );
  assert.deepEqual(
    [focusPenalty("focused"), focusPenalty("mixed"), focusPenalty("peripheral")],
    [0, 15, 30],
  );
  assert.equal(
    isFocusedCommunicationObscenity("성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)"),
    true,
  );
  assert.equal(isFocusedCommunicationObscenity("손해배상(기)등청구의소"), false);
});

test("selects keyword paragraphs with one neighbor on each side", () => {
  const paragraphs = [
    { paragraphId: "p1", ordinal: 1, body: "사건의 배경" },
    { paragraphId: "p2", ordinal: 2, body: "통신매체이용음란 공소사실" },
    { paragraphId: "p3", ordinal: 3, body: "메시지 전송 경위" },
    { paragraphId: "p4", ordinal: 4, body: "압수수색에 관한 판단" },
    { paragraphId: "p5", ordinal: 5, body: "성폭력처벌법 제13조의 해석" },
    { paragraphId: "p6", ordinal: 6, body: "법리 적용" },
  ];

  const selected = selectCommunicationObscenityParagraphs(paragraphs);
  assert.deepEqual(selected.map((item) => item.paragraphId), ["p1", "p2", "p3", "p4", "p5", "p6"]);
  assert.deepEqual(Object.keys(selected[0]).sort(), ["ordinal", "paragraphId", "text"]);
});

test("does not fall back to the whole judgment when fewer than three paragraphs match", () => {
  const selected = selectCommunicationObscenityParagraphs([
    { paragraphId: "p1", ordinal: 1, body: "통신매체이용음란" },
    { paragraphId: "p2", ordinal: 2, body: "한 개의 인접 문단" },
  ]);
  assert.deepEqual(selected, []);
});
