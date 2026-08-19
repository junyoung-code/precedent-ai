export const FACT_TAG_EXTRACTION_VERSION = "rule-v2";

const UNKNOWN_VALUES = new Set([undefined, null, "", "unknown", "other"]);

const MEDIUM_RULES = [
  ["bank_transfer", ["송금", "계좌", "이체", "1원"]],
  ["kakao", ["카카오", "카톡"]],
  ["sns_mention", ["트위터", "sns", "멘션", "인스타", "페이스북", "dm"]],
  ["game_chat", ["게임", "채팅창"]],
  ["direct_delivery", ["편지", "출입문", "문에 끼워"]],
  ["digital_message", ["문자", "메시지", "메신저"]],
];

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
const SEXUAL_SUBJECT_TERMS = ["성적", "음란", "야한", "나체", "성기", "성관계"];

// What people actually write. Nobody reports being sent "성적인 표현"; they quote
// what was said, and the judgments in this repository quote the same words back
// — "니꼬추 3cm", "○○ 씹새끼", "니 ㅇ미가 …". Reading only the first list drops a
// real complaint out of scope for using the words it happened in.
const SEXUAL_SLUR_TERMS = [
  "패드립", "니애미", "니애비", "애미", "니미", "느금마", "느개비", "ㅇ미",
  "보지", "자지", "좆", "꼬추", "씹새", "씹년", "씹할", "젖가슴", "젖탱",
  "따먹", "강간", "성폭행", "자위", "야동",
];

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
  const hasImage = includesAny(normalizedText, ["사진", "이미지", "영상", "동영상", "나체"]);

  const detectedMediums = MEDIUM_RULES
    .filter(([, words]) => includesAny(normalizedText, words))
    .map(([value]) => value);
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

  let reachedRecipient = "unknown";
  if (includesAny(normalizedText, ["도달하지", "전송하지", "보내지 않", "전달되지 않"])) reachedRecipient = "no";
  else if (includesAny(normalizedText, ["받았", "받은", "보냈", "전송", "전달", "도달", "메시지", "멘션", "송금", "게시"])) {
    reachedRecipient = "yes";
  }

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
