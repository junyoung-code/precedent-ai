import pg from "pg";
import { selectSummaryParagraphs, SUMMARY_VERSION } from "../server/precedent-summaries.mjs";
import { isFocusedCommunicationObscenity } from "../server/precedent-scope.mjs";
import { DEFAULT_SUMMARY_MODEL } from "../server/summary-client.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const result = await pool.query(
    `SELECT
       p.id,
       p.case_name AS "caseName",
       COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'paragraphId', pp.paragraph_id,
             'ordinal', pp.ordinal,
             'body', pp.body
           ) ORDER BY pp.ordinal
         ) FILTER (WHERE pp.paragraph_id IS NOT NULL),
         '[]'::jsonb
       ) AS paragraphs
     FROM precedents p
     JOIN source_rights r
       ON r.provider = p.provider
      AND r.summary_allowed = true
      AND r.display_allowed = true
     JOIN precedent_paragraphs pp ON pp.precedent_id = p.id
     WHERE p.searchable = true
       AND p.case_name ILIKE '%통신매체이용음란%'
       AND p.verified_at IS NOT NULL
       AND p.link_status BETWEEN 200 AND 399
     GROUP BY p.id, p.case_name
     ORDER BY max(p.decision_date) DESC, p.id`,
  );

  let eligible = 0;
  let totalCharacters = 0;
  for (const record of result.rows) {
    if (!isFocusedCommunicationObscenity(record.caseName)) continue;
    const paragraphs = selectSummaryParagraphs(record.paragraphs);
    if (paragraphs.length === 0) continue;
    eligible += 1;
    totalCharacters += paragraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0);
  }

  console.log(JSON.stringify({
    selected: result.rows.length,
    eligible,
    ineligible: result.rows.length - eligible,
    totalCharacters,
    model: process.env.SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL,
    version: SUMMARY_VERSION,
    externalApiCalled: false,
  }, null, 2));
} finally {
  await pool.end();
}
