import { rankPrecedents } from "./search.js";
import { VERIFIED_PRECEDENTS } from "./precedents.js";

/**
 * The script the 이용 안내 tour plays.
 *
 * Everything here is data. The tour renders the real composer and the real
 * result deck and drives them with these values, so the screens a reader
 * watches are the screens they will meet — not a drawing of them.
 *
 * Two example cases, chosen to be opposites:
 *
 *   thorough — every fact the rules look for is present, so the server has
 *              nothing to ask and the search runs straight through.
 *   sparse   — one line. Three facts are missing, which is the most the intake
 *              will ask about, so the follow-up panel fills up.
 *
 * Neither is invented to flatter the product: both are run through the real
 * extraction rules in tests/guide-script.test.mjs, and if the rules change so
 * that the questions no longer match, that test fails rather than the tour
 * quietly teaching something untrue. The same is done for the statute reading,
 * the analysis and the web post below — each is checked against the very
 * function the live pipeline uses on a model's answer.
 */

export const GUIDE_EXAMPLES = Object.freeze({
  // The masked slur is how a published judgment prints one, and the extraction
  // rules are built to read it that way (ㅇ미 is in SEXUAL_SLUR_TERMS). So this
  // one sentence also teaches that quoting what was said is allowed, and that
  // masking it does not cost the reader their search.
  thorough: Object.freeze({
    role: "victim",
    description:
      "어제 온라인 게임에서 같은 팀이던 사람과 다투다가, 게임 채팅으로 「니 ㅇ미가…」 처럼 제 어머니를 성적으로 비하하는 욕설을 여러 번 받았습니다. 알림으로 바로 확인했습니다.",
  }),
  sparse: Object.freeze({
    role: "victim",
    description: "카톡으로 성적인 욕을 들었어요.",
  }),
});

/**
 * What the server asks about the sparse example.
 *
 * Copied rather than imported: the browser bundle has no business reaching into
 * server/. The test asserts these are exactly what buildIntakeQuestions returns
 * for that text, which is the guarantee that matters.
 */
export const GUIDE_INTAKE_QUESTIONS = Object.freeze([
  {
    id: "reachedRecipient",
    field: "reachedRecipient",
    prompt: "그 내용이 실제로 회원님에게 도착했나요?",
    hint: "예: 알림으로 받았다 · 나중에 찾아서 봤다 · 못 봤다",
  },
  {
    id: "relationship",
    field: "relationship",
    prompt: "상대와는 어떤 사이인가요?",
    hint: "예: 모르는 사람 · 지인 · 같은 게임 이용자",
  },
  {
    id: "repetition",
    field: "repetition",
    prompt: "한 번이었나요, 여러 번이었나요?",
    hint: "예: 한 번 · 여러 번",
  },
]);

export const GUIDE_INTAKE_ANSWERS = Object.freeze({
  reachedRecipient: "알림으로 바로 받았습니다",
  relationship: "게임에서 알게 된 사람입니다",
  repetition: "여러 번이었습니다",
});

export const GUIDE_ANSWER_ORDER = Object.freeze(GUIDE_INTAKE_QUESTIONS.map((question) => question.id));

export const GUIDE_ANSWER_LENGTH = GUIDE_ANSWER_ORDER
  .reduce((total, id) => total + (GUIDE_INTAKE_ANSWERS[id] || "").length, 0);

/** Fills the answer boxes in order, so they type one after another. */
export function sliceGuideAnswers(count) {
  const typed = {};
  let left = Math.max(0, count);
  for (const id of GUIDE_ANSWER_ORDER) {
    const text = GUIDE_INTAKE_ANSWERS[id] || "";
    const take = Math.min(text.length, left);
    typed[id] = text.slice(0, take);
    left -= take;
  }
  return typed;
}

/**
 * The example result, produced by the real ranking function.
 *
 * No score in this file is written by hand. The tour shows what the algorithm
 * actually returns for the thorough example, against the curated precedents —
 * so a card on the guide screen can never cite a case that does not exist, and
 * the 닮은 점 / 다른 점 lists are the ones the comparison really computed.
 *
 * It ranks against the six curated records rather than the database, so the
 * numbers differ from a live search of the same words. The stage says so, and
 * so does the step that points at them.
 */
