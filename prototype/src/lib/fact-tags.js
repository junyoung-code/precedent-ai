export const FACT_TAG_EXTRACTION_VERSION = "rule-v2";

const UNKNOWN_VALUES = new Set([undefined, null, "", "unknown", "other"]);

// Drawn from how people actually name these things in public legal Q&A: the
// Korean spelling of DM, the games by their short names, and the misspelling of
// 메시지 that turns up constantly. A medium the rules cannot read costs the 45%
// fact-tag term even when the complaint is otherwise understood.
const MEDIUM_RULES = [
  ["bank_transfer", ["송금", "계좌", "이체", "1원"]],
  ["kakao", ["카카오", "카톡", "오픈채팅"]],
  ["sns_mention", ["트위터", "sns", "멘션", "인스타", "페이스북", "dm", "디엠", "틱톡", "트윗"]],
  ["game_chat", [
    "게임", "채팅창", "겜", "귓속말", "인게임",
    "리그오브레전드", "리그 오브", "배틀그라운드", "배그", "오버워치", "옵치",
    "메이플", "발로란트", "로스트아크", "서든어택",
  ]],
  ["direct_delivery", ["편지", "출입문", "문에 끼워"]],
  ["digital_message", ["문자", "메시지", "메세지", "메신저"]],
];

// 롤 is the name half the game complaints use and also a fragment of 컨트롤,
// 스크롤, 트롤, 롤러 and 롤케이크, so it needs a boundary a substring cannot give.
const MEDIUM_PATTERNS = [["game_chat", /(?<![트크])롤(?!러|케|모|링)/u]];

const SCALAR_FIELDS = [
  "medium",
  "messageForm",
  "recipientIdentification",
  "reachedRecipient",
  "relationship",
  "context",
  "expressionType",
  "repetition",
];

// The statute's vocabulary, which is how a judgment describes the expression.
const SEXUAL_SUBJECT_TERMS = [
  "성적", "음란", "야한", "나체", "성기", "성관계",
  // Someone who names the offence is describing this, whatever words follow.
  "통매음", "겜매음",
];

// The forms the statute lists as pictures, kept beside the other vocabularies
// so the denial scan reads the same words the extraction does.
const IMAGE_TERMS = ["사진", "이미지", "영상", "동영상", "나체"];

// What people actually write. Nobody reports being sent "성적인 표현"; they quote
// what was said, and the judgments in this repository quote the same words back
// — "니꼬추 3cm", "○○ 씹새끼", "니 ㅇ미가 …". Reading only the first list drops a
// real complaint out of scope for using the words it happened in.
const SEXUAL_SLUR_TERMS = [
  "패드립", "니애미", "니애비", "애미", "니미", "느금마", "느개비", "ㅇ미",
  "보지", "자지", "좆", "꼬추", "씹새", "씹년", "씹할", "젖가슴", "젖탱",
  "따먹", "강간", "성폭행", "자위", "야동",
  "걸레년", "걸레같", "창녀", "섹스", "섹시", "야설", "음담패설", "변태", "몸캠", "딸딸이",
  // What people call it when they are describing what they said, not quoting it.
  "성드립", "야한말", "야한 말", "성희롱",
];

// Arrival, denied outright. Only phrases about the message not getting there —
// nothing here is about whether the reader looked at it.
const NOT_DELIVERED_TERMS = [
  "도달하지", "전송하지", "보내지 않", "전달되지 않", "도착하지 않", "가지 않",
  "차단되어", "차단돼서", "차단당해", "받지 못", "받지 않", "못 받",
];

// Not the same thing, and the statute cares about the difference: a message can
// arrive and go unread. "차단해둬서 못 봤어요" answers neither question, so it
// stops the guess instead of making the opposite one.
const NOT_READ_TERMS = [
  "못 봤", "못 보", "보지 못", "안 봤", "읽지 않", "읽지 못", "안 읽",
  "확인하지 못", "확인 못", "나중에 알", "나중에 봤",
];

// Arrival, in the words people report it with. 메시지 used to be on this list
// and is not any more: it names a thing, not an event, so "메시지가 왔다는데 못
// 봤어요" was read back to the reader as them confirming they had seen it.
const DELIVERED_TERMS = ["받았", "받은", "보냈", "전송", "전달", "도달", "멘션", "송금", "게시"];

/**
 * Whether the description denies an element instead of reporting one.
 *
 * The rules match their vocabulary as substrings, so a term inside a denial
 * reads exactly like one inside an account: "성적인 말을 한 적이 없습니다"
 * contains 성적 and came back as 입력에 언급됨. What follows is deliberately
 * narrow. A denial this misses leaves the element unclear, which is the honest
 * answer anyway; a denial this invents tells readers they denied something they
 * never denied, which is the failure worth avoiding.
 */
