/**
 * The gaps the rules could not read, asked in the reader's own position.
 *
 * "상대방" used to appear in every prompt meaning two opposite things on one
 * screen — the sender in one question and the reader in the next — so a victim
 * reading "상대방에게 전달되었나요" was being asked whether they had sent it.
 * Nothing here says 상대방 any more: each prompt names one side outright.
 *
 * The reported side is worded so it never assumes the reader did it. Someone
 * answering a complaint they deny still has to be able to describe it.
 */
const QUESTION_DEFINITIONS = [
  // Asked first: an unreadable expression is the one gap that ends the search
  // with nothing, so it is worth a question before the others.
  {
    field: "expressionType",
    victim: {
      prompt: "상대가 보낸 내용은 어떤 것이었나요?",
      hint: "들은 말을 그대로 적으셔도 됩니다.",
    },
    reported: {
      prompt: "문제가 된 내용은 어떤 것이었나요?",
      hint: "오간 말을 그대로 적으셔도 됩니다.",
    },
  },
  {
    field: "medium",
    victim: {
      prompt: "어떤 경로로 받으셨나요?",
      hint: "예: 카카오톡 · 게임 채팅 · SNS 디엠 · 문자",
    },
    reported: {
      prompt: "어떤 경로로 오간 내용인가요?",
      hint: "예: 카카오톡 · 게임 채팅 · SNS 디엠 · 문자",
    },
  },
  {
    field: "recipientIdentification",
    victim: {
      prompt: "상대가 회원님을 어떻게 지목해서 보냈나요?",
      hint: "예: 내 계정으로 직접 · 멘션 · 공개 게시글",
    },
    reported: {
      prompt: "받는 사람을 어떻게 지목한 내용인가요?",
      hint: "예: 그 사람 계정으로 직접 · 멘션 · 공개 게시글",
    },
  },
  {
    field: "reachedRecipient",
    victim: {
      prompt: "그 내용이 실제로 회원님에게 도착했나요?",
      hint: "예: 알림으로 받았다 · 나중에 찾아서 봤다 · 못 봤다",
    },
    reported: {
      prompt: "그 내용이 실제로 상대에게 도착했나요?",
      hint: "예: 전송됐다 · 차단되어 가지 않았다 · 모르겠다",
    },
  },
  {
    field: "relationship",
    victim: {
      prompt: "상대와는 어떤 사이인가요?",
      hint: "예: 모르는 사람 · 지인 · 같은 게임 이용자",
    },
    reported: {
      prompt: "그 사람과는 어떤 사이인가요?",
      hint: "예: 모르는 사람 · 지인 · 같은 게임 이용자",
    },
  },
  {
    field: "repetition",
    victim: {
      prompt: "한 번이었나요, 여러 번이었나요?",
      hint: "예: 한 번 · 여러 번",
    },
    reported: {
      prompt: "한 번이었나요, 여러 번이었나요?",
      hint: "예: 한 번 · 여러 번",
    },
  },
];

export const INTAKE_ROLES = ["victim", "reported"];

function isUnknown(value) {
  return value == null || value === "" || value === "unknown" || value === "other";
}

export function buildIntakeQuestions(facts = {}, { role = "victim" } = {}) {
  const side = INTAKE_ROLES.includes(role) ? role : "victim";
  return QUESTION_DEFINITIONS
    .filter(({ field }) => isUnknown(facts[field]))
    .slice(0, 3)
    .map(({ field, [side]: wording }) => ({
      id: field,
      field,
      prompt: wording.prompt,
      // Examples live apart from the question so a long list of them does not
      // make the question itself look long.
      hint: wording.hint,
    }));
}