let cachedResults = null;

export function guideResults() {
  if (!cachedResults) cachedResults = rankPrecedents({ description: GUIDE_EXAMPLES.thorough.description });
  return cachedResults;
}

export const GUIDE_AVAILABLE_COUNT = VERIFIED_PRECEDENTS.length;

/**
 * The article, quoted. Its four clauses are the four statuteQuote strings in
 * server/statute-elements.mjs joined back together, which a test checks — so
 * the law on the guide screen cannot drift from the law the product reads.
 */
export const GUIDE_STATUTE = Object.freeze({
  lawName: "성폭력범죄의 처벌 등에 관한 특례법",
  articleTitle: "통신매체를 이용한 음란행위",
  body: "제13조(통신매체를 이용한 음란행위) 자기 또는 다른 사람의 성적 욕망을 유발하거나 만족시킬 목적으로 "
    + "전화, 우편, 컴퓨터, 그 밖의 통신매체를 통하여 성적 수치심이나 혐오감을 일으키는 말, 음향, 글, 그림, 영상 또는 물건을 "
    + "상대방에게 도달하게 한 사람은 2년 이하의 징역 또는 2천만원 이하의 벌금에 처한다.",
  enforcedOn: "2025-10-01",
  officialUrl: "https://www.law.go.kr/법령/성폭력범죄의처벌등에관한특례법/제13조",
});

/**
 * The four verdicts, as the rules produce them for the thorough example.
 *
 * Not written by hand: a test asserts this equals mapFactsToArticle13 run on
 * that example's extracted facts. Three read as present and one as unclear,
 * which is the honest result and the point of the step — whether an element is
 * *satisfied* is not something this service reports at all.
 */
export const GUIDE_ELEMENTS = Object.freeze([
  {
    id: "purpose",
    label: "성적 욕망을 유발하거나 만족시킬 목적",
    statuteQuote: "자기 또는 다른 사람의 성적 욕망을 유발하거나 만족시킬 목적으로",
    mention: "unclear",
    evidence: "입력만으로는 알 수 없는 요건입니다. 법원이 여러 사정을 종합해 판단합니다.",
    quote: null,
  },
  {
    id: "medium",
    label: "통신매체를 통한 전달",
    statuteQuote: "전화, 우편, 컴퓨터, 그 밖의 통신매체를 통하여",
    mention: "present",
    evidence: "입력에서 게임 채팅을 확인했습니다.",
    quote: "어제 온라인 게임에서 같은 팀이던 사람과 다투다가",
  },
  {
    id: "expression",
    label: "성적 수치심이나 혐오감을 일으키는 표현",
    statuteQuote: "성적 수치심이나 혐오감을 일으키는 말, 음향, 글, 그림, 영상 또는 물건을",
    mention: "present",
    evidence: "입력에서 성적인 비하·욕설 표현을 확인했습니다.",
    quote: "게임 채팅으로 「니 ㅇ미가…」 처럼 제 어머니를 성적으로 비하하는 욕설을 여러 번 받았습니다",
  },
  {
    id: "reached",
    label: "상대방에게 도달",
    statuteQuote: "상대방에게 도달하게 한",
    mention: "present",
    // Worded for the side this example is written from. 상대방 in the article
    // means whoever the message reached, which is the reader here, so naming
    // 상대방 told a victim that the sender was the one who saw it.
    evidence: "입력에서 회원님이 그 내용을 확인하셨다는 언급을 찾았습니다.",
    quote: "게임 채팅으로 「니 ㅇ미가…」 처럼 제 어머니를 성적으로 비하하는 욕설을 여러 번 받았습니다",
  },
]);

/**
 * Example wording for the generated half of the result.
 *
 * These sentences were written for this tour rather than returned by a model —
 * the stored response the product ships with was captured for a different case
 * (an Instagram message and a photograph) and would describe something the
 * example never says. They are held to the live standard instead: a test runs
 * them through validateGroundedAnalysis, the same censor a real model answer
 * passes through, so a sentence that decided the reader's case would be dropped
 * there and fail the test rather than reach the screen.
 */
