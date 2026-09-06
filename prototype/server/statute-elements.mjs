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

/**
 * How arrival reads from each side of the same event.
 *
 * 상대방 in the article means whoever the message reached, and that is the
 * reader when the reader is the one who received it. The intake questions were
 * rewritten to stop saying 상대방 for this exact reason — a victim is asked
 * "그 내용이 실제로 회원님에게 도착했나요?" — but the reading underneath still
 * answered them with 상대방이 내용을 확인했다, naming the sender as the one
 * who saw it. Every line here is still only about what the description says.
 */
const ARRIVAL_EVIDENCE = {
  victim: {
    yes: "입력에서 회원님이 그 내용을 확인하셨다는 언급을 찾았습니다.",
    no: "입력에서 회원님에게 전달되지 않았다는 언급을 찾았습니다.",
  },
  reported: {
    yes: "입력에서 상대가 내용을 확인했다는 언급을 찾았습니다.",
    no: "입력에서 상대에게 전달되지 않았다는 언급을 찾았습니다.",
  },
  // No side chosen: name neither of them rather than guess one.
  neutral: {
    yes: "입력에서 내용이 도달했다는 언급을 찾았습니다.",
    no: "입력에서 전달되지 않았다는 언급을 찾았습니다.",
  },
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
export function mapFactsToArticle13(facts = {}, { role } = {}) {
  const arrival = ARRIVAL_EVIDENCE[role] || ARRIVAL_EVIDENCE.neutral;
  const denied = new Set(Array.isArray(facts.deniedElements) ? facts.deniedElements : []);
  const medium = facts.medium && facts.medium !== "unknown" ? facts.medium : null;
  const expressionType = facts.expressionType && facts.expressionType !== "other" ? facts.expressionType : null;

  // A denial outranks a detection, because both are read from the same words.
  // "카톡이 아니라 직접 만나서" names 카톡 in order to rule it out, and reporting
  // that back as 입력에 언급됨 told readers they had said the opposite of
  // what they wrote. Arrival has been able to say this since the start; the
  // other two could only ever say "언급됨" or "모르겠다", which left a reader
  // denying the whole account with no way for the screen to show it.
  const mediumReading = denied.has("medium")
    ? ["absent", "입력에서 그 매체로 전달한 것이 아니라는 언급을 찾았습니다."]
    : medium
      ? ["present", `입력에서 ${MEDIUM_LABELS[medium] || medium}을 확인했습니다.`]
      : ["unclear", "입력에서 전달 수단을 확인하지 못했습니다."];

  const reachedReading = facts.reachedRecipient === "yes"
    ? ["present", arrival.yes]
    : facts.reachedRecipient === "no"
      ? ["absent", arrival.no]
      : ["unclear", "입력에서 도달 여부를 확인하지 못했습니다."];

  const expressionReading = denied.has("expression")
    ? ["absent", "입력에서 그런 표현을 하지 않았다는 언급을 찾았습니다."]
    : expressionType
      ? ["present", `입력에서 ${EXPRESSION_LABELS[expressionType] || expressionType}을 확인했습니다.`]
      : ["unclear", "입력에서 성적 표현에 관한 언급을 확인하지 못했습니다."];

  return [
    // Purpose is a state of mind. A description cannot establish it and courts
    // infer it from the circumstances as a whole, so this never reads as settled.
    element("purpose", "unclear", "입력만으로는 알 수 없는 요건입니다. 법원이 여러 사정을 종합해 판단합니다."),

    element("medium", ...mediumReading),

    element("expression", ...expressionReading),

    element("reached", ...reachedReading),
  ];
}
