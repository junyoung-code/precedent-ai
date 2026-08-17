import { extractFactTags } from "../src/lib/fact-tags.js";
import { selectCommunicationObscenityParagraphs } from "./precedent-scope.mjs";

const UPSERT_SQL = `INSERT INTO precedent_fact_tags
  (precedent_id, extraction_version, medium, message_form, recipient_identification,
   reached_recipient, relationship, context, expression_type, repetition,
   additional_channels, issue_tags, evidence, extracted_at)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
 ON CONFLICT (precedent_id) DO UPDATE SET
   extraction_version = EXCLUDED.extraction_version,
   medium = EXCLUDED.medium,
   message_form = EXCLUDED.message_form,
   recipient_identification = EXCLUDED.recipient_identification,
   reached_recipient = EXCLUDED.reached_recipient,
   relationship = EXCLUDED.relationship,
   context = EXCLUDED.context,
   expression_type = EXCLUDED.expression_type,
   repetition = EXCLUDED.repetition,
   additional_channels = EXCLUDED.additional_channels,
   issue_tags = EXCLUDED.issue_tags,
   evidence = EXCLUDED.evidence,
   extracted_at = now()`;

const FACT_FIELDS = [
  "medium",
  "messageForm",
  "recipientIdentification",
  "reachedRecipient",
  "relationship",
  "context",
  "expressionType",
  "repetition",
];

export function isStatutoryEnumeration(text) {
  const compact = String(text || "").normalize("NFKC").replace(/\s+/g, "");
  const listedForms = ["말", "음향", "글", "그림", "영상", "물건"]
    .filter((term) => compact.includes(term)).length;
  const legalContext = compact.includes("제13조")
    || compact.includes("여기서통신매체")
    || compact.includes("처벌하고있다");
  return legalContext && listedForms >= 4;
}

function buildEvidence(facts, paragraphs) {
  return {
    method: "deterministic_rules",
    knownFields: FACT_FIELDS.filter((field) => !["unknown", "other"].includes(facts[field])),
    paragraphIds: paragraphs.map((paragraph) => paragraph.paragraphId),
  };
}

export async function upsertPrecedentFactTags({ connection, precedentId, paragraphs }) {
  const selectedParagraphs = selectCommunicationObscenityParagraphs(paragraphs);
  const factParagraphs = selectedParagraphs.filter((paragraph) => !isStatutoryEnumeration(paragraph.text));
  const facts = extractFactTags(factParagraphs.map((paragraph) => paragraph.text).join("\n"));
  await connection.query(UPSERT_SQL, [
    precedentId,
    facts.extractionVersion,
    facts.medium,
    facts.messageForm,
    facts.recipientIdentification,
    facts.reachedRecipient,
    facts.relationship,
    facts.context,
    facts.expressionType,
    facts.repetition,
    facts.additionalChannels,
    facts.issueTags,
    buildEvidence(facts, factParagraphs),
  ]);
  return facts;
}

export async function backfillPrecedentFactTags({ pool, limit = 1000 }) {
  const result = await pool.query(
    `SELECT
       p.id,
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
     JOIN precedent_paragraphs pp ON pp.precedent_id = p.id
     WHERE p.verified_at IS NOT NULL
       AND p.searchable = true
     GROUP BY p.id
     ORDER BY max(p.decision_date) DESC, p.id
     LIMIT $1`,
    [limit],
  );
  const connection = await pool.connect();

  try {
    await connection.query("BEGIN");
    for (const record of result.rows) {
      await upsertPrecedentFactTags({
        connection,
        precedentId: record.id,
        paragraphs: record.paragraphs,
      });
    }
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }

  return { selected: result.rows.length, tagged: result.rows.length };
}
