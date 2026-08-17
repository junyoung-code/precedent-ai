function percent(numerator, denominator) {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

export async function evaluateSearchQuality({ cases, search } = {}) {
  const evaluationCases = Array.isArray(cases) ? cases : [];
  if (typeof search !== "function") throw new TypeError("search must be a function");

  let top1Hits = 0;
  let top3Hits = 0;
  let forbiddenExposures = 0;
  let emptyHits = 0;
  let rankedCaseCount = 0;
  let emptyCaseCount = 0;
  const failures = [];

  for (const item of evaluationCases) {
    const response = await search({ query: item.query, limit: 3, embeddingClient: null });
    const caseNumbers = (response?.results || []).slice(0, 3).map((result) => result.caseNumber);
    const forbidden = (item.forbiddenTopCaseNumbers || []).filter((value) => caseNumbers.includes(value));
    if (forbidden.length > 0) forbiddenExposures += 1;

    if (item.expectEmpty) {
      emptyCaseCount += 1;
      if (caseNumbers.length === 0) emptyHits += 1;
      if (caseNumbers.length > 0 || forbidden.length > 0) {
        failures.push({ query: item.query, reason: "EXPECTED_EMPTY", actual: caseNumbers, forbidden });
      }
      continue;
    }

    rankedCaseCount += 1;
    const expected = item.expectedTopCaseNumbers || [];
    const top1Hit = caseNumbers.length > 0 && expected.includes(caseNumbers[0]);
    const top3Hit = caseNumbers.some((value) => expected.includes(value));
    if (top1Hit) top1Hits += 1;
    if (top3Hit) top3Hits += 1;
    if (!top1Hit || !top3Hit || forbidden.length > 0) {
      failures.push({ query: item.query, reason: "RANKING_MISMATCH", actual: caseNumbers, expected, forbidden });
    }
  }

  return {
    caseCount: evaluationCases.length,
    top1Accuracy: percent(top1Hits, rankedCaseCount),
    top3Recall: percent(top3Hits, rankedCaseCount),
    forbiddenExposureRate: percent(forbiddenExposures, evaluationCases.length),
    emptyAccuracy: percent(emptyHits, emptyCaseCount),
    failures,
  };
}
