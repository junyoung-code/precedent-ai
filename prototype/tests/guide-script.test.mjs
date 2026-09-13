import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateGroundedAnalysis } from "../server/grounded-analysis.mjs";
import { buildIntakeQuestions } from "../server/intake-questions.mjs";
import { ARTICLE_13_ELEMENTS, mapFactsToArticle13 } from "../server/statute-elements.mjs";
import { validateWebCases } from "../server/web-cases.mjs";
import { extractFactTags } from "../src/lib/fact-tags.js";
import { VERIFIED_PRECEDENTS } from "../src/lib/precedents.js";
import {
  GUIDE_ANALYSIS,
  GUIDE_ANSWER_LENGTH,
  GUIDE_ANSWER_ORDER,
  GUIDE_ELEMENTS,
  GUIDE_EXAMPLES,
  GUIDE_INTAKE_ANSWERS,
  GUIDE_INTAKE_QUESTIONS,
  GUIDE_STATUTE,
  GUIDE_STEPS,
  GUIDE_WEB_CASES,
  guideResults,
  sliceGuideAnswers,
} from "../src/lib/guide-script.js";

// The composer refuses anything shorter, so an example the tour types out has
// to be one the real screen would have accepted.
const MINIMUM_DESCRIPTION = 15;
const MAXIMUM_DESCRIPTION = 2000;

const plain = (value) => JSON.parse(JSON.stringify(value));

test("both examples are inputs the real composer would accept", () => {
  for (const [name, example] of Object.entries(GUIDE_EXAMPLES)) {
    const length = example.description.trim().length;
    assert.ok(length >= MINIMUM_DESCRIPTION, `${name} is ${length} characters, under the ${MINIMUM_DESCRIPTION} minimum`);
    assert.ok(length <= MAXIMUM_DESCRIPTION, `${name} is ${length} characters, over the cap`);
    assert.ok(["victim", "reported"].includes(example.role), `${name} needs a side`);
  }
});

test("the thorough example leaves the intake nothing to ask", () => {
  const facts = extractFactTags(GUIDE_EXAMPLES.thorough.description);

  // The six fields the intake can ask about are all readable from this one
  // sentence. That is the whole point the first half of the tour is making.
  assert.equal(facts.medium, "game_chat");
  assert.equal(facts.expressionType, "insult_with_sexual_terms");
  assert.equal(facts.relationship, "game_user");
  assert.equal(facts.repetition, "repeated");
  assert.equal(facts.reachedRecipient, "yes");
  assert.equal(facts.recipientIdentification, "direct_account");

  assert.deepEqual(buildIntakeQuestions(facts, { role: GUIDE_EXAMPLES.thorough.role }), []);
});

test("the sparse example asks exactly the three questions the tour shows", () => {
  const facts = extractFactTags(GUIDE_EXAMPLES.sparse.description);

  // Read: enough to search with. Unread: the three the panel fills up with.
  assert.equal(facts.medium, "kakao");
  assert.equal(facts.expressionType, "sexual_text");
  assert.equal(facts.relationship, "unknown");
  assert.equal(facts.repetition, "unknown");
  assert.equal(facts.reachedRecipient, "unknown");

  const asked = buildIntakeQuestions(facts, { role: GUIDE_EXAMPLES.sparse.role });

  // Three is the cap, which is what makes this example worth showing.
  assert.equal(asked.length, 3);
  assert.deepEqual(
    asked.map((question) => ({ id: question.id, prompt: question.prompt, hint: question.hint })),
    GUIDE_INTAKE_QUESTIONS.map((question) => ({ id: question.id, prompt: question.prompt, hint: question.hint })),
    "the tour is showing questions the server would not actually ask",
  );
});

test("every question the tour shows has an answer to type into it", () => {
  assert.deepEqual(GUIDE_ANSWER_ORDER, GUIDE_INTAKE_QUESTIONS.map((question) => question.id));
  for (const id of GUIDE_ANSWER_ORDER) {
    assert.ok(GUIDE_INTAKE_ANSWERS[id]?.trim(), `no example answer for ${id}`);
  }
  assert.equal(
    GUIDE_ANSWER_LENGTH,
    GUIDE_ANSWER_ORDER.reduce((total, id) => total + GUIDE_INTAKE_ANSWERS[id].length, 0),
  );
});