export const GUIDE_ANALYSIS = Object.freeze({
  overview: Object.freeze([
    "이 조항은 통신수단을 거쳐 성적 수치심이나 혐오감을 일으키는 표현이 상대에게 전달된 경우를 다루며, 표현의 내용만이 아니라 대화가 오간 앞뒤 맥락과 전달 경위를 함께 봅니다.",
    "적어주신 내용에는 게임 채팅이라는 전달 수단, 다툼이 있던 정황, 성적인 비하 표현, 알림으로 확인했다는 전달 경위가 모두 담겨 있습니다.",
    "다만 보낸 사람의 의도는 적어주신 문장만으로 읽어낼 수 있는 것이 아니어서, 아래 네 항목 가운데 목적 항목은 확인되지 않은 상태로 두었습니다.",
  ]),
  elementNotes: Object.freeze([
    {
      id: "purpose",
      text: "‘성적 욕망을 유발하거나 만족시킬 목적’은 보낸 사람이 성적 욕망을 일으키거나 만족시키려는 의도로 그 표현을 보냈는지를 가리킵니다. 겉으로 드러난 문구만이 아니라 대화가 시작된 경위, 앞뒤 메시지, 반복된 정도를 함께 놓고 법원이 살피는 부분이라, 적어주신 문장만으로는 가늠하기 어렵습니다.",
    },
    {
      id: "medium",
      text: "‘전화, 우편, 컴퓨터, 그 밖의 통신매체를 통하여’는 얼굴을 맞대고 건넨 말이 아니라 전화·문자·메신저·게임 채팅처럼 통신수단을 거쳐 내용이 오간 경우를 가리킵니다. 게임 안의 채팅창도 이런 전달 수단에 속하는 방식입니다.",
    },
    {
      id: "expression",
      text: "‘성적 수치심이나 혐오감을 일으키는 말, 음향, 글, 그림, 영상 또는 물건’은 성적인 내용 때문에 상대에게 수치심이나 혐오감을 일으킬 수 있는 표현물을 가리킵니다. 적어주신 내용에는 어머니를 성적으로 비하하는 욕설이 오갔다고 적혀 있습니다.",
    },
    {
      id: "reached",
      text: "‘상대방에게 도달하게 한’은 메시지가 쓰이거나 보내려고 시도된 데 그치지 않고 상대의 계정이나 기기로 실제 전달된 상태를 가리킵니다. 알림으로 바로 확인했다는 정황은 전달 여부를 살피는 자료가 됩니다.",
    },
  ]),
  precedentNotes: Object.freeze([
    {
      caseNumber: "2023도17539",
      text: "게임에서 알게 된 상대와 다툼이 있은 뒤 성적 욕설이 오간 사안으로 다뤄진 판례입니다. 다만 전달 수단과 횟수가 적어주신 내용과 달라, 그대로 견주기는 어렵습니다.",
    },
    {
      caseNumber: "2018도9775",
      text: "성적 욕망에는 상대를 성적으로 비하하거나 조롱해 심리적 만족을 얻으려는 욕망도 포함될 수 있다고 설명한 판례입니다.",
    },
  ]),
  nextSteps: Object.freeze([
    "게임 채팅 기록과 알림 화면을 원본 그대로 보관하세요. 캡처는 자르지 말고 시각과 상대 계정이 함께 보이도록 남기는 편이 좋습니다.",
    "기억이 흐려지기 전에 대화가 시작된 시점부터 끝난 시점까지의 순서를 날짜와 시간 중심으로 정리해두세요.",
    "게임 회사의 신고 기능으로 남긴 기록이 있다면 접수 번호와 회신 내용도 함께 보관하세요.",
    "상대의 추가 연락이 있으면 그 내용도 지우지 말고 따로 기록해두세요.",
  ]),
});

/**
 * One post, not three.
 *
 * This is the record tests/web-cases.test.mjs already uses as its representative
 * real item, and it happens to describe the thorough example almost exactly. A
 * panel whose own warning says the server checked each address is no place to
 * pad the list out with URLs nobody has checked.
 */
