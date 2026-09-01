import assert from "node:assert/strict";
import test from "node:test";
import {
  WEB_BATCH_SIZE, WEB_CASE_DISPLAY_LIMIT, WEB_MEDIUMS, WEB_SOURCE_TYPES, buildWebSearchQuery, selectWebCases, tidyTitle, validateWebCases, verifyWebCases,
} from "../server/web-cases.mjs";
import { extractFactTags } from "../src/lib/fact-tags.js";
import { USER_AGENT } from "../server/robots.mjs";

const ok = {
  title: "게임하다 1대1채팅으로 패드립과 성드립을 들었습니다",
  url: "https://www.lawtalk.co.kr/qna/193707",
  sourceType: "lawyer_qna",
  quote: "게임에서 1대1 채팅으로 성적인 욕설을 들었다며 고소 가능성을 물은 질문입니다.",
};

test("keeps a personal post regardless of how authoritative its source is", () => {
  // The selection rule is whether the situation resembles the reader's, not
  // whether a lawyer wrote it. A community post is the point, not a fallback.
  const { cases } = validateWebCases([
    ok,
    { ...ok, url: "https://gall.dcinside.com/board/view/?id=game&no=12", sourceType: "community" },
    { ...ok, url: "https://kin.naver.com/qna/detail.naver?docId=1", sourceType: "qna" },
  ]);
  assert.deepEqual(cases.map((item) => item.sourceType), ["lawyer_qna", "community", "qna"]);
});

test("drops an item that cannot be opened, typed, or quoted", () => {
  const { cases, dropped } = validateWebCases([
    { ...ok, url: "" },
    { ...ok, url: "not a url" },
    { ...ok, sourceType: "forum" },
    { ...ok, quote: "" },
    null,
  ]);
  assert.deepEqual(cases, []);
  assert.equal(dropped.length, 5);
});

test("does not let a model's url point back inside our own network", () => {
  // The address is free text in a model's output and the server fetches it, so
  // it is untrusted input to a request we make.
  for (const url of [
    "http://localhost:8787/api/search",
    "http://127.0.0.1/",
    "http://192.168.0.5/admin",
    "http://10.0.0.1/",
    "http://172.16.4.4/",
    "file:///c:/secrets.txt",
    "http://db.internal/",
  ]) {
    assert.deepEqual(validateWebCases([{ ...ok, url }]).cases, [], url);
  }
});

test("does not copy someone else's identity out of their post", () => {
  for (const quote of [
    "김민수라는 사람이 010-1234-5678로 연락했다는 글입니다.",
    "작성자가 abc@example.com으로 메일을 받았다고 적었습니다.",
    "상대 계정 @haterofgames 가 욕설을 보냈다는 글입니다.",
    "한국대학교 학생이 겪은 일이라고 적혀 있습니다.",
  ]) {
    assert.deepEqual(validateWebCases([{ ...ok, quote }]).cases, [], quote);
  }
});

test("drops a web post that dresses itself up as a judgment", () => {
  // The verified cards are the only place this service puts a decision on
  // screen. A blog post carrying a case number blurs that line.
  assert.deepEqual(validateWebCases([{ ...ok, quote: "2023도7199 판결을 보면 유죄가 인정되었습니다." }]).cases, []);
  assert.deepEqual(validateWebCases([{ ...ok, title: "대법원이 2024. 5. 1. 선고한 사건 해설" }]).cases, []);
  assert.deepEqual(validateWebCases([{ ...ok, quote: "2021노1851 사건이라고 적혀 있습니다." }]).cases, []);
});

test("does not mistake a date for a case number", () => {
  // Most posts say when it happened. A pattern loose enough to read "2024년
  // 12월" as a case number throws away exactly the posts we went looking for.
  for (const quote of [
    "2024년 12월에 게임 채팅으로 성적인 욕설을 들었다는 글입니다.",
    "작년 11월 20일쯤 벌어진 일이라고 적혀 있습니다.",
    "게임에서 3판 2선승 중에 벌어진 일이라고 합니다.",
  ]) {
    assert.equal(validateWebCases([{ ...ok, quote }]).cases.length, 1, quote);
  }
});

test("shows one link once", () => {
  const { cases } = validateWebCases([ok, { ...ok, title: "다른 제목" }]);
  assert.equal(cases.length, 1);
});

test("stores a whole batch but hands a screen only what it asked for", () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ ...ok, url: `https://example.com/post/${index}` }));
  assert.equal(validateWebCases(many).cases.length, WEB_BATCH_SIZE);
  assert.equal(validateWebCases(many, { limit: 3 }).cases.length, 3);
});