test("answers fill one box at a time and end complete", () => {
  assert.deepEqual(sliceGuideAnswers(0), { reachedRecipient: "", relationship: "", repetition: "" });

  // Part way through the first answer, the later boxes are still empty.
  const early = sliceGuideAnswers(3);
  assert.equal(early.reachedRecipient, GUIDE_INTAKE_ANSWERS.reachedRecipient.slice(0, 3));
  assert.equal(early.relationship, "");
  assert.equal(early.repetition, "");

  assert.deepEqual(sliceGuideAnswers(GUIDE_ANSWER_LENGTH), { ...GUIDE_INTAKE_ANSWERS });
  // Overrunning the total must not spill into a longer string.
  assert.deepEqual(sliceGuideAnswers(GUIDE_ANSWER_LENGTH + 50), { ...GUIDE_INTAKE_ANSWERS });
});

test("the example result cites real precedents, not invented ones", () => {
  const results = guideResults();
  assert.ok(results.length > 0, "the thorough example must find something to explain");

  const known = new Map(VERIFIED_PRECEDENTS.map((precedent) => [precedent.caseNumber, precedent]));
  for (const result of results) {
    const precedent = known.get(result.caseNumber);
    assert.ok(precedent, `${result.caseNumber} is not a verified precedent`);
    assert.equal(result.officialUrl, precedent.officialUrl);
    assert.equal(result.court, precedent.court);
    // The same floor the real search applies, so the tour never shows a card
    // the product itself would have withheld.
    assert.ok(result.similarity.total >= 55, `${result.caseNumber} scored ${result.similarity.total}`);
  }
});

test("the card the tour points at has every part its steps describe", () => {
  const [top] = guideResults();
  assert.ok(top.similarity.total > 0);
  assert.ok(top.similarities.length > 0, "the 닮은 점 step would point at an empty panel");
  assert.ok(top.differences.length > 0, "the 다른 점 step would point at an empty panel");
  assert.ok(top.summary.length > 0, "the summary step would point at an empty panel");
  // Every summary sentence carries where it came from — the step says so.
  for (const sentence of top.summary) assert.ok(sentence.sourceAnchor, "a summary sentence with no anchor");
});

test("the article on the guide screen is the article the product reads", () => {
  // The four clauses the rules quote, joined back together. If the statute text
  // here drifted from statute-elements.mjs the tour would be quoting a law the
  // rest of the product does not use.
  for (const element of ARTICLE_13_ELEMENTS) {
    assert.ok(
      GUIDE_STATUTE.body.includes(element.statuteQuote),
      `the quoted article is missing the ${element.id} clause`,
    );
  }
  // The screen shows it as a quotation, so it ships with its source.
  assert.ok(GUIDE_STATUTE.officialUrl.startsWith("https://www.law.go.kr/"));
  assert.match(GUIDE_STATUTE.enforcedOn, /^\d{4}-\d{2}-\d{2}$/);
});

test("the four verdicts are the ones the rules produce, not ones written here", () => {
  const facts = extractFactTags(GUIDE_EXAMPLES.thorough.description);
  // Read from the side the example is written from, the way the product reads
  // it: the arrival line names the reader or the other party depending on which
  // of them received the messages.
  assert.deepEqual(
    plain(GUIDE_ELEMENTS),
    plain(mapFactsToArticle13(facts, { role: GUIDE_EXAMPLES.thorough.role })),
  );

  // Reading, not deciding: one element is unclear, and the step says why that
  // is the honest answer rather than a gap.
  assert.deepEqual(
    GUIDE_ELEMENTS.map((element) => element.mention),
    ["unclear", "present", "present", "present"],
  );
});

test("the example analysis survives the censor a real model answer passes through", () => {
  const allowed = new Set(guideResults().map((result) => result.caseNumber));
  const checked = validateGroundedAnalysis(plain(GUIDE_ANALYSIS), allowed);

  // Nothing dropped means no sentence here decides the reader's case — the same
  // bar the live pipeline holds a model to.
  assert.deepEqual(checked.dropped, [], `the guide analysis would be censored: ${checked.dropped.join(", ")}`);
  assert.deepEqual(checked.overview, plain(GUIDE_ANALYSIS.overview));
  assert.deepEqual(checked.elementNotes, plain(GUIDE_ANALYSIS.elementNotes));
  assert.deepEqual(checked.precedentNotes, plain(GUIDE_ANALYSIS.precedentNotes));
  assert.deepEqual(checked.nextSteps, plain(GUIDE_ANALYSIS.nextSteps));

  // A note may only be attached to a case the tour actually shows.
  for (const note of GUIDE_ANALYSIS.precedentNotes) assert.ok(allowed.has(note.caseNumber), note.caseNumber);
  // And a note may only be attached to an element the article has.
  const ids = new Set(ARTICLE_13_ELEMENTS.map((element) => element.id));
  for (const note of GUIDE_ANALYSIS.elementNotes) assert.ok(ids.has(note.id), note.id);
});

