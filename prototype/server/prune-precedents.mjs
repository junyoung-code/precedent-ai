import { isCommunicationObscenityCaseName } from "./precedent-scope.mjs";

/**
 * Picks the stored records the search can never return.
 *
 * These are what a full-text collection leaves behind: judgments that merely
 * cite the offence somewhere in their text. They cost an embedding each and
 * inflate every count, while `case_name ILIKE '%통신매체이용음란%'` keeps them out
 * of every result.
 */
export function selectUnrelatedPrecedents(rows, isRelevant = isCommunicationObscenityCaseName) {
  return (rows || []).filter((row) => !isRelevant(row.caseName));
}

export async function pruneUnrelatedPrecedents({ pool, confirm = false, isRelevant }) {
  const stored = await pool.query(
    `SELECT id, court, case_number AS "caseNumber", case_name AS "caseName"
     FROM precedents
     ORDER BY decision_date DESC, id`,
  );
  const unrelated = selectUnrelatedPrecedents(stored.rows, isRelevant);
  const summary = {
    stored: stored.rows.length,
    unrelated: unrelated.length,
    deleted: 0,
    confirmed: confirm === true,
    records: unrelated.map((row) => ({ court: row.court, caseNumber: row.caseNumber, caseName: row.caseName })),
  };
  if (!summary.confirmed || unrelated.length === 0) return summary;

  // Every derived table references precedents with ON DELETE CASCADE, so the
  // paragraphs, fact tags, summaries and dispositions go with the parent row.
  const result = await pool.query(
    "DELETE FROM precedents WHERE id = ANY($1::uuid[])",
    [unrelated.map((row) => row.id)],
  );
  summary.deleted = result.rowCount;
  return summary;
}
