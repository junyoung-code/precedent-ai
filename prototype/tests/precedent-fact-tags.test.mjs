import assert from "node:assert/strict";
import test from "node:test";
import {
  backfillPrecedentFactTags,
  isStatutoryEnumeration,
  upsertPrecedentFactTags,
} from "../server/precedent-fact-tags.mjs";

test("identifies statutory message-form enumerations", () => {
  assert.equal(
    isStatutoryEnumeration("성폭력처벌법 제13조는 전화를 통해 말, 음향, 글, 그림, 영상, 물건을 전달하는 행위를 규정한다."),
    true,
  );
  assert.equal(isStatutoryEnumeration("카카오톡으로 성적 욕설을 전송하였다."), false);
});

test("upserts neutral versioned tags without legal-outcome fields", async () => {
  const calls = [];
  const connection = { query: async (...args) => calls.push(args) };

  const facts = await upsertPrecedentFactTags({
    connection,
    precedentId: "p1",
    paragraphs: [
      { paragraphId: "p1", ordinal: 1, body: "통신매체이용음란 공소사실" },
      { paragraphId: "p2", ordinal: 2, body: "게임 채팅에서 성적인 욕설을 한 번 전송하였다." },
      { paragraphId: "p3", ordinal: 3, body: "성적 수치심에 관한 판단" },
    ],
  });

  assert.equal(facts.medium, "game_chat");
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /INSERT INTO precedent_fact_tags/);
  assert.match(calls[0][0], /ON CONFLICT \(precedent_id\)/);
  assert.equal(calls[0][1][0], "p1");
  assert.equal(calls[0][1][1], "rule-v2");
  assert.equal(calls[0][1].some((value) => /guilt|outcome|complaint|punishment/i.test(String(value))), false);
});

test("extracts tags only from communication-obscenity paragraphs", async () => {
  const calls = [];
  const connection = { query: async (...args) => calls.push(args) };
  const facts = await upsertPrecedentFactTags({
    connection,
    precedentId: "mixed",
    paragraphs: [
      { paragraphId: "p0", ordinal: 1, body: "다른 범죄에서 게임과 나체 사진이 언급되었다." },
      { paragraphId: "p1", ordinal: 2, body: "별도 범죄에 관한 마무리 문단" },
      { paragraphId: "p2", ordinal: 3, body: "통신매체이용음란 부분의 사실관계" },
      { paragraphId: "p3", ordinal: 4, body: "카카오톡으로 성적 욕설을 한 번 전송하였다." },
      { paragraphId: "p4", ordinal: 5, body: "성폭력처벌법 제13조는 말, 음향, 글, 그림, 영상, 물건을 전달하는 행위를 규정한다." },
      { paragraphId: "p5", ordinal: 6, body: "압수수색에 관한 별도 판단" },
    ],
  });

  assert.equal(facts.medium, "kakao");
  assert.equal(facts.messageForm, "text");
  assert.equal(facts.expressionType, "insult_with_sexual_terms");
  assert.equal(facts.repetition, "once");
});

test("stores conservative tags when fewer than three relevant paragraphs exist", async () => {
  const connection = { query: async () => {} };
  const facts = await upsertPrecedentFactTags({
    connection,
    precedentId: "short",
    paragraphs: [{ paragraphId: "p1", ordinal: 1, body: "통신매체이용음란" }],
  });
  assert.deepEqual(
    {
      medium: facts.medium,
      messageForm: facts.messageForm,
      recipientIdentification: facts.recipientIdentification,
      reachedRecipient: facts.reachedRecipient,
      relationship: facts.relationship,
      context: facts.context,
      expressionType: facts.expressionType,
      repetition: facts.repetition,
      additionalChannels: facts.additionalChannels,
      issueTags: facts.issueTags,
    },
    {
      medium: "unknown",
      messageForm: "text",
      recipientIdentification: "unknown",
      reachedRecipient: "unknown",
      relationship: "unknown",
      context: "unknown",
      expressionType: "other",
      repetition: "unknown",
      additionalChannels: [],
      issueTags: [],
    },
  );
});

test("backfills only verified precedent records", async () => {
  const writes = [];
  const connection = {
    query: async (...args) => writes.push(args),
    release() {},
  };
  const pool = {
    query: async (sql) => {
      assert.match(sql, /verified_at IS NOT NULL/);
      assert.match(sql, /precedent_paragraphs/);
      return { rows: [{
        id: "p1",
        paragraphs: [
          { paragraphId: "p1", ordinal: 1, body: "통신매체이용음란" },
          { paragraphId: "p2", ordinal: 2, body: "카카오톡으로 성적인 메시지를 보냈다." },
          { paragraphId: "p3", ordinal: 3, body: "성적 수치심" },
        ],
      }] };
    },
    connect: async () => connection,
  };

  const summary = await backfillPrecedentFactTags({ pool, limit: 10 });

  assert.deepEqual(summary, { selected: 1, tagged: 1 });
  assert.equal(writes[0][0], "BEGIN");
  assert.match(writes[1][0], /INSERT INTO precedent_fact_tags/);
  assert.equal(writes.at(-1)[0], "COMMIT");
});
