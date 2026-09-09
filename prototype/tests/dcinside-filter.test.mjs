import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  hasCommunityVoice, hasEnding, hunterSituation, isMarketingPost, isStatuteRecital, screenPost,
} from "../server/dcinside-filter.mjs";

const fixture = JSON.parse(readFileSync(new URL("../server/fixtures/dcinside-posts.json", import.meta.url), "utf8"));
const labelled = (label) => fixture.posts.filter((post) => post.label === label);

test("keeps the posts a person read as endings, and nothing else", () => {
  // The whole justification for reading a gallery is that Lawtalk's posts stop
  // at the question. So the bar is an ending, and this is the measurement of
  // whether the rules and a person agree about which posts have one. 48 posts
  // were read and labelled by hand; if this number moves, one of the two
  // changed its mind and it was not the person.
  const kept = fixture.posts.filter((post) => screenPost(post).keep);
  assert.deepEqual(
    [...new Set(kept.map((post) => post.label))],
    ["ending"],
    "결말이 아닌 글이 통과했습니다",
  );
  assert.equal(kept.length, labelled("ending").length, "결말 있는 글을 놓쳤습니다");
});

test("names why it dropped a post rather than dropping it silently", () => {
  // The refresh counts these. A batch that suddenly drops everything for one
  // reason is how we find out the site changed shape under us.
  const reasons = new Set();
  for (const post of fixture.posts) {
    const { keep, reason } = screenPost(post);
    if (!keep) reasons.add(reason);
  }
  for (const expected of ["marketing", "recital", "noEnding"]) {
    assert.equal(reasons.has(expected), true, `${expected} 사유가 쓰이지 않았습니다`);
  }
});

test("catches a law firm's post even when it narrates in the past tense", () => {
  // "과거 통매음으로 벌금형을 2차례 받았음에도" sits in the middle of the
  // clearest marketing post in the batch. The first version of this filter
  // counted 받았음 as a community voice and let the post through on it.
  const firm = {
    title: "통매음 단순 벌금형으로 끝날 줄 알았는데 징역형 집행유예 나옴",
    body: "통신매체이용음란죄의 처벌 수위와 법원의 판단 기준을 알기 쉽게 정리해 드립니다."
      + "사건 핵심 요약 과거 통매음으로 벌금형을 2차례 받았음에도 동종 범행을 다시 저질렀습니다.",
    url: "https://gall.dcinside.com/mgallery/board/view/?id=lawqa&no=1",
  };
  assert.equal(isMarketingPost(firm), true);
  assert.equal(screenPost(firm).reason, "marketing");
});

test("catches an answer written in the polite explaining register with nothing else to give it away", () => {
  // No firm named, no statute quoted, no call to action — just a counsellor's
  // reply pasted into a gallery. It was the one marketing post in the sample
  // that carried no other signal at all.
  const advice = {
    title: "성생활을 동의 없이 유포한 것은 단순한 뒷담화가 아닙니다",
    body: "성생활을 동의 없이 유포한 것은 성폭력 범죄에 해당할 수 있습니다."
      + " 얼굴을 숨기고 접근하는 것은 협박이나 스토킹과 다름없어요."
      + " 재회를 종용하는 것은 피해자를 공포에 빠뜨리는 일입니다.",
    url: "https://gall.dcinside.com/board/view/?id=divination_new1&no=1",
  };
  assert.equal(isMarketingPost(advice), true);
});

test("a line of the reader's own does not turn a pasted statute into an account", () => {
  // Two posts in the sample paste Article 13 and add a line of their own. One
  // was labelled a firm's work and the other a person's, which was a
  // distinction that could not be drawn — neither is anybody's experience, and
  // that is the only thing this source is here to supply.
  const recital = {
    title: "통매음 이거만 봐도 절대 안됨ㅇㅇ",
    body: "제13조(통신매체를 이용한 음란행위) 자기 또는 다른 사람의 성적 욕망을 유발하거나"
      + " 만족시킬 목적으로 전화, 우편, 컴퓨터, 그 밖의 통신매체를 통하여 성적 수치심이나"
      + " 혐오감을 일으키는 말, 음향, 글, 그림, 영상 또는 물건을 상대방에게 도달하게 한 사람은",
    url: "https://gall.dcinside.com/board/view/?id=politicyoutube&no=1",
  };
  assert.equal(hasCommunityVoice(recital), false, "제목이 아니라 본문을 읽어야 합니다");
  assert.equal(isStatuteRecital(recital), true);
  assert.equal(screenPost(recital).reason, "recital");
});

test("rescues a person's advice that cites a case number", () => {
  // The best advice post in the sample quotes 대법원 2022도10688. Reading a case
  // number as a mark of a professional would have thrown it away.
  const advice = {
    title: "통매음 불송치시 대응방안 판례를 기반으로.",
    body: "불송치 이유확인 하나마나 헛소리니까 이의신청 부터 가고 그다음 정보 공개로 받고,"
      + " 대법원 2022도10688 성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)"
      + " 귀찮아서 불송치 때리고 시작하는거임",
    url: "https://gall.dcinside.com/mini/board/view/?id=tongtong&no=1",
  };
  assert.equal(isMarketingPost(advice), false);
  assert.equal(isStatuteRecital(advice), false);
});

test("reads a stage as a stage, not as an ending", () => {
  // 송치 and 고소당함 are places in the process, not results. Counting the noun
  // alone read a fifth of the sample as endings that a person had read as
  // questions — someone mid-process asking what comes next.
  assert.equal(hasEnding({ title: "통매음 합의 질문함", body: "송치전에 합의하는게 맞음 원래? 송치가 안될수도있으니까" }), false);
  assert.equal(hasEnding({ title: "통매음 고소당했는데 불송치 가능할까요 ?", body: "상대방은 전혀 채팅도 안했음 그냥 나혼자 똥꼬쇼함" }), false);
});