test("drops a link the page itself does not answer for", async () => {
  // A json_schema response carries no search citations, so the page is the only
  // thing the url and title can be checked against.
  const pages = {
    "https://example.com/real": { ok: true, body: "<h1>게임하다 1대1채팅으로 패드립과 성드립을 들었습니다</h1>" },
    "https://example.com/gone": { ok: false, body: "" },
    "https://example.com/other": { ok: true, body: "<h1>중고차 구매 후기입니다</h1>" },
  };
  const fetchImpl = async (url) => {
    const page = pages[url];
    if (!page) throw new Error("network");
    return { ok: page.ok, text: async () => page.body };
  };

  const { cases, dropped } = await verifyWebCases({
    cases: ["real", "gone", "other", "missing"].map((name) => ({ ...ok, url: `https://example.com/${name}` })),
    fetchImpl,
  });
  assert.deepEqual(cases.map((item) => item.url), ["https://example.com/real"]);
  assert.deepEqual(dropped.sort(), ["unreachable", "unreachable", "unverified"]);
});

test("searches with the case reduced to tags, not the words the user wrote", () => {
  // A victim's own sentences describe a sex offence and name who was involved.
  // They do not go to a search engine.
  assert.equal(
    buildWebSearchQuery({ medium: "game_chat", expressionType: "insult_with_sexual_terms" }),
    "게임 채팅 성적 욕설 패드립 통매음 통신매체이용음란",
  );
  assert.equal(buildWebSearchQuery({}), "통매음 통신매체이용음란");
});

test("shows a post's title without the site's own tail", () => {
  // A model copying a title verbatim brings the whole <title> with it, and a
  // list of three is then mostly boilerplate.
  assert.equal(tidyTitle("통매음 관련 상담글 분석 및 해석 | 성폭력/강제추행 등 상담사례 | 로톡"), "통매음 관련 상담글 분석 및 해석");
  assert.equal(tidyTitle("피파통매음 질문이요 : 네이버 지식iN"), "피파통매음 질문이요");
  // A separator that belongs to the title itself stays.
  assert.equal(tidyTitle("롤 : 와일드리프트에서 통매음 당했습니다"), "롤 : 와일드리프트에서 통매음 당했습니다");
  assert.equal(
    tidyTitle("게임 중 상대방이 패드립을 한 경우 통신매체이용음란죄가 성립되나요?"),
    "게임 중 상대방이 패드립을 한 경우 통신매체이용음란죄가 성립되나요?",
  );
  assert.equal(validateWebCases([{ ...ok, title: "질문 있습니다 통매음 관련 | 로톡" }]).cases[0].title, "질문 있습니다 통매음 관련");
});

test("names every medium the rules can produce", () => {
  // A missing word does not fail loudly. The query simply goes out without a
  // medium and a bank-transfer memo case comes back holding game chat posts —
  // which is exactly what shipped for a day.
  for (const medium of WEB_MEDIUMS) {
    if (medium === "unknown") continue;
    const query = buildWebSearchQuery({ medium, expressionType: "sexual_text" });
    assert.notEqual(query, buildWebSearchQuery({ medium: "unknown", expressionType: "sexual_text" }), medium);
  }
});

test("carries the medium of a real complaint into its search", () => {
  const cases = [
    ["모르는 사람이 제 계좌로 1원씩 입금하면서 송금 메모에 성적인 욕설을 적었습니다.", "송금 메모"],
    ["집 문에 성적인 내용의 편지를 끼워 두고 갔습니다.", "편지 직접 전달"],
    ["롤 하다가 상대가 패드립을 쳤습니다.", "게임 채팅"],
  ];
  for (const [description, word] of cases) {
    assert.ok(buildWebSearchQuery(extractFactTags(description)).includes(word), description);
  }
});

test("puts the posts closest to the reader's facts first", () => {
  const cases = [
    { title: "다른 매체", medium: "kakao", expression: "insult_with_sexual_terms", writerRole: "unclear" },
    { title: "태그 없음", medium: "unknown", expression: "other", writerRole: "unclear" },
    { title: "같은 상황", medium: "game_chat", expression: "insult_with_sexual_terms", writerRole: "unclear" },
  ];
  const facts = { medium: "game_chat", expressionType: "insult_with_sexual_terms" };
  assert.equal(selectWebCases({ cases, facts, limit: 1 })[0].title, "같은 상황");
  // Fewer stored than asked for is not an error; the reader gets what there is.
  assert.equal(selectWebCases({ cases: cases.slice(1), facts, limit: 3 }).length, 2);
  assert.deepEqual(selectWebCases({ cases: [], facts }), []);
});

test("prefers a post written from the reader's side of the same event", () => {
  // The batch is shared by both sides of one situation, so the ordering is the
  // only thing that can tell them apart. It cannot invent what is not stored:
  // a one-sided batch leaves half the readers nothing, which is why the fetch
  // asks for a balanced mix.
  const cases = [
    { title: "신고당한 사람 글", medium: "game_chat", expression: "insult_with_sexual_terms", writerRole: "reported" },
    { title: "당한 사람 글", medium: "game_chat", expression: "insult_with_sexual_terms", writerRole: "victim" },
  ];
  const facts = { medium: "game_chat", expressionType: "insult_with_sexual_terms" };
  assert.equal(selectWebCases({ cases, facts, role: "victim", limit: 1 })[0].title, "당한 사람 글");
  assert.equal(selectWebCases({ cases, facts, role: "reported", limit: 1 })[0].title, "신고당한 사람 글");
  // With no role given the batch keeps the order the search returned.
  assert.equal(selectWebCases({ cases, facts, limit: 1 })[0].title, "신고당한 사람 글");
});

