import assert from "node:assert/strict";
import test from "node:test";
import { articleParameter, parseStatuteArticle, LawOpenDataClient } from "../server/law-open-data.mjs";
import { ARTICLE_13_ELEMENTS, mapFactsToArticle13 } from "../server/statute-elements.mjs";
import { extractFactTags } from "../src/lib/fact-tags.js";

const ARTICLE_PAYLOAD = {
  법령: {
    기본정보: { 법령명_한글: "성폭력범죄의 처벌 등에 관한 특례법", 시행일자: "20251001" },
    조문: {
      조문단위: {
        조문번호: "13",
        조문제목: "통신매체를 이용한 음란행위",
        조문내용: "제13조(통신매체를 이용한 음란행위) 자기 또는 다른 사람의 성적 욕망을<br/>유발하거나 만족시킬 목적으로 ... 도달하게 한 사람은 2년 이하의 징역에 처한다.",
      },
    },
  },
};

test("builds the article parameter the DRF service expects", () => {
  assert.equal(articleParameter("13"), "001300");
  assert.equal(articleParameter(13), "001300");
  assert.equal(articleParameter("13-2"), "001302");
  assert.equal(articleParameter("2"), "000200");
});

test("parses an article into quotable text with an official link", () => {
  const article = parseStatuteArticle(ARTICLE_PAYLOAD, { lawId: "011187", articleNo: "13" });

  assert.equal(article.lawName, "성폭력범죄의 처벌 등에 관한 특례법");
  assert.equal(article.articleTitle, "통신매체를 이용한 음란행위");
  assert.equal(article.enforcedOn, "2025-10-01");
  // Markup is stripped but the wording is the statute's own.
  assert.match(article.body, /^제13조\(통신매체를 이용한 음란행위\) 자기 또는 다른 사람의 성적 욕망을 유발하거나/);
  assert.doesNotMatch(article.body, /<br/);
  assert.match(article.officialUrl, /^https:\/\/www\.law\.go\.kr\/법령\/.+\/제13조$/);
});

test("rejects an article payload that lost its text", () => {
  assert.throws(
    () => parseStatuteArticle({ 법령: { 기본정보: { 법령명_한글: "법", 시행일자: "20251001" }, 조문: {} } }, { lawId: "1", articleNo: "13" }),
    (error) => /^LAW_STATUTE_INVALID:/.test(error.code) && error.code.includes("body"),
  );
});

test("asks the statute endpoint, not the precedent one", async () => {
  let seen;
  const client = new LawOpenDataClient({
    oc: "test",
    fetchImpl: async (url) => {
      seen = new URL(url).searchParams;
      return new Response(JSON.stringify(ARTICLE_PAYLOAD));
    },
  });
  const { article } = await client.fetchStatuteArticle({ lawId: "011187", articleNo: "13" });

  assert.equal(seen.get("target"), "law");
  assert.equal(seen.get("ID"), "011187");
  assert.equal(seen.get("JO"), "001300");
  assert.equal(article.articleNo, "13");
});

test("maps the article's elements from extracted facts, not from prose", () => {
  const facts = extractFactTags(
    "온라인 게임을 하다가 상대가 게임 채팅창으로 성적으로 비하하는 메시지를 여러 차례 보냈고 저는 바로 확인했습니다.",
  );
  const mapped = mapFactsToArticle13(facts);

  assert.deepEqual(mapped.map((item) => item.id), ARTICLE_13_ELEMENTS.map((item) => item.id));
  assert.deepEqual(
    mapped.map((item) => [item.id, item.mention]),
    [["purpose", "unclear"], ["medium", "present"], ["expression", "present"], ["reached", "present"]],
  );
  // Every element carries the statute's own wording so the screen can quote it.
  assert.equal(mapped.every((item) => item.statuteQuote.length > 0), true);
});

test("never reports the purpose element as settled", () => {
  // It is a state of mind: no description can establish it, and a court infers
  // it from the circumstances as a whole.
  for (const description of [
    "성적 욕망을 유발할 목적으로 보낸 것이 분명합니다.",
    "게임 채팅으로 성적인 욕설을 받았습니다.",
    "",
  ]) {
    const [purpose] = mapFactsToArticle13(extractFactTags(description));
    assert.equal(purpose.mention, "unclear", description);
  }
});

test("separates an element the user denied from one they did not mention", () => {
  const denied = mapFactsToArticle13(extractFactTags("상대가 글을 올렸지만 저에게 도달하지 않았습니다."));
  assert.equal(denied.find((item) => item.id === "reached").mention, "absent");

  const silent = mapFactsToArticle13({});
  assert.equal(silent.find((item) => item.id === "reached").mention, "unclear");
  assert.equal(silent.find((item) => item.id === "medium").mention, "unclear");
});

test("reports a denied medium or expression as denied rather than as mentioned", () => {
  // Every element used to be able to say only 언급됨 or 모르겠다 except arrival,
  // so a reader denying the account read three ticks back at themselves.
  const inPerson = mapFactsToArticle13(extractFactTags("카톡이 아니라 직접 만나서 말다툼한 것입니다."));
  assert.equal(inPerson.find((item) => item.id === "medium").mention, "absent");

  const denied = mapFactsToArticle13(extractFactTags("저는 카톡으로 성적인 말을 한 적이 전혀 없습니다."));
  assert.equal(denied.find((item) => item.id === "expression").mention, "absent");
  // The denial is about the words, so the channel they were not sent on stands.
  assert.equal(denied.find((item) => item.id === "medium").mention, "present");

  // The evidence line is a claim about what the reader wrote, so it may not
  // describe a mention when what it found was a denial.
  for (const element of [...inPerson, ...denied].filter((item) => item.mention === "absent")) {
    assert.doesNotMatch(element.evidence, /확인했습니다/, element.id);
  }
});

test("reads arrival from the side the reader is on", () => {
  // 상대방 in the article means whoever the message reached. That is the reader
  // when the reader received it, so answering a victim with 상대방이 내용을
  // 확인했다 named the sender as the one who saw it — the same confusion the
  // intake questions were rewritten to remove, left behind in the reading.
  const arrived = extractFactTags("카카오톡으로 성적인 말을 받았습니다.");
  const of = (facts, options) => mapFactsToArticle13(facts, options).find((item) => item.id === "reached");

  assert.match(of(arrived, { role: "victim" }).evidence, /회원님/);
  assert.doesNotMatch(of(arrived, { role: "victim" }).evidence, /상대/);

  assert.match(of(arrived, { role: "reported" }).evidence, /상대/);
  assert.doesNotMatch(of(arrived, { role: "reported" }).evidence, /회원님/);

  // No side chosen names neither of them rather than guessing one.
  for (const options of [undefined, {}, { role: "someone" }]) {
    const evidence = of(arrived, options).evidence;
    assert.doesNotMatch(evidence, /회원님|상대/, JSON.stringify(options));
  }

  // The mention itself is the same reading either way — only who is named moves.
  for (const role of ["victim", "reported", undefined]) {
    assert.equal(of(arrived, { role }).mention, "present", String(role));
  }
  const denied = extractFactTags("상대가 글을 올렸지만 도달하지 않았습니다.");
  assert.equal(of(denied, { role: "reported" }).mention, "absent");
});
