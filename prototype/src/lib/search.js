import { VERIFIED_PRECEDENTS, validatePrecedents } from "./precedents.js";
import { compareFactTags, extractFactTags } from "./fact-tags.js";

export { extractFactTags as extractCaseFacts } from "./fact-tags.js";

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

function semanticScore(facts, precedent) {
  const keywordMatches = precedent.keywords.filter((keyword) =>
    facts.normalizedText.includes(keyword.toLowerCase()),
  ).length;
  const channelBonus = facts.medium !== "unknown" && facts.medium === precedent.facts.medium ? 26 : 0;
  const expressionBonus =
    facts.expressionType !== "other" && facts.expressionType === precedent.facts.expressionType ? 18 : 0;
  return Math.min(100, keywordMatches * 14 + channelBonus + expressionBonus);
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
  const facts = extractFactTags(description);

  const ranked = precedents
    .map((precedent) => {
      const semantic = semanticScore(facts, precedent);
      const comparison = compareFactTags(facts, { ...precedent.facts, issueTags: precedent.issueTags });
      const factMatch = comparison.factScore;
      const issues = comparison.issueScore;
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
