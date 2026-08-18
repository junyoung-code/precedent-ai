import { createHash } from "node:crypto";
import { upsertPrecedentFactTags } from "./precedent-fact-tags.mjs";

export const ALLOWED_OFFICIAL_HOSTS = new Set([
  "law.go.kr",
  "www.law.go.kr",
  "open.law.go.kr",
  "scourt.go.kr",
  "www.scourt.go.kr",
]);

function isOfficialUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_OFFICIAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function validatePrecedentRecord(record) {
  const required = ["court", "case_number", "decision_date", "official_url", "source_text", "source_hash"];
  if (required.some((field) => !record[field])) return { valid: false, errorCode: "SOURCE_METADATA_MISSING" };
  if (!isOfficialUrl(record.official_url)) return { valid: false, errorCode: "SOURCE_URL_INVALID" };
  const actualHash = createHash("sha256").update(record.source_text).digest("hex");
  if (actualHash !== record.source_hash) return { valid: false, errorCode: "SOURCE_HASH_MISMATCH" };
  return { valid: true, errorCode: null };
}

export function splitParagraphs(sourceText) {
  return String(sourceText || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .split(/\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function canBecomeSearchable({ localValid, paragraphCount, linkStatus, rights }) {
  return Boolean(
    localValid
      && paragraphCount > 0
      && linkStatus >= 200
      && linkStatus <= 399
      && rights?.storage_allowed
      && rights?.indexing_allowed
      && rights?.summary_allowed
      && rights?.display_allowed,
  );
}

export async function checkOfficialLink(url, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  if (!isOfficialUrl(url)) return 0;
  try {
    let response = await fetchImpl(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (!(response.status >= 200 && response.status <= 399)) {
      response = await fetchImpl(url, { method: "GET", headers: { Range: "bytes=0-0" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    }
    if (response.url && !isOfficialUrl(response.url)) return 0;
    return response.status;
  } catch {
    return 0;
  }
}

export async function verifyPrecedents({ pool, fetchImpl = fetch, limit = 100 }) {
  const result = await pool.query(
    `SELECT p.*,
       r.storage_allowed, r.indexing_allowed, r.summary_allowed, r.display_allowed
     FROM precedents p
     LEFT JOIN source_rights r ON r.provider = p.provider
     ORDER BY p.decision_date DESC, p.id
     LIMIT $1`,
    [limit],
  );
  const summary = { checked: 0, technicallyVerified: 0, searchable: 0, rejected: 0, rightsBlocked: 0 };

  for (const record of result.rows) {
    const local = validatePrecedentRecord(record);
    const paragraphs = local.valid ? splitParagraphs(record.source_text) : [];
    const linkStatus = local.valid ? await checkOfficialLink(record.official_url, { fetchImpl }) : 0;
    const rights = record.storage_allowed == null ? null : record;
    const technicalVerified = local.valid && paragraphs.length > 0 && linkStatus >= 200 && linkStatus <= 399;
    const searchable = canBecomeSearchable({ localValid: local.valid, paragraphCount: paragraphs.length, linkStatus, rights });
    const errorCode = !local.valid
      ? local.errorCode
      : paragraphs.length === 0
        ? "SOURCE_PARAGRAPHS_MISSING"
        : !(linkStatus >= 200 && linkStatus <= 399)
          ? "SOURCE_LINK_INVALID"
          : !searchable
            ? "SOURCE_RIGHTS_REQUIRED"
            : null;
    const connection = await pool.connect();

    try {
      await connection.query("BEGIN");
      await connection.query("DELETE FROM precedent_paragraphs WHERE precedent_id = $1", [record.id]);
      // The same records go to the paragraph table and to fact extraction, which
      // anchors every tag to a paragraph id.
      const paragraphRecords = paragraphs.map((body, index) => ({
        paragraphId: `p${String(index + 1).padStart(3, "0")}`,
        ordinal: index + 1,
        body,
      }));
      for (const paragraph of paragraphRecords) {
        await connection.query(
          `INSERT INTO precedent_paragraphs (precedent_id, paragraph_id, ordinal, body)
           VALUES ($1, $2, $3, $4)`,
          [record.id, paragraph.paragraphId, paragraph.ordinal, paragraph.body],
        );
      }
      if (technicalVerified) {
        await upsertPrecedentFactTags({ connection, precedentId: record.id, paragraphs: paragraphRecords });
      } else {
        await connection.query("DELETE FROM precedent_fact_tags WHERE precedent_id = $1", [record.id]);
      }
      await connection.query(
        `UPDATE precedents SET
           verified_at = CASE WHEN $2 THEN now() ELSE NULL END,
           link_checked_at = now(),
           link_status = $3,
           searchable = $4
         WHERE id = $1`,
        [record.id, technicalVerified, linkStatus || null, searchable],
      );
      await connection.query(
        `UPDATE precedent_sources SET verified_at = CASE WHEN $2 THEN now() ELSE NULL END
         WHERE precedent_id = $1 AND is_primary = true`,
        [record.id, technicalVerified],
      );
      await connection.query(
        `INSERT INTO verification_reviews
           (precedent_id, status, metadata_match, content_match, link_status, error_code)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [record.id, searchable ? "searchable" : technicalVerified ? "verified" : "rejected", local.valid, local.valid, linkStatus || null, errorCode],
      );
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }

    summary.checked += 1;
    if (technicalVerified) summary.technicallyVerified += 1;
    else summary.rejected += 1;
    if (searchable) summary.searchable += 1;
    else if (errorCode === "SOURCE_RIGHTS_REQUIRED") summary.rightsBlocked += 1;
  }

  return summary;
}
