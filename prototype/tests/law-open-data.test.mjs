import assert from "node:assert/strict";
import test from "node:test";
import {
  LawOpenDataClient,
  LawOpenDataError,
  parsePrecedentDetail,
  parsePrecedentList,
} from "../server/law-open-data.mjs";

test("parses both a single list item and an array", () => {
  const item = { 판례일련번호: "618503", 사건번호: "2025도12709", 사건명: "통신매체이용음란", 법원명: "대법원", 선고일자: "2026.03.12" };
  assert.equal(parsePrecedentList({ PrecSearch: { prec: item } })[0].decisionDate, "2026-03-12");
  assert.equal(parsePrecedentList({ PrecSearch: { prec: [item, { ...item, 판례일련번호: "2" }] } }).length, 2);
});

test("normalizes a detail record and hashes its official source text", () => {
  const result = parsePrecedentDetail({ PrecService: {
    판례정보일련번호: "618503",
    사건번호: "2025도12709",
    사건명: "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)",
    법원명: "대법원",
    선고일자: "20260312",
    판례내용: "검증할 판례 본문",
  } });
  assert.equal(result.officialUrl, "https://www.law.go.kr/LSW/precInfoP.do?precSeq=618503");
  assert.equal(result.decisionDate, "2026-03-12");
  assert.equal(result.sourceHash.length, 64);
});

test("rejects missing required detail fields", () => {
  assert.throws(() => parsePrecedentDetail({ PrecService: { 판례정보일련번호: "1" } }), /LAW_RECORD_INVALID/);
});

test("requires an approved OC before any network call", () => {
  assert.throws(() => new LawOpenDataClient(), (error) => error instanceof LawOpenDataError && error.code === "LAW_OPEN_DATA_APPROVAL_REQUIRED");
});

test("maps network failures to a stable error code", async () => {
  const client = new LawOpenDataClient({ oc: "test", fetchImpl: async () => { throw new Error("offline"); } });
  await assert.rejects(client.listCandidates({ query: "통신매체이용음란" }), (error) => error.code === "LAW_API_UNAVAILABLE");
});
