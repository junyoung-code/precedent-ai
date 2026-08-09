import { VERIFIED_PRECEDENTS, validatePrecedents } from "./precedents.js";

const MEDIUM_LABELS = {
  bank_transfer: "송금메모를 사용했다는 점",
  kakao: "카카오톡 메시지라는 점",
  game_chat: "게임 채팅에서 전달됐다는 점",
  sns_mention: "SNS 멘션을 사용했다는 점",
  direct_delivery: "직접 전달된 글이라는 점",
  digital_message: "디지털 메시지로 전달됐다는 점",
};

const FACT_LABELS = {
  context: {
    conflict: "다툼이나 분노가 섞인 상황이라는 점",
    sexual_conversation: "성적인 대화 맥락이 있었다는 점",
    one_sided: "일방적으로 전달된 상황이라는 점",
  },
  messageForm: {
    text: "글 형태의 표현이라는 점",
    image: "이미지 형태라는 점",
  },
  repetition: {
    once: "한 차례 전달됐다는 점",
    repeated: "반복해서 전달됐다는 점",
  },
  relationship: {
    game_user: "게임에서 알게 된 상대라는 점",
    acquaintance: "서로 알고 지낸 관계라는 점",
    partner_or_ex: "연인 또는 과거 연인 관계라는 점",
    neighbor: "이웃 관계라는 점",
    stranger: "서로 모르는 관계라는 점",
    online_user: "온라인에서 알게 된 상대라는 점",
  },
  expressionType: {
    insult_with_sexual_terms: "성적인 비하·욕설 표현이라는 점",
    sexual_text: "성적인 글 표현이라는 점",
    sexual_image: "성적인 이미지가 전달됐다는 점",
  },
};

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

export function extractCaseFacts(description) {
  const text = String(description || "").trim().toLowerCase();
  const hasSexual = includesAny(text, ["성적", "음란", "야한", "나체", "성기", "성관계"]);
  const hasInsult = includesAny(text, ["욕설", "비하", "조롱", "모욕", "패드립"]);
  const hasImage = includesAny(text, ["사진", "이미지", "영상", "나체"]);

  let medium = "unknown";
  if (includesAny(text, ["송금", "계좌", "이체", "1원"])) medium = "bank_transfer";
  else if (includesAny(text, ["카카오", "카톡"])) medium = "kakao";
  else if (includesAny(text, ["트위터", "sns", "멘션", "인스타"])) medium = "sns_mention";
  else if (includesAny(text, ["게임", "채팅창"])) medium = "game_chat";
  else if (includesAny(text, ["편지", "출입문", "문에 끼워"])) medium = "direct_delivery";
  else if (includesAny(text, ["문자", "메시지", "dm"])) medium = "digital_message";

  let relationship = "unknown";
  if (includesAny(text, ["연인", "남자친구", "여자친구", "전남친", "전여친"])) relationship = "partner_or_ex";
  else if (includesAny(text, ["게임", "같은 팀"])) relationship = "game_user";
  else if (includesAny(text, ["이웃", "옆집"])) relationship = "neighbor";
  else if (includesAny(text, ["동업", "지인", "친구", "아는 사람"])) relationship = "acquaintance";
  else if (includesAny(text, ["온라인", "트위터", "sns"])) relationship = "online_user";
  else if (includesAny(text, ["모르는", "처음 만난", "일면식"])) relationship = "stranger";

  let context = "unknown";
  if (includesAny(text, ["다툼", "말다툼", "싸움", "화가", "분노", "욕설", "비하", "조롱"])) context = "conflict";
  else if (includesAny(text, ["성관계", "성적인 대화", "연인"])) context = "sexual_conversation";
  else if (includesAny(text, ["일방적", "갑자기", "원치 않"])) context = "one_sided";

  let repetition = "unknown";
  if (includesAny(text, ["반복", "여러 번", "여러차례", "계속", "수차례"])) repetition = "repeated";
  else if (includesAny(text, ["한 번", "한번", "1회", "한 차례", "한차례"])) repetition = "once";

  let expressionType = "other";
  if (hasImage) expressionType = "sexual_image";
  else if (hasSexual && hasInsult) expressionType = "insult_with_sexual_terms";
  else if (hasSexual) expressionType = "sexual_text";

  const reachedRecipient = includesAny(text, ["받았", "보냈", "전송", "전달", "메시지", "멘션", "송금"])
    ? "yes"
    : "unknown";

  const issueTags = [];
  if (medium !== "unknown" && medium !== "direct_delivery") issueTags.push("통신매체");
  if (reachedRecipient === "yes") issueTags.push("도달");
  if (hasSexual) issueTags.push("성적표현");
  if (context === "conflict") issueTags.push("분노");
  if (medium === "sns_mention") issueTags.push("멘션");
  if (repetition === "once") issueTags.push("단발성");

  return {
    medium,
    relationship,
    context,
    messageForm: hasImage ? "image" : "text",
    expressionType,
    repetition,
    reachedRecipient,
    issueTags,
    normalizedText: text,
  };
}