test("the example web post is one the real validator keeps", () => {
  const { cases } = validateWebCases(plain(GUIDE_WEB_CASES));
  assert.equal(cases.length, GUIDE_WEB_CASES.length, "the guide is showing a post the product would have dropped");
  assert.equal(cases[0].url, GUIDE_WEB_CASES[0].url);
  // The panel's own warning says each address was checked. One real post beats
  // padding the list out with URLs nobody has verified.
  for (const item of GUIDE_WEB_CASES) assert.match(item.url, /^https:\/\//);
});

/**
 * Counted from the deck itself rather than written down here.
 *
 * The tour drives the real result deck, so "the tour reaches every screen" is a
 * claim about a number that lives in App.jsx. Written as a literal it went
 * stale the moment a fourth screen was added — the guard did not catch the gap,
 * it just failed and had to be edited to agree with the change.
 */
const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const SCREENS = [...appSource
  .slice(appSource.indexOf("const RESULT_SCREENS = ["), appSource.indexOf("];", appSource.indexOf("const RESULT_SCREENS = [")))
  .matchAll(/^\s*\{ id: "/gm)]
  .map((match, index) => index);

test("counts the result screens off the deck the tour actually drives", () => {
  assert.ok(SCREENS.length >= 3, `RESULT_SCREENS 를 읽지 못했습니다 (${SCREENS.length}개)`);
});

test("every step can be played and lit", () => {
  const ids = new Set();

  for (const step of GUIDE_STEPS) {
    assert.ok(step.id && !ids.has(step.id), `duplicate or missing step id: ${step.id}`);
    ids.add(step.id);
    assert.ok(step.title?.trim(), `${step.id} has no title`);
    assert.ok(step.body?.trim(), `${step.id} has no explanation`);
    assert.ok(["composer", "results"].includes(step.scene), `${step.id} has no scene`);

    // null lights nothing and shows the screen whole, which is how the tour opens.
    if (step.target !== null) {
      const targets = Array.isArray(step.target) ? step.target : [step.target];
      assert.ok(targets.length > 0 && targets.every((selector) => typeof selector === "string" && selector.trim()),
        `${step.id} has nothing to light up`);
    }

    if (step.scene === "composer") assert.ok(GUIDE_EXAMPLES[step.example], `${step.id} names no example`);
    if (step.results === "deck") assert.ok(SCREENS.includes(step.deck), `${step.id} opens no result screen`);
  }

  // The tour opens on the whole screen before it starts pointing at parts of it.
  assert.equal(GUIDE_STEPS[0].target, null);
  // And it walks the result deck forwards, never back.
  const decks = GUIDE_STEPS.filter((step) => step.results === "deck").map((step) => step.deck);
  assert.deepEqual(decks, [...decks].sort((a, b) => a - b));
  assert.deepEqual([...new Set(decks)], SCREENS,
    `the tour must reach all ${SCREENS.length} result screens`);
});

test("the tour does not promise a legal outcome", () => {
  const spoken = GUIDE_STEPS.map((step) => `${step.title} ${step.body}`).join(" ");
  for (const banned of ["성립 확률", "고소 확률", "유죄 확률", "무죄 가능성", "처벌 예상", "예상 형량"]) {
    assert.equal(spoken.includes(banned), false, `banned guide copy: ${banned}`);
  }
  // The number is explained as what it is, in the same words the result screen uses.
  assert.match(spoken, /사실관계가 얼마나 닮았는지/);
  assert.match(spoken, /법적인 결론이나 형량과는 관계가 없습니다/);
  // And the generated half is named as generated wherever the tour shows it.
  assert.match(spoken, /AI가 쓴 설명/);
  assert.match(spoken, /판단의 근거로는 삼지 마세요/);
});
