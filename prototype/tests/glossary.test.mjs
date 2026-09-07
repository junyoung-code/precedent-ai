import assert from "node:assert/strict";
import test from "node:test";
import { validateGroundedAnalysis } from "../server/grounded-analysis.mjs";
import { GLOSSARY, glossTokens } from "../src/lib/glossary.js";

test("explains each word from an article, or cites nothing at all", () => {
  assert.equal(new Set(GLOSSARY.map((entry) => entry.term)).size, GLOSSARY.length, "a term is defined twice");

  for (const entry of GLOSSARY) {
    assert.ok(entry.term.trim() && entry.text.trim(), `${entry.term} is empty`);
    for (const source of entry.sources) {
      // The rule the statute, the notes and the timeline all hold: a claim
      // about the law ships with the article it was read from.
      assert.ok(source.url.startsWith("https://www.law.go.kr/"), `${entry.term}: ${source.url}`);
      assert.ok(source.label.trim(), `${entry.term} links something unnamed`);
    }
    // An explanation that names an article without linking it is a citation
    // nobody can check — worse than an explanation that cites nothing.
    for (const article of entry.text.match(/제\d+조(?:의\d+)?/g) || []) {
      assert.ok(
        entry.sources.some((source) => source.label.endsWith(article)),
        `${entry.term} names ${article} with nothing to check it against`,
      );
    }
    // Held to the censor a model's sentences pass, like every written line here.
    const checked = validateGroundedAnalysis({ overview: [entry.text] }, new Set());
    assert.deepEqual(checked.dropped, [], `${entry.term} would be censored`);
    assert.equal(checked.overview.length, 1, `${entry.term} was dropped for length`);
  }
});

test("marks a term once, and the longer of two that overlap", () => {
  const said = (text) => glossTokens(text).map((token) => (token.entry ? `[${token.entry.term}]` : token.text)).join("");

  // 등록 lives inside 신상정보 등록, and the longer reading is the useful one.
  assert.equal(said("신상정보 등록대상자"), "[신상정보 등록]대상자");

  // A paragraph that says 송치 four times does not need four buttons in it.
  const repeated = glossTokens("송치 여부를 정합니다. 송치되면 검사가, 송치되지 않으면 경찰이 끝냅니다.");
  assert.equal(repeated.filter((token) => token.entry?.term === "송치").length, 1);

  // Nothing to explain comes back as the line itself.
  assert.deepEqual(glossTokens("어제 다투다가 심한 말을 들었습니다."), [{ text: "어제 다투다가 심한 말을 들었습니다." }]);
  assert.deepEqual(glossTokens(""), []);
});
