import assert from "node:assert/strict";
import test from "node:test";
import { classifyExistingRecord } from "../server/sync-law-open-data.mjs";

test("classifies new, unchanged, and changed source hashes", () => {
  const next = { providerRecordId: "new-id", sourceHash: "b" };
  assert.equal(classifyExistingRecord(undefined, next), "new");
  assert.equal(classifyExistingRecord({ provider_record_id: "new-id", source_hash: "b" }, next), "unchanged");
  assert.equal(classifyExistingRecord({ provider_record_id: "new-id", source_hash: "a" }, next), "changed");
  assert.equal(classifyExistingRecord({ provider_record_id: "other-id", source_hash: "a" }, next), "duplicate");
});
