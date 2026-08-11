import assert from "node:assert/strict";
import test from "node:test";
import {
  LAW_OPEN_DATA_TERMS_URL,
  buildLawOpenDataRights,
  recordSourceRights,
} from "../server/source-rights.mjs";

test("requires an approved application and OC before recording rights", () => {
  assert.throws(
    () => buildLawOpenDataRights({ approved: false, oc: "precedent-test" }),
    { code: "LAW_OPEN_DATA_APPROVAL_REQUIRED" },
  );
  assert.throws(
    () => buildLawOpenDataRights({ approved: true, oc: "" }),
    { code: "LAW_OPEN_DATA_OC_REQUIRED" },
  );
});

test("allows service use but keeps raw redistribution closed", () => {
  const reviewedAt = new Date("2026-08-11T00:00:00.000Z");
  const rights = buildLawOpenDataRights({ approved: true, oc: "precedent-test", reviewedAt });

  assert.deepEqual(rights, {
    provider: "law_open_data",
    storage_allowed: true,
    indexing_allowed: true,
    summary_allowed: true,
    display_allowed: true,
    redistribution_allowed: false,
    terms_version: "reviewed-2026-08-11",
    evidence_document_id: LAW_OPEN_DATA_TERMS_URL,
    reviewed_at: reviewedAt,
  });
});

test("upserts the reviewed rights record without exposing the OC", async () => {
  const calls = [];
  const pool = { query: async (...args) => calls.push(args) };
  const rights = buildLawOpenDataRights({
    approved: true,
    oc: "must-not-be-persisted",
    reviewedAt: new Date("2026-08-11T00:00:00.000Z"),
  });

  await recordSourceRights({ pool, rights });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].includes("must-not-be-persisted"), false);
  assert.equal(calls[0][1][0], "law_open_data");
});