export const GUIDE_WEB_CASES = Object.freeze([
  Object.freeze({
    title: "게임하다 1대1채팅으로 패드립과 성드립을 들었습니다",
    url: "https://www.lawtalk.co.kr/qna/193707",
    sourceType: "lawyer_qna",
    quote: "게임에서 1대1 채팅으로 성적인 욕설을 들었다며 고소 가능성을 물은 질문입니다.",
  }),
]);

/**
 * Each step names what to light up and what the stage should be showing while
 * it is lit. `target` is a selector inside the stage — several are lit as one
 * rectangle covering them all, and `null` lights nothing, showing the screen
 * whole. `deck` is which of the four result screens is open.
 */
export const GUIDE_STEPS = Object.freeze([
  {
    id: "start",
    title: "여기서 시작합니다",
    body: "사례를 적는 화면 하나가 전부입니다. 회원가입도, 로그인도 없습니다.",
    target: null,
    scene: "composer",
    example: "thorough",
    role: "",
    description: "none",
  },
  {
    id: "role",
    title: "어느 쪽 입장인지 먼저 골라주세요",
    body: "피해자와 피신고인 중 하나를 고르시면 이어지는 질문이 회원님 입장에 맞는 말로 바뀝니다. 어느 쪽을 고르셔도 유사도는 똑같이 계산됩니다.",
    target: ".role-segment",
    scene: "composer",
    example: "thorough",
    role: "victim",
    description: "none",
  },
  {
    id: "describe",
    title: "있었던 일을 시간 순서대로 적어주세요",
    body: "어떤 매체로, 어떤 사이인 사람과, 어떤 말이 몇 번 오갔는지가 들어가면 가장 잘 찾습니다. 오간 말은 그대로 옮겨 적으셔도 되고, 보시는 것처럼 가려 적으셔도 됩니다.",
    target: ".composer textarea",
    scene: "composer",
    example: "thorough",
    role: "victim",
    description: "typing",
  },
  {
    id: "submit",
    title: "15자부터 검색할 수 있습니다",
    body: "입장을 고르고 15자 이상 적으시면 오른쪽 버튼이 켜집니다. 최대 2,000자까지 쓰실 수 있습니다.",
    target: ".submit-area",
    scene: "composer",
    example: "thorough",
    role: "victim",
    description: "full",
  },
  {
    id: "consent",
    title: "AI 분석은 직접 켜셔야 합니다",
    body: "이 칸은 처음에 꺼져 있습니다. 켜시면 이름과 연락처를 가린 문장이 외부 AI로 전달되어 법조문 정리와 비슷한 사례까지 보실 수 있고, 끄신 채로도 판례 검색은 그대로 됩니다.",
    target: ".embedding-consent",
    scene: "composer",
    example: "thorough",
    role: "victim",
    description: "full",
    consent: true,
  },
  {
    id: "sparse",
    title: "한 줄만 적으셔도 됩니다",
    body: "이렇게 짧게 적으셔도 검색은 시작됩니다. 대신 저희가 읽어내지 못한 것을 다음 화면에서 여쭙습니다.",
    target: ".composer textarea",
    scene: "composer",
    example: "sparse",
    role: "victim",
    description: "typing",
  },
  {
    id: "questions",
    title: "못 읽어낸 것만 여쭙습니다",
    body: "적어주신 내용에서 확인되지 않은 것만 최대 3개까지 물어봅니다. 모르시는 항목은 비워두고 넘어가셔도 됩니다.",
    target: ".intake-questions",
    scene: "composer",
    example: "sparse",
    role: "victim",
    description: "full",
    questions: true,
    answers: "typing",
  },
  {
    id: "searching",
    title: "검색하는 동안 하는 일",
    body: "이름과 연락처를 먼저 가린 뒤, 검증된 공개 판례와 하나씩 비교합니다. 보통 1~2초, AI 분석까지는 10초쯤 걸립니다.",
    target: ".search-progress",
    scene: "composer",
    example: "sparse",
    role: "victim",
    description: "full",
    searching: true,
  },
  {
    id: "score",
    title: "숫자는 사실관계가 얼마나 닮았는지입니다",
    body: "의미 45 + 사실 태그 45 + 쟁점 10을 더한 점수입니다. 법적인 결론이나 형량과는 관계가 없습니다. 이 화면의 숫자는 예시 데이터로 계산한 값입니다.",
    target: [".score-ring", ".score-breakdown"],
    scene: "results",
    results: "deck",
    deck: 0,
  },
  {
    id: "compare",
    title: "어디가 닮았고 어디가 다른지",
    body: "왼쪽은 회원님이 적어주신 사실과 판례가 겹치는 부분, 오른쪽은 서로 다른 부분입니다. 다른 점이 많을수록 그대로 견주기 어려운 판례입니다.",
    target: ".comparison-grid",
    scene: "results",
    results: "deck",
    deck: 0,
  },
  {
    id: "summary",
    title: "요약 옆에는 근거 위치가 붙습니다",
    body: "AI가 쓴 요약이지만, 각 문장이 판결문의 어느 부분에서 나왔는지 함께 표시됩니다. 아래 링크로 국가법령정보센터 원문을 직접 확인하실 수 있습니다.",
    target: [".summary-box", ".card-actions"],
    scene: "results",
    results: "deck",
    deck: 0,
  },
  {
    id: "deck",
    title: "판례가 끝이 아닙니다",
    body: "이 화살표를 누르면 법조문 정리와 AI 설명, 비슷한 처지의 글로 이어집니다. 네 화면 모두 같은 검색 하나에서 나온 것입니다.",
    target: ".deck-arrow.is-next",
    scene: "results",
    results: "deck",
    deck: 0,
  },
  {
    id: "statute",
    title: "조문을 그대로 놓고 하나씩 맞춰봅니다",
    body: "법 조문을 원문 그대로 인용한 뒤, 네 가지 요건 각각에 대해 회원님이 적은 내용에 그 이야기가 나왔는지만 표시합니다. 요건이 실제로 충족되는지는 증거를 보고 법원이 판단합니다.",
    target: [".statute-body", ".element-list"],
    scene: "results",
    results: "deck",
    deck: 1,
  },
  {
    id: "analysis",
    title: "AI가 정리한 부분은 따로 표시됩니다",
    body: "이 화면의 문장은 AI가 쓴 설명이고, 앞의 판례 화면은 기록입니다. 성격이 다르므로 화면을 나눠 두었습니다.",
    target: ".analysis-card",
    scene: "results",
    results: "deck",
    deck: 2,
  },
  {
    id: "web",
    title: "비슷한 처지의 글도 모아드립니다",
    body: "다만 개인이 인터넷에 쓴 글이라 법적으로 정확하지 않을 수 있습니다. 서버가 각 주소에 실제로 접속해 살아 있는 글만 남기지만, 판단의 근거로는 삼지 마세요.",
    target: ".web-cases",
    scene: "results",
    results: "deck",
    deck: 3,
  },
  {
    id: "empty",
    title: "닮은 판례가 없으면 없다고 말씀드립니다",
    body: "기준에 못 미치면 비슷해 보이는 판례를 억지로 만들어 보여드리지 않습니다. 사례를 조금 더 자세히 적어 다시 검색해보세요.",
    target: ".empty-results",
    scene: "results",
    results: "empty",
  },
]);

/**
 * How long a step holds before the tour moves on, in milliseconds.
 *
 * Halfway between the first pass at 5,200 — long enough that a reader waited on
 * it — and the second at 2,400, where the 620ms push-in ate a quarter of every
 * step and the whole thing felt hurried.
 */
export const GUIDE_STEP_DWELL = 3800;

/** Milliseconds per character while a line is being typed. */
export const GUIDE_TYPING_SPEED = 31;

export function guideStepDuration(step) {
  if (step.description === "typing") {
    const text = GUIDE_EXAMPLES[step.example]?.description || "";
    return text.length * GUIDE_TYPING_SPEED + GUIDE_STEP_DWELL;
  }
  if (step.answers === "typing") return GUIDE_ANSWER_LENGTH * GUIDE_TYPING_SPEED + GUIDE_STEP_DWELL;
  return GUIDE_STEP_DWELL;
}