const DENIAL_PATTERNS = [
  /(?:한|했던|보낸|쓴|말한|올린|건넨)\s*적(?:이|은|도)?\s*없/,
  /(?:하지|보내지|쓰지|말하지|올리지|전하지)\s*(?:는|도)?\s*않/,
  // 아니면 states a condition rather than denying anything.
  /아니(?!면)/,
  /전혀\s*(?:없|않)/,
];

// A denial belongs to the verb that ends its own clause. Without a boundary,
// "카톡이 아니라 게임 채팅으로 성적인 욕을 들었어요" would deny the game chat and
// the words as well as the 카톡 it actually corrects.
const CLAUSE_BOUNDARY = /[.!?\n]|,|는데|지만|면서|더니/;

// Every term that can put an element on the screen, tagged with the element it
// speaks for and, for a medium, which medium that is — a denial has to be able
// to remove one named channel without removing the element.
const ELEMENT_TERMS = [
  ...MEDIUM_RULES.map(([value, words]) => ["medium", value, words]),
  ["expression", null, [...SEXUAL_SUBJECT_TERMS, ...SEXUAL_SLUR_TERMS, ...IMAGE_TERMS]],
];

function elementMarks(text) {
  const marks = [];
  for (const [element, value, terms] of ELEMENT_TERMS) {
    for (const term of terms) {
      for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + 1)) {
        marks.push({ element, value, at, end: at + term.length });
      }
    }
  }
  return marks.sort((left, right) => left.at - right.at);
}

function firstDenial(clause) {
  let first = -1;
  for (const pattern of DENIAL_PATTERNS) {
    const found = clause.search(pattern);
    if (found !== -1 && (first === -1 || found < first)) first = found;
  }
  return first;
}

function isDenied(text, mark, marks) {
  const rest = text.slice(mark.end);
  const boundary = rest.search(CLAUSE_BOUNDARY);
  const denial = firstDenial(boundary === -1 ? rest : rest.slice(0, boundary));
  if (denial === -1) return false;
  // A nearer mention of a *different* element takes the denial: in "카톡으로
  // 성적인 말을 한 적이 없습니다" it is the words being denied, not the 카톡 they
  // were not sent on. Another word for the same element does not intercept it —
  // 성적 and 사진 in "성적인 사진은 보낸 적이 없습니다" are one denial, not two.
  return !marks.some((other) => other.element !== mark.element
    && other.at > mark.end && other.at < mark.end + denial);
}

/**
 * What the description denies rather than reports.
 *
 * Returned in two parts because they are used for different things. `mediums`
 * corrects the extraction itself — someone who writes "카톡은 아니고 문자로"
 * has named the channel and then ruled it out, and searching on the ruled-out
 * one is simply wrong. `elements` is for the statute screen, which can then say
 * "아니라고 적음" instead of reading a denial back as a mention.
 *
 * Either is reported only when nothing else in the text affirms it, so a
 * correction removes the channel it corrects and leaves the one it offers.
 */