test("finds an ending packed into a line, or left in the title", () => {
  // A gallery writes short. Requiring 60 characters of body threw away four of
  // the ten endings in the sample, including one that runs from the appeal to
  // the Supreme Court in 46 characters.
  const short = {
    title: "통매음 불송치 된거 이의신청해서 검찰갔는데 불기소처분된거",
    body: "재항고 했는데 또기각 당하고대법원 까지 감대법관 이 이유없으므로 기각한다고 끝임ㄷㄷㄷㄷ",
    url: "https://gall.dcinside.com/mini/board/view/?id=tongtong&no=2",
  };
  assert.equal(screenPost(short).keep, true);

  const titleOnly = {
    title: "마구샵님 전 통신매체이용음란 벌금 400 벌써 다냇는데",
    body: "ㅇ왜이렇게 못내세요 ㅋㅋ",
    url: "https://gall.dcinside.com/board/view/?id=loan_new1&no=1",
  };
  assert.equal(screenPost(titleOnly).keep, true);
});

test("drops the gallery's own house ads", () => {
  // These arrive in the listing alongside real posts.
  const ad = {
    title: "디시인사이드 회원들을 위한 내 보험 정밀진단[무료]",
    body: "보험상담은 디시공식설계사에게 받으세요!",
    url: "https://gall.dcinside.com/board/view/?id=tongtong&no=3",
  };
  assert.equal(isMarketingPost(ad), true);
});

test("drops a post whose whole body is a law firm's link", () => {
  const link = {
    title: "통매음",
    body: "https://www.daeryunlaw-assault.com/lawInfo_new/2520",
    url: "https://gall.dcinside.com/board/view/?id=olympic&no=1",
  };
  assert.equal(isMarketingPost(link), true);
});

test("refuses anything that is not shaped like a post", () => {
  for (const bad of [null, undefined, "post", 42, {}, { title: "제목만" }, { url: "https://example.com" }]) {
    assert.equal(screenPost(bad).keep, false);
  }
});

test("reads a question about an ending as a question", () => {
  // Tuning on the labelled sample alone did not surface this. Running the
  // collector on two queries that were not in it did — three of seven kept
  // posts were false positives, all of them asking rather than telling.
  assert.equal(hasEnding({
    title: "통매음 조사",
    body: "피고소인신분으로 가게되면, 첫 조사부터 합의의사 밝혀서 합의진행한다고 하면 언제쯤 사건종결됨?",
  }), false);
  // The question mark is the evidence, so the clause split has to keep it. A
  // split that consumed it read this as an ending because 사건종결 was in it.
  assert.equal(hasEnding({ title: "질문", body: "이거 불송치 처분 나옴?" }), false);
});

test("does not read commentary on case law as somebody's own ending", () => {
  assert.equal(hasEnding({
    title: "겜 매음 벌금 받은 애들 특징이",
    body: "판례보면 꼭 피의자가 합의 봤다거나 죄를 시인하고 반성했다거나 이렇게 써있다니깐 ㅋㅋㅋ",
  }), false);
});

test("does not offer somebody else's ending as this post's ending", () => {
  // Both posts that survived the first clause fix were this: a writer still
  // waiting on their own case, reporting how it went for a friend. A reader who
  // opens one finds a case that is not the one the title promised.
  assert.equal(hasEnding({
    title: "통매음 조사 ㅠㅠ",
    body: "연락 안오는데 이렇게 오래걸리나요?? 같이 신고당한 친구는 2주만에 연락와서 조사 다 받고 불송치 떴는데ㅠㅠ",
  }), false);
  assert.equal(hasEnding({
    title: "통매음 합의금 질문",
    body: "고소먹음 변호사랑 통화해보니깐 피해자는 합의의지 없다하고 다른사람은 얼마에 합의했냐 물으니 300만원에 했다는데 이제 어캄?",
  }), false);
  // The writer's own ending still counts when a third party is merely nearby.
  assert.equal(hasEnding({
    title: "후기",
    body: "친구가 알려준 대로 진술했음. 나는 결국 불송치 뜸",
  }), true);
});

test("finds the baiting posts by the word the galleries use for it", () => {
  // Measured: across 56 posts, not one was identifiable from the surrounding
  // circumstances — random chat, moving apps, the threat, the money — without
  // 헌터 also appearing. Inferring the situation from prose was not something
  // the data would carry.
  assert.equal(hunterSituation({ title: "통매음 헌터에게 걸렸을때", body: "랜덤채팅에서 라인으로 유도한다" }), true);
  assert.equal(hunterSituation({ title: "통매음 불송치 후기", body: "조사 받고 불송치 뜸" }), false);
});

test("does not let a long address stand in for a post", () => {
  // "롤매음 고소 후기 (진행중 2)" cleared the length floor on a 90-character
  // gallery URL alone. The model summarising it was the one that noticed: 이
  // 글에는 이전 게시물로 연결되는 링크만 있으며, 구체적인 내용은 적혀 있지 않다.
  const pointer = {
    title: "롤매음 고소 후기 (진행중 2)",
    body: "일단 첫번째 글 링크 달아놓음 https://gall.dcinside.com/mini/board/view/?id=tongtong&no=425344&exception_mode=recommend&page=1",
    url: "https://gall.dcinside.com/mini/board/view/?id=tongtong&no=9",
  };
  assert.equal(screenPost(pointer).reason, "thin");
});
