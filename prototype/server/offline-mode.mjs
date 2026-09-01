import { readFile } from "node:fs/promises";

/**
 * Serves a captured model response instead of calling one.
 *
 * Working on the screens means loading the result page over and over, and every
 * one of those loads was an analysis call and sometimes a web search. That is a
 * bad reason to spend money, and a worse reason to hesitate before trying a
 * layout.
 *
 * The fixture is a real response this service received, not invented prose, so
 * sentence lengths and tone match what the screen has to hold. Only the
 * generated half is frozen: the statute comes from the database and the four
 * verdicts from the rules on every request, exactly as in production.
 */
export function isOfflineMode(env = process.env) {
  return env.OFFLINE_MODE === "true";
}

let cached = null;

export async function readAnalysisFixture() {
  if (!cached) {
    cached = JSON.parse(await readFile(new URL("./fixtures/analysis-sample.json", import.meta.url), "utf8"));
  }
  return cached;
}

/**
 * A stand-in analysis for whatever precedents this search actually returned.
 *
 * The citations are re-pointed at the real case numbers rather than the ones
 * the fixture was recorded with, so the same grounding check that guards a live
 * response passes here too. A fixture that failed that check would send anyone
 * working on the screens chasing a bug that only exists offline.
 */
export function buildFixtureAnalysis(fixture, caseNumbers = []) {
  const texts = fixture.precedentNoteTexts || [];
  return {
    overview: fixture.overview || [],
    elementNotes: fixture.elementNotes || [],
    precedentNotes: caseNumbers.slice(0, texts.length).map((caseNumber, index) => ({
      caseNumber,
      text: texts[index],
    })),
    nextSteps: fixture.nextSteps || [],
  };
}