function semanticScore(facts, precedent) {
  const keywordMatches = precedent.keywords.filter((keyword) =>
    facts.normalizedText.includes(keyword.toLowerCase()),
  ).length;
  const channelBonus = facts.medium !== "unknown" && facts.medium === precedent.facts.medium ? 26 : 0;
  const expressionBonus =
    facts.expressionType !== "other" && facts.expressionType === precedent.facts.expressionType ? 18 : 0;
  return Math.min(100, keywordMatches * 14 + channelBonus + expressionBonus);
}

function factsScore(facts, precedent) {
  const fields = [
    "medium",
    "relationship",
    "context",
    "messageForm",
    "expressionType",
    "repetition",
    "reachedRecipient",
  ];
  const comparable = fields.filter((field) => !["unknown", "other"].includes(facts[field]));
  if (comparable.length === 0) return 0;
  const matches = comparable.filter((field) => facts[field] === precedent.facts[field]).length;
  return Math.round((matches / comparable.length) * 100);
}

function issueScore(facts, precedent) {
  if (facts.issueTags.length === 0) return 0;
  const matches = facts.issueTags.filter((tag) => precedent.issueTags.includes(tag)).length;
  return Math.round((matches / facts.issueTags.length) * 100);
}

function comparisonItems(facts, precedent, matches) {
  const fields = ["medium", "relationship", "context", "messageForm", "expressionType", "repetition"];
  const items = [];

  for (const field of fields) {
    const queryValue = facts[field];
    const precedentValue = precedent.facts[field];
    if (["unknown", "other"].includes(queryValue)) continue;
    if ((queryValue === precedentValue) !== matches) continue;

    if (field === "medium") {
      items.push(
        matches
          ? MEDIUM_LABELS[queryValue]
          : `전달 수단이 다릅니다 · 입력: ${MEDIUM_LABELS[queryValue]?.replace("라는 점", "")} / 판례: ${MEDIUM_LABELS[precedentValue]?.replace("라는 점", "") || "다른 수단"}`,
      );
      continue;
    }

    const label = FACT_LABELS[field]?.[matches ? queryValue : precedentValue];
    if (label) items.push(matches ? label : `판례는 ${label}`);
  }

  return items.slice(0, 4);
}

export function rankPrecedents({ description }, precedents = VERIFIED_PRECEDENTS) {
  if (validatePrecedents(precedents).length > 0) return [];
  const facts = extractCaseFacts(description);

  const ranked = precedents
    .map((precedent) => {
      const semantic = semanticScore(facts, precedent);
      const factMatch = factsScore(facts, precedent);
      const issues = issueScore(facts, precedent);
      const total = Math.round(semantic * 0.45 + factMatch * 0.45 + issues * 0.1);

      return {
        ...precedent,
        similarity: { semantic, facts: factMatch, issues, total },
        similarities: comparisonItems(facts, precedent, true),
        differences: comparisonItems(facts, precedent, false),
      };
    })
    .sort((a, b) => b.similarity.total - a.similarity.total);

  if (!ranked[0] || ranked[0].similarity.total < 55) return [];
  return ranked.filter((item) => item.similarity.total >= 55).slice(0, 5);
}
