const QUESTION_DEFINITIONS = [
  // Asked first: an unreadable expression is the one gap that ends the search
  // with nothing, so it is worth a question before the others.
  { field: "expressionType", prompt: "상대방이 보낸 내용은 어떤 것이었나요? 받은 말을 그대로 적으셔도 됩니다." },
  { field: "medium", prompt: "어떤 매체로 전달되었나요? (예: 카카오톡, 게임 채팅, SNS, 문자)" },
  { field: "recipientIdentification", prompt: "상대방이 누구에게 보이도록 보냈는지 적어주세요. (예: 내 계정으로 직접, 멘션, 공개 게시글)" },
  { field: "reachedRecipient", prompt: "해당 내용이 실제로 상대방에게 전달되었거나 확인되었나요?" },
  { field: "relationship", prompt: "상대방과의 관계는 무엇인가요? (예: 모르는 사람, 지인, 게임 이용자)" },
  { field: "repetition", prompt: "이런 전달은 한 차례였나요, 여러 차례였나요?" },
];

function isUnknown(value) {
  return value == null || value === "" || value === "unknown" || value === "other";
}

export function buildIntakeQuestions(facts = {}) {
  return QUESTION_DEFINITIONS
    .filter(({ field }) => isUnknown(facts[field]))
    .slice(0, 3)
    .map(({ field, prompt }) => ({ id: field, field, prompt }));
}
