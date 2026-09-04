import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPrecedentFocus,
  focusPenalty,
  inScopeCaseNameSql,
  isCommunicationObscenityCaseName,
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

test("reads a case name the way the search query does", () => {
  // These four came in through a full-text collection and were never returnable,
  // because the search gates on case_name ILIKE '%통신매체이용음란%'.
  for (const caseName of [
    "손해배상(기)('twistkim' 도메인 이름 사건)",
    "저작권법위반방조",
    "전기통신기본법위반(인정된죄명:전기통신기본법위반방조)",
    "아동·청소년의성보호에관한법률위반(음란물제작·배포등)",
  ]) {
    assert.equal(isCommunicationObscenityCaseName(caseName), false, caseName);
  }

  for (const caseName of [
    "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)",
    "협박·성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)",
    "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)[통신매체이용음란 사건]",
  ]) {
    assert.equal(isCommunicationObscenityCaseName(caseName), true, caseName);
  }

  // Unlike classifyPrecedentFocus this must not collapse whitespace: SQL ILIKE
  // does not either, so a looser reading would store an unsearchable record.
  assert.equal(isCommunicationObscenityCaseName("통신매체 이용 음란"), false);
  assert.equal(classifyPrecedentFocus("통신매체 이용 음란"), "focused");
  assert.equal(isCommunicationObscenityCaseName(""), false);
  assert.equal(isCommunicationObscenityCaseName(null), false);
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

test("keeps one copy of the case-name gate every query shares", async () => {
  // Six queries used to carry their own copy of the literal, which is how the
  // count on the top bar came to be defined in six places at once. A judgment
  // stored under a differently formatted name would be searchable, uncounted
  // and never ranked, and nothing would fail to say so — the trap any new
  // source of judgments walks into first.
  assert.equal(inScopeCaseNameSql(), "case_name ILIKE '%통신매체이용음란%'");
  assert.equal(inScopeCaseNameSql("p"), "p.case_name ILIKE '%통신매체이용음란%'");

  for (const file of ["../server/search-precedents.mjs", "../server/precedent-summaries.mjs"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /case_name ILIKE/, `${file} grew its own copy of the gate`);
  }

  // And the JavaScript half must still read the same name the SQL does, so
  // collection cannot store what the search can never return.
  assert.equal(
    isCommunicationObscenityCaseName("성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)"),
    inScopeCaseNameSql().includes("통신매체이용음란"),
  );
});
