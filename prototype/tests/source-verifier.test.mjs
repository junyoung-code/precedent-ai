import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  canBecomeSearchable,
  checkOfficialLink,
  splitParagraphs,
  validatePrecedentRecord,
  verifyPrecedents,
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

// A judgment whose facts a reader can name: a bank transfer memo used to carry
// sexual insults to a stranger, repeatedly, and the recipient read them.
const SOURCE_TEXT = [
  "<p>【주    문】 원심판결을 파기하고, 사건을 부산지방법원에 환송한다.</p>",
  "<p>【이    유】 상고이유를 판단한다.</p>",
  "<p>피고인은 자기의 성적 욕망을 유발할 목적으로, 모르는 피해자의 은행계좌로 1원씩 여러 차례 입금하면서 송금메모란에 성적인 욕설과 피해자의 신체를 비하하는 메시지를 각 전송하였다.</p>",
  "<p>피해자는 은행 거래내역에서 위 메시지를 그대로 확인하였다.</p>",
  "<p>원심은 송금메모가 통신매체에 해당하지 않는다고 보아 무죄로 판단하였다.</p>",
].join("\n");

function fakePool(record) {
  const statements = [];
  const connection = {
    query: async (sql, params) => {
      statements.push({ sql, params });
      return { rows: [] };
    },
    release: () => {},
  };
  return {
    statements,
    pool: {
      query: async () => ({ rows: [record] }),
      connect: async () => connection,
    },
  };
}

test("re-verification re-derives fact tags instead of blanking them", async () => {
  const record = {
    id: "p1",
    court: "대법원",
    case_number: "2025도12709",
    case_name: "통신매체이용음란",
    decision_date: "2026-03-12",
    official_url: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=618503",
    source_text: SOURCE_TEXT,
    source_hash: createHash("sha256").update(SOURCE_TEXT).digest("hex"),
    provider: "law_open_data",
    storage_allowed: true,
    indexing_allowed: true,
    summary_allowed: true,
    display_allowed: true,
  };
  const { pool, statements } = fakePool(record);

  const summary = await verifyPrecedents({
    pool,
    limit: 1,
    fetchImpl: async () => ({ status: 200, url: record.official_url }),
  });

  assert.deepEqual(summary, {
    checked: 1,
    technicallyVerified: 1,
    searchable: 1,
    rejected: 0,
    rightsBlocked: 0,
  });

  // Link freshness expires after a day, so this runs routinely. It must not cost
  // the fact tags that carry 45% of the retrieval score.
  const upsert = statements.find((item) => /INSERT INTO precedent_fact_tags/.test(item.sql));
  assert.ok(upsert, "verification must write fact tags");
  const [, , medium, , recipientIdentification, reachedRecipient, relationship, , expressionType, repetition, , issueTags, evidence] = upsert.params;
  assert.equal(medium, "bank_transfer");
  assert.equal(recipientIdentification, "bank_account");
  assert.equal(reachedRecipient, "yes");
  assert.equal(relationship, "stranger");
  assert.equal(expressionType, "insult_with_sexual_terms");
  assert.equal(repetition, "repeated");
  assert.equal(issueTags.includes("성적표현"), true);

  // Every tag stays anchored to paragraphs that were stored in the same
  // transaction, so the ids a summary cites still resolve.
  const stored = statements
    .filter((item) => /INSERT INTO precedent_paragraphs/.test(item.sql))
    .map((item) => item.params[1]);
  assert.equal(stored.length > 0, true);
  assert.equal(evidence.paragraphIds.length > 0, true);
  for (const paragraphId of evidence.paragraphIds) {
    assert.equal(stored.includes(paragraphId), true, `unknown paragraph id: ${paragraphId}`);
  }
});

test("drops fact tags when a record no longer verifies", async () => {
  const record = {
    id: "p2",
    court: "대법원",
    case_number: "2025도12709",
    decision_date: "2026-03-12",
    official_url: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=618503",
    source_text: SOURCE_TEXT,
    source_hash: "0".repeat(64),
    provider: "law_open_data",
    storage_allowed: true,
    indexing_allowed: true,
    summary_allowed: true,
    display_allowed: true,
  };
  const { pool, statements } = fakePool(record);

  const summary = await verifyPrecedents({ pool, limit: 1, fetchImpl: async () => ({ status: 200 }) });

  assert.equal(summary.rejected, 1);
  assert.equal(summary.searchable, 0);
  assert.equal(statements.some((item) => /DELETE FROM precedent_fact_tags/.test(item.sql)), true);
  assert.equal(statements.some((item) => /INSERT INTO precedent_fact_tags/.test(item.sql)), false);
});
