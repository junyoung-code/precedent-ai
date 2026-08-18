export const DISPOSITION_EXTRACTION_VERSION = "order-v1";

const HEADING = /^【[^】]*】/u;
const ORDER_HEADING = /^【\s*주\s*문\s*】/u;
const MAX_ORDER_LENGTH = 1_200;

// Every marker below is matched against the court's own order, never against a
// user's description. The families decide the label; the order text is what the
// reader actually sees.
const CIVIL = /원고/u;
const REMAND = /(환송|이송)한다/u;
const REVERSED = /파기/u;
const FINAL_APPEAL_DISMISSED = /상고를?\s*(모두\s*)?기각/u;
const APPEAL_DISMISSED = /항소를?\s*(모두\s*)?기각/u;
const PROSECUTION_DISMISSED = /공소를?\s*(모두\s*)?기각/u;
const ACQUITTED = /무죄/u;
const SENTENCED = /(징역|금고|벌금|구류|과료|몰수|추징)/u;

function compact(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * Pulls the 주문 section out of a judgment: the paragraphs between the 【주 문】
 * heading and whatever heading comes next.
 */
export function extractDisposition(paragraphs) {
  const ordered = (paragraphs || [])
    .map((paragraph) => ({
      paragraphId: typeof paragraph?.paragraphId === "string" ? paragraph.paragraphId : "",
      ordinal: Number(paragraph?.ordinal) || 0,
      text: compact(paragraph?.body ?? paragraph?.text),
    }))
    .filter((paragraph) => paragraph.paragraphId && paragraph.text)
    .sort((left, right) => left.ordinal - right.ordinal);

  const start = ordered.findIndex((paragraph) => ORDER_HEADING.test(paragraph.text));
  if (start < 0) return null;

  const parts = [];
  const inline = ordered[start].text.replace(ORDER_HEADING, "").trim();
  if (inline) parts.push({ paragraphId: ordered[start].paragraphId, text: inline });
  for (let index = start + 1; index < ordered.length; index += 1) {
    if (HEADING.test(ordered[index].text)) break;
    parts.push(ordered[index]);
  }
  if (parts.length === 0) return null;

  const orderText = parts.map((part) => part.text).join(" ");
  if (orderText.length > MAX_ORDER_LENGTH) return null;

  return {
    orderText,
    paragraphIds: parts.map((part) => part.paragraphId),
    kind: classifyDisposition(orderText),
    extractionVersion: DISPOSITION_EXTRACTION_VERSION,
  };
}

/**
 * Labels what kind of order this is. An order that carries several different
 * decisions at once falls through to "multiple", where the reader is sent to the
 * quoted text rather than given a one-line reading of it.
 */
export function classifyDisposition(orderText) {
  const text = compact(orderText);
  if (!text) return "other";
  if (CIVIL.test(text)) return "civil";

  const families = [
    REMAND.test(text),
    FINAL_APPEAL_DISMISSED.test(text) || APPEAL_DISMISSED.test(text),
    PROSECUTION_DISMISSED.test(text),
    ACQUITTED.test(text),
    SENTENCED.test(text),
  ].filter(Boolean).length;
  if (families > 1) return "multiple";

  if (REMAND.test(text)) return "remand";
  if (FINAL_APPEAL_DISMISSED.test(text)) return "final_appeal_dismissed";
  if (APPEAL_DISMISSED.test(text)) return "appeal_dismissed";
  if (ACQUITTED.test(text)) return "acquitted";
  if (SENTENCED.test(text)) return REVERSED.test(text) ? "reversed_and_sentenced" : "sentenced";
  return "other";
}

const UPSERT_SQL = `INSERT INTO precedent_dispositions
  (precedent_id, extraction_version, order_text, paragraph_ids, kind, extracted_at)
 VALUES ($1, $2, $3, $4, $5, now())
 ON CONFLICT (precedent_id) DO UPDATE SET
   extraction_version = EXCLUDED.extraction_version,
   order_text = EXCLUDED.order_text,
   paragraph_ids = EXCLUDED.paragraph_ids,
   kind = EXCLUDED.kind,
   extracted_at = now()`;

export async function upsertPrecedentDisposition({ connection, precedentId, paragraphs }) {
  const disposition = extractDisposition(paragraphs);
  if (!disposition) {
    await connection.query("DELETE FROM precedent_dispositions WHERE precedent_id = $1", [precedentId]);
    return null;
  }
  await connection.query(UPSERT_SQL, [
    precedentId,
    disposition.extractionVersion,
    disposition.orderText,
    disposition.paragraphIds,
    disposition.kind,
  ]);
  return disposition;
}
