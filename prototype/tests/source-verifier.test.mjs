import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  canBecomeSearchable,
  checkOfficialLink,
  splitParagraphs,
  validatePrecedentRecord,
} from "../server/source-verifier.mjs";

const validRecord = {
  court: "대법원",
  case_number: "2025도12709",
  decision_date: "2026-03-12",
  official_url: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=618503",
  source_text: "첫 번째 문단\n두 번째 문단",
  source_hash: createHash("sha256").update("첫 번째 문단\n두 번째 문단").digest("hex"),
};

test("accepts only HTTPS official precedent hosts and matching hashes", () => {
  assert.deepEqual(validatePrecedentRecord(validRecord), { valid: true, errorCode: null });
  assert.equal(validatePrecedentRecord({ ...validRecord, official_url: "https://example.com/fake" }).errorCode, "SOURCE_URL_INVALID");
  assert.equal(validatePrecedentRecord({ ...validRecord, source_hash: "0".repeat(64) }).errorCode, "SOURCE_HASH_MISMATCH");
});

test("splits HTML-like judgment text into stable non-empty paragraphs", () => {
  assert.deepEqual(splitParagraphs("<p>첫 문단</p><p>둘째&nbsp;문단</p><br>셋째"), ["첫 문단", "둘째 문단", "셋째"]);
});

test("keeps search closed unless technical checks, paragraphs, link, and rights all pass", () => {
  const rights = { storage_allowed: true, indexing_allowed: true, summary_allowed: true, display_allowed: true };
  assert.equal(canBecomeSearchable({ localValid: true, paragraphCount: 1, linkStatus: 200, rights }), true);
  assert.equal(canBecomeSearchable({ localValid: true, paragraphCount: 1, linkStatus: 200, rights: null }), false);
  assert.equal(canBecomeSearchable({ localValid: true, paragraphCount: 0, linkStatus: 200, rights }), false);
  assert.equal(canBecomeSearchable({ localValid: true, paragraphCount: 1, linkStatus: 404, rights }), false);
});

test("falls back to GET when an official server rejects HEAD", async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    calls.push(options.method);
    return { status: options.method === "HEAD" ? 404 : 200, url: validRecord.official_url };
  };
  assert.equal(await checkOfficialLink(validRecord.official_url, { fetchImpl }), 200);
  assert.deepEqual(calls, ["HEAD", "GET"]);
});
