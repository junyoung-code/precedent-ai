import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSearchQuality } from "../server/search-quality-evaluator.mjs";

test("reports ranking, forbidden exposure, empty accuracy, and failures", async () => {
  const cases = [
    { query: "top", expectedTopCaseNumbers: ["A"], forbiddenTopCaseNumbers: ["X"], expectEmpty: false },
    { query: "miss", expectedTopCaseNumbers: ["B"], forbiddenTopCaseNumbers: ["X"], expectEmpty: false },
    { query: "empty", expectedTopCaseNumbers: [], forbiddenTopCaseNumbers: ["X"], expectEmpty: true },
  ];
  const results = {
    top: [{ caseNumber: "A" }],
    miss: [{ caseNumber: "X" }, { caseNumber: "B" }],
    empty: [],
  };
  const report = await evaluateSearchQuality({
    cases,
    search: async ({ query }) => ({ results: results[query] }),
  });

  assert.equal(report.caseCount, 3);
  assert.equal(report.top1Accuracy, 50);
  assert.equal(report.top3Recall, 100);
  assert.equal(report.forbiddenExposureRate, 33.33);
  assert.equal(report.emptyAccuracy, 100);
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0].query, "miss");
});
