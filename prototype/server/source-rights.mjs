export const LAW_OPEN_DATA_TERMS_URL = "https://open.law.go.kr/LSO/information/guide.do";

function rightsError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function buildLawOpenDataRights({ approved, oc, reviewedAt = new Date() }) {
  if (!approved) {
    throw rightsError("LAW_OPEN_DATA_APPROVAL_REQUIRED", "공동활용 승인 확인이 필요합니다.");
  }
  if (!oc) {
    throw rightsError("LAW_OPEN_DATA_OC_REQUIRED", "API 인증값이 필요합니다.");
  }

  const reviewDate = reviewedAt.toISOString().slice(0, 10);
  return {
    provider: "law_open_data",
    storage_allowed: true,
    indexing_allowed: true,
    summary_allowed: true,
    display_allowed: true,
    redistribution_allowed: false,
    terms_version: `reviewed-${reviewDate}`,
    evidence_document_id: LAW_OPEN_DATA_TERMS_URL,
    reviewed_at: reviewedAt,
  };
}

export async function recordSourceRights({ pool, rights }) {
  await pool.query(
    `INSERT INTO source_rights
       (provider, storage_allowed, indexing_allowed, summary_allowed, display_allowed,
        redistribution_allowed, terms_version, evidence_document_id, reviewed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (provider) DO UPDATE SET
       storage_allowed = EXCLUDED.storage_allowed,
       indexing_allowed = EXCLUDED.indexing_allowed,
       summary_allowed = EXCLUDED.summary_allowed,
       display_allowed = EXCLUDED.display_allowed,
       redistribution_allowed = EXCLUDED.redistribution_allowed,
       terms_version = EXCLUDED.terms_version,
       evidence_document_id = EXCLUDED.evidence_document_id,
       reviewed_at = EXCLUDED.reviewed_at`,
    [
      rights.provider,
      rights.storage_allowed,
      rights.indexing_allowed,
      rights.summary_allowed,
      rights.display_allowed,
      rights.redistribution_allowed,
      rights.terms_version,
      rights.evidence_document_id,
      rights.reviewed_at,
    ],
  );
}
