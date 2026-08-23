import assert from "node:assert/strict";
import test from "node:test";
import { buildWebSearchQuery, tidyTitle, validateWebCases, verifyWebCases } from "../server/web-cases.mjs";

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

test("shows at most six", () => {
  const many = Array.from({ length: 10 }, (_, index) => ({ ...ok, url: `https://example.com/post/${index}` }));
  assert.equal(validateWebCases(many).cases.length, 6);
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