test("keeps the tags a stored post is labelled with, and defaults the rest", () => {
  const [item] = validateWebCases([{
    title: "게임 채팅 통매음 질문", url: "https://kin.naver.com/qna/detail.naver?docId=1",
    sourceType: "qna", quote: "게임 채팅으로 성적인 욕설을 들었다는 질문입니다.",
    medium: "game_chat", expression: "insult_with_sexual_terms", writerRole: "victim",
  }]).cases;
  assert.equal(item.medium, "game_chat");
  assert.equal(item.writerRole, "victim");

  const [bare] = validateWebCases([{ ...ok, writerRole: "정체불명" }]).cases;
  assert.equal(bare.medium, "unknown");
  assert.equal(bare.expression, "other");
  assert.equal(bare.writerRole, "unclear");
});

test("shows fewer posts rather than posts about a different medium", () => {
  // A bank transfer memo case has almost nothing written about it online, and
  // the batch filled up with game chat posts instead. Padding the list to three
  // is the web-section version of inventing a precedent.
  const cases = [
    { title: "게임 글", medium: "game_chat", expression: "insult_with_sexual_terms", writerRole: "victim" },
    { title: "SNS 글", medium: "sns_mention", expression: "insult_with_sexual_terms", writerRole: "victim" },
    { title: "태그 없는 글", medium: "unknown", expression: "insult_with_sexual_terms", writerRole: "victim" },
  ];
  const facts = { medium: "bank_transfer", expressionType: "insult_with_sexual_terms" };
  assert.deepEqual(selectWebCases({ cases, facts }).map((item) => item.title), ["태그 없는 글"]);

  // A reader whose own medium could not be read is not narrowed at all.
  assert.equal(selectWebCases({ cases, facts: { medium: "unknown", expressionType: "insult_with_sexual_terms" } }).length, 3);
});

test("does not open a page the site asked us not to", async () => {
  // A page we may not read is a page we cannot vouch for, and every link on
  // screen is one this server opened once. So it is dropped, not shown
  // unverified — and the fetch never goes out at all.
  const opened = [];
  const fetchImpl = async (url) => {
    opened.push(url);
    return { ok: true, text: async () => "<h1>게임하다 1대1채팅으로 패드립과 성드립을 들었습니다</h1>" };
  };
  const cases = [
    { ...ok, url: "https://www.lawtalk.co.kr/qna/193707" },
    { ...ok, url: "https://www.lawtalk.co.kr/terms-of-service/" },
  ];
  const result = await verifyWebCases({
    cases,
    fetchImpl,
    allowFetch: async ({ url }) => !url.includes("/terms-of-service/"),
  });
  assert.deepEqual(result.cases.map((item) => item.url), ["https://www.lawtalk.co.kr/qna/193707"]);
  assert.deepEqual(result.dropped, ["disallowed"]);
  assert.deepEqual(opened, ["https://www.lawtalk.co.kr/qna/193707"]);
});

test("tells the site who is asking", async () => {
  // The check used to send a Chrome string, which is not an answer to a site
  // that names individual bots in its robots.txt.
  let agent = null;
  await verifyWebCases({
    cases: [ok],
    allowFetch: async () => true,
    fetchImpl: async (url, options) => {
      agent = options?.headers?.["user-agent"];
      return { ok: true, text: async () => ok.title };
    },
  });
  assert.equal(agent, USER_AGENT);
  assert.equal(String(agent).toLowerCase().includes("mozilla"), false);
});

test("keeps one copy of the vocabulary the screen and the server share", async () => {
  // The source types were written out three times and the display count twice,
  // as 3 on the server and 6 in the browser. Neither had gone wrong yet, but a
  // number kept in two places is one that gets changed in one.
  const vocab = await import("../src/lib/web-case-vocab.js");
  assert.equal(WEB_SOURCE_TYPES, vocab.WEB_SOURCE_TYPES, "서버가 자기 목록을 따로 들고 있습니다");
  assert.equal(WEB_CASE_DISPLAY_LIMIT, vocab.WEB_CASE_DISPLAY_LIMIT);

  // Every type the model may return has a Korean label, or a source arrives
  // with nothing to show for it.
  for (const type of vocab.WEB_SOURCE_TYPES) {
    assert.equal(typeof vocab.WEB_SOURCE_TYPE_LABEL[type], "string", type);
  }
  assert.equal(Object.keys(vocab.WEB_SOURCE_TYPE_LABEL).length, vocab.WEB_SOURCE_TYPES.length);

  // The batch has to stay larger than the display, or picking per reader does
  // nothing at all.
  assert.ok(WEB_BATCH_SIZE > vocab.WEB_CASE_DISPLAY_LIMIT);
});
