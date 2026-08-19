/**
 * The four things 성폭력처벌법 제13조 requires, quoted from the article itself.
 *
 * Whether each one is *satisfied* is for a court to decide on evidence. What
 * this module reports is narrower and checkable: whether the description the
 * user wrote mentions the element at all. That distinction is the whole reason
 * this can be shown to someone without it becoming legal advice.
 */
export const ARTICLE_13_ELEMENTS = [
  {
    id: "purpose",
    label: "성적 욕망을 유발하거나 만족시킬 목적",
    statuteQuote: "자기 또는 다른 사람의 성적 욕망을 유발하거나 만족시킬 목적으로",
  },
  {
    id: "medium",
    label: "통신매체를 통한 전달",
    statuteQuote: "전화, 우편, 컴퓨터, 그 밖의 통신매체를 통하여",
  },
  {
    id: "expression",
    label: "성적 수치심이나 혐오감을 일으키는 표현",
    statuteQuote: "성적 수치심이나 혐오감을 일으키는 말, 음향, 글, 그림, 영상 또는 물건을",
  },
  {
    id: "reached",
    label: "상대방에게 도달",
    statuteQuote: "상대방에게 도달하게 한",
  },
];

const MEDIUM_LABELS = {
  bank_transfer: "송금메모",
  kakao: "카카오톡",
  game_chat: "게임 채팅",
  sns_mention: "SNS 멘션",
  direct_delivery: "직접 전달",
  digital_message: "디지털 메시지",
};

const EXPRESSION_LABELS = {
  insult_with_sexual_terms: "성적인 비하·욕설 표현",
  sexual_text: "성적인 글 표현",
  sexual_image: "성적인 이미지",
};

function element(id, mention, evidence) {
  const definition = ARTICLE_13_ELEMENTS.find((item) => item.id === id);
  return { ...definition, mention, evidence };
}

/**
 * Reads the rule-extracted facts against the article. The model is handed the
 * result rather than asked to produce it, so no generated text can move an
 * element between states.
 */
export function mapFactsToArticle13(facts = {}) {
  const medium = facts.medium && facts.medium !== "unknown" ? facts.medium : null;
  const expressionType = facts.expressionType && facts.expressionType !== "other" ? facts.expressionType : null;

  return [
    // Purpose is a state of mind. A description cannot establish it and courts
    // infer it from the circumstances as a whole, so this never reads as settled.
    element("purpose", "unclear", "입력만으로는 알 수 없는 요건입니다. 법원이 여러 사정을 종합해 판단합니다."),

    element(
      "medium",
      medium ? "present" : "unclear",
      medium
        ? `입력에서 ${MEDIUM_LABELS[medium] || medium}을 확인했습니다.`
        : "입력에서 전달 수단을 확인하지 못했습니다.",
    ),

    element(
      "expression",
      expressionType ? "present" : "unclear",
      expressionType
        ? `입력에서 ${EXPRESSION_LABELS[expressionType] || expressionType}을 확인했습니다.`
        : "입력에서 성적 표현에 관한 언급을 확인하지 못했습니다.",
    ),

    element(
      "reached",
      facts.reachedRecipient === "yes" ? "present" : facts.reachedRecipient === "no" ? "absent" : "unclear",
      facts.reachedRecipient === "yes"
        ? "입력에서 상대방이 내용을 확인했다는 언급을 찾았습니다."
        : facts.reachedRecipient === "no"
          ? "입력에서 상대방에게 전달되지 않았다는 언급을 찾았습니다."
          : "입력에서 도달 여부를 확인하지 못했습니다.",
    ),
  ];
}
