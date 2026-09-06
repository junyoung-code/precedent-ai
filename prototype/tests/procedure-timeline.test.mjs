import assert from "node:assert/strict";
import test from "node:test";
import { validateGroundedAnalysis } from "../server/grounded-analysis.mjs";
import { INTAKE_ROLES } from "../server/intake-questions.mjs";
import {
  PROCEDURE_CAUTION,
  PROCEDURE_STAGES,
  procedureStages,
} from "../src/lib/procedure-timeline.js";

const ARTICLE = /제\d+조(?:의\d+)?/g;
const everyStage = () => Object.entries(PROCEDURE_STAGES)
  .flatMap(([role, stages]) => stages.map((stage) => ({ role, stage })));

test("holds the written procedure to the censor a model's sentences pass", () => {
  // The same bar, applied to copy we wrote ourselves. A procedure told as
  // advice about this reader's case is the thing this panel may not become,
  // and that boundary is not a matter of taste — it is what keeps a paid
  // service on the right side of 변호사법 제109조.
  for (const { role, stage } of everyStage()) {
    const checked = validateGroundedAnalysis({ overview: [stage.title, stage.body] }, new Set());
    assert.deepEqual(checked.dropped, [], `${role}/${stage.id} would be censored`);
    // Two back, so nothing was quietly dropped for being over the length cap.
    assert.equal(checked.overview.length, 2, `${role}/${stage.id} lost a line`);
  }

  const caution = validateGroundedAnalysis({ overview: [PROCEDURE_CAUTION] }, new Set());
  assert.deepEqual(caution.dropped, []);
  assert.equal(caution.overview.length, 1);
});

test("walks each side from where that side actually starts", () => {
  assert.deepEqual(Object.keys(PROCEDURE_STAGES).sort(), [...INTAKE_ROLES].sort());

  for (const role of INTAKE_ROLES) {
    const stages = procedureStages(role);
    assert.ok(stages.length > 0, role);
    for (const stage of stages) {
      assert.ok(stage.id && stage.title.trim() && stage.body.trim(), `${role} has an empty stage`);
    }
    assert.equal(new Set(stages.map((stage) => stage.id)).size, stages.length, `${role} repeats a stage id`);
  }

  // A 고소인 files and waits to be told; a 피고소인 is told to appear. Reading
  // one from the other's position is the 상대방 confusion this product has had
  // to remove twice already.
  const [victimStart] = procedureStages("victim");
  const [reportedStart] = procedureStages("reported");
  assert.notEqual(victimStart.id, reportedStart.id);
  assert.notEqual(victimStart.title, reportedStart.title);
});

test("links every article it names, and names none it cannot link", () => {
  for (const { role, stage } of everyStage()) {
    for (const item of stage.sources) {
      // The same rule mapStatute applies before a quoted article reaches a
      // screen: no official link, no citation.
      assert.ok(
        item.url.startsWith("https://www.law.go.kr/"),
        `${role}/${stage.id} cites ${item.label} without an official link`,
      );
      assert.ok(item.label.trim(), `${role}/${stage.id} has a link with no name`);
    }

    const labels = stage.sources.map((item) => item.label);
    for (const article of stage.body.match(ARTICLE) || []) {
      assert.ok(
        labels.some((label) => label.endsWith(article)),
        `${role}/${stage.id} names ${article} with nothing to check it against`,
      );
    }
  }
});

test("describes the procedure without advising on the case", () => {
  const spoken = [PROCEDURE_CAUTION, ...everyStage().flatMap(({ stage }) => [stage.title, stage.body])].join(" ");
  // 변호사 and 합의금 are the two the gallery talks about most and the two this
  // may not touch: recommending counsel or quoting a settlement range for money
  // is legal advice, whatever it is called.
  for (const banned of ["변호사", "합의금", "확률", "예상 형량", "승소", "패소", "하시는 것이 좋습니다"]) {
    assert.equal(spoken.includes(banned), false, `banned procedure copy: ${banned}`);
  }
  assert.match(PROCEDURE_CAUTION, /결과나 대응 방법을 알려드리는 것이 아닙니다/);
});

test("shows nothing when it does not know which side to tell it from", () => {
  // A procedure told from the wrong position is worse than none: it tells a
  // reader waiting for a notice that they should be filing.
  for (const role of [null, undefined, "", "nobody", "victim ", "VICTIM"]) {
    assert.equal(procedureStages(role), null, JSON.stringify(role));
  }
});
