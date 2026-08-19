import assert from "node:assert/strict";
import test from "node:test";
import { classifyExistingRecord, collectCandidates, syncLawOpenData } from "../server/sync-law-open-data.mjs";
import { selectUnrelatedPrecedents } from "../server/prune-precedents.mjs";

test("classifies new, unchanged, and changed source hashes", () => {
  const next = { providerRecordId: "new-id", sourceHash: "b" };
  assert.equal(classifyExistingRecord(undefined, next), "new");
  assert.equal(classifyExistingRecord({ provider_record_id: "new-id", source_hash: "b" }, next), "unchanged");
  assert.equal(classifyExistingRecord({ provider_record_id: "new-id", source_hash: "a" }, next), "changed");
  assert.equal(classifyExistingRecord({ provider_record_id: "other-id", source_hash: "a" }, next), "duplicate");
});

function pagedApi(totalCount, pageSize = 100) {
  const requests = [];
  return {
    requests,
    listCandidates: async ({ page, display, search }) => {
      requests.push({ page, display, search });
      const start = (page - 1) * pageSize;
      const candidates = [];
      for (let index = start; index < Math.min(start + display, totalCount); index += 1) {
        candidates.push({ providerRecordId: `r${index + 1}`, caseName: "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)" });
      }
      return { candidates, totalCount };
    },
  };
}

test("walks every page instead of stopping at the first one", async () => {
  const api = pagedApi(230);
  const collected = await collectCandidates({ api, query: "통신매체이용음란", limit: 500 });

  assert.equal(collected.totalCount, 230);
  assert.equal(collected.candidates.length, 230);
  assert.deepEqual(api.requests.map((item) => item.page), [1, 2, 3]);
  // The page size the provider allows is the ceiling, not the caller's limit.
  assert.equal(api.requests.every((item) => item.display <= 100), true);
});

test("stops at the caller's limit and on an empty page", async () => {
  const limited = await collectCandidates({ api: pagedApi(230), query: "q", limit: 40 });
  assert.equal(limited.candidates.length, 40);

  // A provider that overstates its total must not spin forever.
  const lying = {
    listCandidates: async ({ page }) => ({ candidates: page === 1 ? [{ providerRecordId: "r1" }] : [], totalCount: 999 }),
  };
  const stopped = await collectCandidates({ api: lying, query: "q", limit: 100 });
  assert.equal(stopped.candidates.length, 1);
});

test("refuses to store a judgment the search could never return", async () => {
  const detail = {
    "keep": {
      provider: "law_open_data", providerRecordId: "keep", court: "대법원", caseNumber: "2025도12709",
      caseName: "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)", decisionDate: "2026-03-12",
      officialUrl: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=1", sourceText: "본문", sourceHash: "h1",
    },
    // Real case names that a full-text collection stored: the offence appears
    // somewhere in the judgment text but nowhere in the name.
    "drop": {
      provider: "law_open_data", providerRecordId: "drop", court: "서울고등법원", caseNumber: "2015나2003264",
      caseName: "손해배상(기)('twistkim' 도메인 이름 사건)", decisionDate: "2016-01-15",
      officialUrl: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=2", sourceText: "본문", sourceHash: "h2",
    },
  };
  const api = {
    listCandidates: async () => ({
      candidates: [{ providerRecordId: "keep" }, { providerRecordId: "drop" }],
      totalCount: 2,
    }),
    fetchDetail: async (id) => ({ precedent: detail[id], raw: { id } }),
  };

  const inserted = [];
  const connection = {
    query: async (sql, params) => {
      if (/INSERT INTO precedents\b/.test(sql)) inserted.push(params[4]);
      // Nothing stored yet, so every candidate is new.
      if (/^SELECT id, provider_record_id/.test(sql.trim())) return { rows: [], rowCount: 0 };
      return { rows: [{ id: "row-1" }], rowCount: 1 };
    },
    release: () => {},
  };
  const pool = {
    query: async (sql) => (/data_sources/.test(sql)
      ? { rows: [{ id: "source-1" }], rowCount: 1 }
      : { rows: [{ id: "run-1" }], rowCount: 1 }),
    connect: async () => connection,
  };

  const summary = await syncLawOpenData({ pool, api, query: "통신매체이용음란", limit: 10 });

  assert.deepEqual(inserted, ["성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)"]);
  assert.equal(summary.fetched, 1);
  assert.equal(summary.skipped, 1);
  assert.deepEqual(summary.skippedCaseNames, ["손해배상(기)('twistkim' 도메인 이름 사건)"]);
  assert.deepEqual(summary.providerRecordIds, ["keep"]);
});

test("prunes only the stored records the search cannot return", () => {
  const rows = [
    { id: "1", caseName: "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)" },
    { id: "2", caseName: "협박·성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)·스토킹범죄의처벌등에관한법률위반" },
    { id: "3", caseName: "손해배상(기)" },
    { id: "4", caseName: "저작권법위반방조" },
  ];
  assert.deepEqual(selectUnrelatedPrecedents(rows).map((row) => row.id), ["3", "4"]);
  assert.deepEqual(selectUnrelatedPrecedents([]), []);
});