export function findDenials(description) {
  const text = String(description || "");
  const marks = elementMarks(text);
  const denied = { elements: new Set(), mediums: new Set() };
  const affirmed = { elements: new Set(), mediums: new Set() };

  for (const mark of marks) {
    const side = isDenied(text, mark, marks) ? denied : affirmed;
    side.elements.add(mark.element);
    if (mark.value) side.mediums.add(mark.value);
  }

  return {
    elements: [...denied.elements].filter((element) => !affirmed.elements.has(element)),
    mediums: [...denied.mediums].filter((value) => !affirmed.mediums.has(value)),
  };
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function unique(values) {
  return [...new Set(values)];
}

function jaccard(left, right) {
  const a = new Set(left || []);
  const b = new Set(right || []);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return Math.round((intersection / union.size) * 100);
}

export function extractFactTags(description, _options = {}) {
  const normalizedText = String(description || "").normalize("NFKC").trim().toLowerCase();
  const hasSexual = includesAny(normalizedText, SEXUAL_SUBJECT_TERMS)
    || includesAny(normalizedText, SEXUAL_SLUR_TERMS);
  const hasInsult = includesAny(normalizedText, ["욕설", "비하", "조롱", "모욕", "패드립"]);
  const hasImage = includesAny(normalizedText, IMAGE_TERMS);

  const denials = findDenials(normalizedText);
  const detectedMediums = unique([
    ...MEDIUM_RULES.filter(([, words]) => includesAny(normalizedText, words)).map(([value]) => value),
    ...MEDIUM_PATTERNS.filter(([, pattern]) => pattern.test(normalizedText)).map(([value]) => value),
  ]).filter((value) => !denials.mediums.includes(value));
  const medium = detectedMediums[0] || "unknown";

  let recipientIdentification = "unknown";
  if (includesAny(normalizedText, ["멘션", "태그", "@"] )) recipientIdentification = "mention";
  else if (medium === "bank_transfer") recipientIdentification = "bank_account";
  else if (includesAny(normalizedText, ["게시글", "댓글", "공개 글", "게시판"])) recipientIdentification = "public_post";
  else if (["kakao", "game_chat", "sns_mention", "digital_message"].includes(medium)) {
    recipientIdentification = "direct_account";
  }

  let relationship = "unknown";
  if (includesAny(normalizedText, ["연인", "남자친구", "여자친구", "전남친", "전여친"])) relationship = "partner_or_ex";
  else if (includesAny(normalizedText, ["게임", "같은 팀"])) relationship = "game_user";
  else if (includesAny(normalizedText, ["이웃", "옆집"])) relationship = "neighbor";
  else if (includesAny(normalizedText, ["동업", "지인", "친구", "아는 사람"])) relationship = "acquaintance";
  else if (includesAny(normalizedText, ["온라인", "트위터", "sns", "인스타"])) relationship = "online_user";
  else if (includesAny(normalizedText, ["모르는", "처음 만난", "일면식"])) relationship = "stranger";

  let context = "unknown";
  if (includesAny(normalizedText, ["다툼", "말다툼", "싸움", "화가", "분노", "욕설", "비하", "조롱"])) context = "conflict";
  else if (includesAny(normalizedText, ["성관계", "성적인 대화", "연인"])) context = "sexual_conversation";
  else if (includesAny(normalizedText, ["일방적", "갑자기", "원치 않"])) context = "one_sided";

  let repetition = "unknown";
  if (includesAny(normalizedText, ["반복", "여러 번", "여러번", "여러 차례", "여러차례", "계속", "수차례"])) repetition = "repeated";
  else if (includesAny(normalizedText, ["한 번", "한번", "1회", "한 차례", "한차례"])) repetition = "once";

  let expressionType = "other";
  if (hasImage) expressionType = "sexual_image";
  else if (hasSexual && hasInsult) expressionType = "insult_with_sexual_terms";
  else if (hasSexual) expressionType = "sexual_text";

  // Read in three steps, not two. The middle one is the point: a description
  // that says the message went unread answers neither question, and guessing
  // "yes" there had the screen quoting an arrival the reader never reported.
  let reachedRecipient = "unknown";
  if (includesAny(normalizedText, NOT_DELIVERED_TERMS)) reachedRecipient = "no";
  else if (includesAny(normalizedText, NOT_READ_TERMS)) reachedRecipient = "unknown";
  else if (includesAny(normalizedText, DELIVERED_TERMS)) reachedRecipient = "yes";

  const issueTags = [];
  if (medium !== "unknown" && medium !== "direct_delivery") issueTags.push("통신매체");
  if (reachedRecipient === "yes") issueTags.push("도달");
  if (hasSexual) issueTags.push("성적표현");
  if (context === "conflict") issueTags.push("분노");
  if (medium === "sns_mention" || recipientIdentification === "mention") issueTags.push("멘션");
  if (repetition === "once") issueTags.push("단발성");
  if (repetition === "repeated") issueTags.push("반복성");

  return {
    medium,
    messageForm: hasImage ? "image" : "text",
    recipientIdentification,
    reachedRecipient,
    relationship,
    context,
    expressionType,
    repetition,
    additionalChannels: detectedMediums.slice(1),
    issueTags: unique(issueTags),
    // Read by the statute screen, not by the ranking: a denial says what this
    // description is not about, which is not a fact to match a judgment on.
    deniedElements: denials.elements,
    normalizedText,
    extractionVersion: FACT_TAG_EXTRACTION_VERSION,
  };
}

export function compareFactTags(queryFacts, precedentFacts) {
  const matchedFacts = [];
  const differentFacts = [];

  for (const field of SCALAR_FIELDS) {
    const queryValue = queryFacts?.[field];
    const precedentValue = precedentFacts?.[field];
    if (UNKNOWN_VALUES.has(queryValue) || UNKNOWN_VALUES.has(precedentValue)) continue;
    const item = { field, queryValue, precedentValue };
    if (queryValue === precedentValue) matchedFacts.push(item);
    else differentFacts.push(item);
  }

  const comparableCount = matchedFacts.length + differentFacts.length;
  // messageForm always carries a value, so it is the one field two records can
  // always compare. On its own it is not evidence of a similar case: a precedent
  // whose facts could not be extracted would score a perfect match off it and
  // outrank every richly tagged judgment.
  const onlyDefaultedField = comparableCount === 1
    && [...matchedFacts, ...differentFacts][0].field === "messageForm";
  return {
    factScore: comparableCount === 0 || onlyDefaultedField
      ? 0
      : Math.round((matchedFacts.length / comparableCount) * 100),
    issueScore: jaccard(queryFacts?.issueTags, precedentFacts?.issueTags),
    comparableCount,
    matchedFacts,
    differentFacts,
  };
}
