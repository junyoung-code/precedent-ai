import assert from "node:assert/strict";
import test from "node:test";
import {
  SUMMARY_VERSION,
  backfillPrecedentSummaries,
  selectSummaryParagraphs,
} from "../server/precedent-summaries.mjs";

const validSentence = {
  text: "법원은 메시지 전달 경위와 대화의 전체 맥락을 함께 살폈습니다.",
  paragraphIds: ["p-0001"],
};
const FOCUSED_CASE_NAME = "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)";

function relevantParagraphs(prefix) {
  return [
    { paragraphId: `${prefix}-0001`, ordinal: 1, text: "통신매체이용음란 공소사실" },
    { paragraphId: `${prefix}-0002`, ordinal: 2, text: "카카오톡으로 성적 메시지를 전송한 경위" },
    { paragraphId: `${prefix}-0003`, ordinal: 3, text: "성폭력처벌법 제13조에 관한 판단" },
  ];
}

test("selects only verified summary-allowed precedents and stores validated summaries", async () => {
  const queries = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/SELECT\s+p\.id/.test(sql)) {
        return { rows: [{
          id: "precedent-1",
          caseName: FOCUSED_CASE_NAME,
          sourceHash: "a".repeat(64),
          summarySourceHash: null,
          summaryVersion: null,
          summaryModel: null,
          paragraphs: relevantParagraphs("p"),
        }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const calls = [];
  const summaryClient = {
    model: "gpt-5-mini",
    summarize: async (input) => {
      calls.push(input);
      return { sentences: [validSentence] };
    },
  };

  const result = await backfillPrecedentSummaries({ pool, summaryClient, limit: 10 });

  assert.deepEqual(result, {
    selected: 1,
    generated: 1,
    skipped: 0,
    failed: 0,
    model: "gpt-5-mini",
    version: SUMMARY_VERSION,
  });
  assert.deepEqual(calls[0], {
    paragraphs: [
      { paragraphId: "p-0001", text: "통신매체이용음란 공소사실" },
      { paragraphId: "p-0002", text: "카카오톡으로 성적 메시지를 전송한 경위" },
      { paragraphId: "p-0003", text: "성폭력처벌법 제13조에 관한 판단" },
    ],
  });
  assert.match(queries[0].sql, /JOIN source_rights/);
  assert.match(queries[0].sql, /r\.summary_allowed = true/);
  assert.match(queries[0].sql, /p\.searchable = true/);
  assert.match(queries[1].sql, /INSERT INTO precedent_summaries/);
  assert.equal(queries[1].params[0], "precedent-1");
  assert.equal(queries[1].params[1], "a".repeat(64));
  assert.deepEqual(JSON.parse(queries[1].params[4]), [validSentence]);
});

test("skips unchanged summaries and continues after a per-precedent failure", async () => {
  const rows = [
    {
      id: "skip",
      caseName: FOCUSED_CASE_NAME,
      sourceHash: "a".repeat(64),
      summarySourceHash: "a".repeat(64),
      summaryVersion: SUMMARY_VERSION,
      summaryModel: "gpt-5-mini",
      paragraphs: relevantParagraphs("p"),
    },
    {
      id: "fail",
      caseName: FOCUSED_CASE_NAME,
      sourceHash: "b".repeat(64),
      summarySourceHash: null,
      summaryVersion: null,
      summaryModel: null,
      paragraphs: relevantParagraphs("q"),
    },
    {
      id: "success",
      caseName: FOCUSED_CASE_NAME,
      sourceHash: "c".repeat(64),
      summarySourceHash: null,
      summaryVersion: null,
      summaryModel: null,
      paragraphs: relevantParagraphs("r"),
    },
  ];
  const writes = [];
  const pool = {
    query: async (sql, params) => {
      if (/SELECT\s+p\.id/.test(sql)) return { rows };
      writes.push(params);
      return { rowCount: 1, rows: [] };
    },
  };
  const summaryClient = {
    model: "gpt-5-mini",
    summarize: async ({ paragraphs }) => {
      if (paragraphs[0].paragraphId === "q-0001") throw Object.assign(new Error("offline"), { code: "SUMMARY_API_UNAVAILABLE" });
      return {
        sentences: [{ ...validSentence, paragraphIds: [paragraphs[0].paragraphId] }],
      };
    },
  };

  const result = await backfillPrecedentSummaries({ pool, summaryClient });
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.generated, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "success");
});

test("limits related model input to paragraph ids and at most forty thousand characters", () => {
  const paragraphs = [
    { paragraphId: "p-1", ordinal: 1, body: `통신매체이용음란 ${"가".repeat(10_000)}` },
    { paragraphId: "p-2", ordinal: 2, body: `전송 경위 ${"나".repeat(10_000)}` },
    { paragraphId: "p-3", ordinal: 3, body: `성폭력처벌법 제13조 ${"다".repeat(10_000)}` },
  ];
  const selected = selectSummaryParagraphs(paragraphs);
  assert.deepEqual(selected.map(({ paragraphId }) => paragraphId), ["p-1", "p-2", "p-3"]);
  assert.ok(selected.reduce((sum, paragraph) => sum + paragraph.text.length, 0) <= 40_000);
  assert.deepEqual(Object.keys(selected[0]).sort(), ["paragraphId", "text"]);
});

test("does not call the model when related paragraphs are insufficient", async () => {
  let calls = 0;
  const pool = {
    query: async (sql) => /SELECT\s+p\.id/.test(sql)
      ? { rows: [{
          id: "short",
          caseName: FOCUSED_CASE_NAME,
          sourceHash: "d".repeat(64),
          summarySourceHash: null,
          summaryVersion: null,
          summaryModel: null,
          paragraphs: [{ paragraphId: "p-1", ordinal: 1, text: "통신매체이용음란" }],
        }] }
      : { rows: [] },
  };
  const summaryClient = { model: "gpt-5-mini", summarize: async () => { calls += 1; } };
  const result = await backfillPrecedentSummaries({ pool, summaryClient });
  assert.equal(calls, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.generated, 0);
});

test("does not generate summaries for non-target or mixed-offense precedents", async () => {
  const rows = [
    {
      id: "civil",
      caseName: "손해배상(기)등청구의소",
      sourceHash: "e".repeat(64),
      paragraphs: relevantParagraphs("civil"),
    },
    {
      id: "mixed",
      caseName: "재물손괴·통신매체이용음란·음주운전",
      sourceHash: "f".repeat(64),
      paragraphs: relevantParagraphs("mixed"),
    },
  ];
  let calls = 0;
  const pool = {
    query: async (sql) => {
      if (/SELECT\s+p\.id/.test(sql)) {
        assert.match(sql, /case_name ILIKE '%통신매체이용음란%'/);
        return { rows };
      }
      return { rows: [] };
    },
  };
  const summaryClient = {
    model: "gpt-5-mini",
    summarize: async () => { calls += 1; return { sentences: [validSentence] }; },
  };

  const result = await backfillPrecedentSummaries({ pool, summaryClient });

  assert.equal(calls, 0);
  assert.equal(result.generated, 0);
  assert.equal(result.skipped, 2);
});
