import pg from "pg";
import { buildLawOpenDataRights, recordSourceRights } from "../server/source-rights.mjs";

const approved = process.argv.includes("--confirm-approved");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const rights = buildLawOpenDataRights({
    approved,
    oc: process.env.LAW_OPEN_DATA_OC,
  });
  await recordSourceRights({ pool, rights });
  console.log(JSON.stringify({
    provider: rights.provider,
    termsVersion: rights.terms_version,
    evidence: rights.evidence_document_id,
    searchableUsesAllowed: true,
    redistributionAllowed: rights.redistribution_allowed,
  }, null, 2));
} catch (error) {
  console.error(error.code || "SOURCE_RIGHTS_REVIEW_FAILED");
  process.exitCode = 1;
} finally {
  await pool.end();
}
