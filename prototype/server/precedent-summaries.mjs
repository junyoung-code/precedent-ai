import { validateGroundedSummary } from "./grounded-summary.mjs";
import {
  isFocusedCommunicationObscenity,
  selectCommunicationObscenityParagraphs,
} from "./precedent-scope.mjs";
import { DEFAULT_SUMMARY_MODEL } from "./summary-client.mjs";

export const SUMMARY_VERSION = "grounded-v2";
export const MAX_SUMMARY_INPUT_CHARS = 40_000;

function backfillError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function selectSummaryParagraphs(paragraphs, maxChars = MAX_SUMMARY_INPUT_CHARS) {
  return selectCommunicationObscenityParagraphs(paragraphs, {
    minParagraphs: 3,
    maxChars,
  }).map(({ paragraphId, text }) => ({ paragraphId, text }));
}

export async function backfillPrecedentSummaries({ pool, summaryClient, limit = 100 } = {}) {
  if (!pool) throw backfillError("DATABASE_POOL_REQUIRED", "DB 연결이 필요합니다.");
  if (!summaryClient) throw backfillError("SUMMARY_CLIENT_REQUIRED", "요약 클라이언트가 필요합니다.");
  const model = summaryClient.model || DEFAULT_SUMMARY_MODEL;
  const records = await pool.query(
    `SELECT
       p.id,
       p.case_name AS "caseName",
       p.source_hash AS "sourceHash",
       s.source_hash AS "summarySourceHash",
       s.summary_version AS "summaryVersion",
       s.model AS "summaryModel",
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
     LEFT JOIN precedent_summaries s ON s.precedent_id = p.id
     WHERE p.searchable = true
       AND p.case_name ILIKE '%통신매체이용음란%'
       AND p.verified_at IS NOT NULL
       AND p.link_status BETWEEN 200 AND 399
     GROUP BY p.id, p.case_name, p.source_hash, s.source_hash, s.summary_version, s.model
     ORDER BY p.decision_date DESC, p.id
     LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 1000)],
  );

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  for (const record of records.rows) {
    if (!isFocusedCommunicationObscenity(record.caseName)) {
      skipped += 1;
      continue;
    }
    if (record.summarySourceHash === record.sourceHash
      && record.summaryVersion === SUMMARY_VERSION
      && record.summaryModel === model) {
      skipped += 1;
      continue;
    }

    try {
      const paragraphs = selectSummaryParagraphs(record.paragraphs);
      if (paragraphs.length === 0) throw backfillError("SUMMARY_INPUT_REQUIRED", "검증 문단이 없습니다.");
      const payload = await summaryClient.summarize({ paragraphs });
      const sentences = validateGroundedSummary(payload, new Set(paragraphs.map((item) => item.paragraphId)));
      await pool.query(
        `INSERT INTO precedent_summaries
           (precedent_id, source_hash, summary_version, model, sentences, generated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, now())
         ON CONFLICT (precedent_id) DO UPDATE SET
           source_hash = EXCLUDED.source_hash,
           summary_version = EXCLUDED.summary_version,
           model = EXCLUDED.model,
           sentences = EXCLUDED.sentences,
           generated_at = EXCLUDED.generated_at`,
        [record.id, record.sourceHash, SUMMARY_VERSION, model, JSON.stringify(sentences)],
      );
      generated += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    selected: records.rows.length,
    generated,
    skipped,
    failed,
    model,
    version: SUMMARY_VERSION,
  };
}
