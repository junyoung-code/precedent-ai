import { createHash } from "node:crypto";
import { isCommunicationObscenityCaseName } from "./precedent-scope.mjs";

const MAX_PAGE_SIZE = 100;

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Walks the result pages until the provider's own total is covered or the caller's
 * limit is met. Reading only the first page silently caps a collection at the page
 * size, which is invisible until someone counts the rows.
 */
export async function collectCandidates({ api, query, limit, search }) {
  const collected = [];
  let totalCount = 0;
  for (let page = 1; collected.length < limit; page += 1) {
    const display = Math.min(Math.max(limit - collected.length, 1), MAX_PAGE_SIZE);
    const list = await api.listCandidates({ query, page, display, search });
    totalCount = list.totalCount;
    if (!list.candidates.length) break;
    collected.push(...list.candidates);
    if (collected.length >= totalCount) break;
  }
  return { candidates: collected.slice(0, limit), totalCount };
}

export function classifyExistingRecord(previous, precedent) {
  if (!previous) return "new";
  if (previous.provider_record_id !== precedent.providerRecordId) return "duplicate";
  return previous.source_hash === precedent.sourceHash ? "unchanged" : "changed";
}

export async function syncLawOpenData({
  pool,
  api,
  query,
  limit = 20,
  search,
  isRelevant = isCommunicationObscenityCaseName,
}) {
  const source = await pool.query("SELECT id FROM data_sources WHERE provider = 'law_open_data'");
  if (!source.rowCount) throw new Error("LAW_DATA_SOURCE_MISSING");

  const run = await pool.query(
    "INSERT INTO sync_runs (source_id, query, status) VALUES ($1, $2, 'running') RETURNING id",
    [source.rows[0].id, query],
  );
  const runId = run.rows[0].id;
  const connection = await pool.connect();
  const summary = { totalCount: 0, fetched: 0, skipped: 0, new: 0, changed: 0, unchanged: 0, duplicate: 0, skippedCaseNames: [], providerRecordIds: [] };

  try {
    const list = await collectCandidates({ api, query, limit: Math.max(limit, 1), search });
    summary.totalCount = list.totalCount;
    await connection.query("BEGIN");

    for (const candidate of list.candidates) {
      const { precedent, raw } = await api.fetchDetail(candidate.providerRecordId);
      // The last gate before storage. A record the search can never return is
      // not worth the row, the embedding, or the inflated count.
      if (!isRelevant(precedent.caseName)) {
        summary.skipped += 1;
        summary.skippedCaseNames.push(precedent.caseName);
        continue;
      }
      const existing = await connection.query(
        `SELECT id, provider_record_id, source_hash FROM precedents
         WHERE (provider = $1 AND provider_record_id = $2)
            OR (court = $3 AND case_number = $4 AND decision_date = $5)
         ORDER BY (provider = $1 AND provider_record_id = $2) DESC
         LIMIT 1`,
        [precedent.provider, precedent.providerRecordId, precedent.court, precedent.caseNumber, precedent.decisionDate],
      );
      const previous = existing.rows[0];
      const state = classifyExistingRecord(previous, precedent);
      const document = await connection.query(
        `INSERT INTO source_documents (source_id, sync_run_id, external_id, raw_hash, raw_payload)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_id, external_id, raw_hash)
         DO UPDATE SET sync_run_id = EXCLUDED.sync_run_id, fetched_at = now()
         RETURNING id`,
        [source.rows[0].id, runId, precedent.providerRecordId, hashJson(raw), raw],
      );
      const saved = state === "duplicate"
        ? { rows: [{ id: previous.id }] }
        : await connection.query(
          `INSERT INTO precedents
           (provider, provider_record_id, court, case_number, case_name, decision_date, official_url, source_text, source_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (provider, provider_record_id) DO UPDATE SET
           court = EXCLUDED.court,
           case_number = EXCLUDED.case_number,
           case_name = EXCLUDED.case_name,
           decision_date = EXCLUDED.decision_date,
           official_url = EXCLUDED.official_url,
           source_text = EXCLUDED.source_text,
           collected_at = now(),
           verified_at = CASE WHEN precedents.source_hash = EXCLUDED.source_hash THEN precedents.verified_at END,
           link_checked_at = CASE WHEN precedents.source_hash = EXCLUDED.source_hash THEN precedents.link_checked_at END,
           link_status = CASE WHEN precedents.source_hash = EXCLUDED.source_hash THEN precedents.link_status END,
           searchable = CASE WHEN precedents.source_hash = EXCLUDED.source_hash THEN precedents.searchable ELSE false END,
           source_hash = EXCLUDED.source_hash
           RETURNING id`,
          [
            precedent.provider, precedent.providerRecordId, precedent.court, precedent.caseNumber,
            precedent.caseName, precedent.decisionDate, precedent.officialUrl, precedent.sourceText, precedent.sourceHash,
          ],
        );
      if (state !== "duplicate") {
        await connection.query("UPDATE precedent_sources SET is_primary = false WHERE precedent_id = $1", [saved.rows[0].id]);
      }
      await connection.query(
        `INSERT INTO precedent_sources (precedent_id, source_document_id, official_url, is_primary)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (precedent_id, source_document_id)
         DO UPDATE SET official_url = EXCLUDED.official_url, is_primary = EXCLUDED.is_primary`,
        [saved.rows[0].id, document.rows[0].id, precedent.officialUrl, state !== "duplicate"],
      );

      summary.fetched += 1;
      summary[state] += 1;
      summary.providerRecordIds.push(precedent.providerRecordId);
    }

    await connection.query("COMMIT");
    await pool.query(
      `UPDATE sync_runs SET status = 'succeeded', fetched_count = $2, changed_count = $3, completed_at = now()
       WHERE id = $1`,
      [runId, summary.fetched, summary.new + summary.changed],
    );
    return summary;
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});
    await pool.query(
      "UPDATE sync_runs SET status = 'failed', error_code = $2, completed_at = now() WHERE id = $1",
      [runId, error.code || "LAW_SYNC_FAILED"],
    );
    throw error;
  } finally {
    connection.release();
  }
}
