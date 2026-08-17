const VALUE_LABELS = {
  medium: {
    bank_transfer: "송금메모",
    kakao: "카카오톡",
    game_chat: "게임 채팅",
    sns_mention: "SNS 멘션",
    direct_delivery: "직접 전달",
    digital_message: "디지털 메시지",
  },
  messageForm: { text: "글", image: "이미지" },
  recipientIdentification: {
    mention: "멘션으로 상대를 특정",
    bank_account: "계좌로 상대를 특정",
    public_post: "공개 게시글",
    direct_account: "상대 계정으로 직접 전달",
  },
  reachedRecipient: { yes: "상대방에게 도달", no: "상대방에게 도달하지 않음" },
  relationship: {
    game_user: "게임 이용자 관계",
    acquaintance: "지인 관계",
    partner_or_ex: "연인·전 연인 관계",
    neighbor: "이웃 관계",
    stranger: "모르는 사이",
    online_user: "온라인 이용자 관계",
  },
  context: {
    conflict: "다툼 상황",
    sexual_conversation: "성적 대화 맥락",
    one_sided: "일방적 전달 상황",
  },
  expressionType: {
    insult_with_sexual_terms: "성적인 비하·욕설 표현",
    sexual_text: "성적인 글 표현",
    sexual_image: "성적인 이미지",
  },
  repetition: { once: "한 차례", repeated: "반복" },
};

const FIELD_LABELS = {
  medium: "전달 수단",
  messageForm: "표현 형태",
  recipientIdentification: "상대방 특정 방식",
  reachedRecipient: "도달 여부",
  relationship: "관계",
  context: "상황",
  expressionType: "표현 유형",
  repetition: "전달 횟수",
};

function safeScore(value) {
  return Math.round(Math.max(0, Math.min(Number(value) || 0, 100)));
}

function isOfficialUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["law.go.kr", "www.law.go.kr"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isVerifiedIdentity(result) {
  return Boolean(
    result?.id
    && result.court
    && result.caseNumber
    && result.caseName
    && result.decisionDate
    && isOfficialUrl(result.officialUrl),
  );
}

function matchedFactLabel(item) {
  const value = VALUE_LABELS[item?.field]?.[item?.precedentValue];
  if (!value) return null;
  if (item.field === "medium") return `${value}을 사용했다는 점`;
  return `${value}이라는 점`;
}

function differentFactLabel(item) {
  const field = FIELD_LABELS[item?.field];
  const query = VALUE_LABELS[item?.field]?.[item?.queryValue];
  const precedent = VALUE_LABELS[item?.field]?.[item?.precedentValue];
  if (!field || !query || !precedent) return null;
  return `${field}이 다릅니다 · 입력: ${query} / 판례: ${precedent}`;
}

function mapSummary(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return null;
  const summary = [];
  for (const sentence of value) {
    const text = typeof sentence?.text === "string" ? sentence.text.trim() : "";
    const sourceAnchor = typeof sentence?.sourceAnchor === "string" ? sentence.sourceAnchor.trim() : "";
    if (!text || !sourceAnchor) return null;
    summary.push({ text, sourceAnchor });
  }
  return summary;
}

function mapResult(result) {
  if (!isVerifiedIdentity(result)) return null;
  return {
    id: result.id,
    court: result.court,
    caseNumber: result.caseNumber,
    caseName: result.caseName,
    decisionDate: result.decisionDate,
    officialUrl: result.officialUrl,
    verifiedAt: result.verifiedAt || null,
    similarity: {
      semantic: safeScore(result.semanticScore),
      facts: safeScore(result.tagScore),
      issues: safeScore(result.issueScore),
      total: safeScore(result.retrievalScore),
    },
    similarities: (result.matchedFacts || []).map(matchedFactLabel).filter(Boolean).slice(0, 4),
    differences: (result.differentFacts || []).map(differentFactLabel).filter(Boolean).slice(0, 4),
    summary: mapSummary(result.summary),
  };
}

function searchError(code, message) {
  return Object.assign(new Error(message), { code });
}

export async function searchSimilarPrecedents({
  query,
  limit = 3,
  allowExternalEmbedding = false,
  fetchImpl = fetch,
  signal,
} = {}) {
  let response;
  try {
    response = await fetchImpl("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        limit,
        allowExternalEmbedding: allowExternalEmbedding === true,
      }),
      signal,
    });
  } catch {
    throw searchError("SEARCH_API_UNAVAILABLE", "검색 서버에 연결할 수 없습니다.");
  }
  if (!response.ok) {
    throw searchError("SEARCH_API_UNAVAILABLE", `검색 서버가 ${response.status}로 응답했습니다.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw searchError("SEARCH_RESPONSE_INVALID", "검색 응답 형식이 올바르지 않습니다.");
  }

  return {
    query: String(payload.query || query || ""),
    queryFacts: payload.queryFacts || {},
    availableCount: Math.max(0, Number(payload.availableCount) || 0),
    comparedCount: Math.max(0, Number(payload.comparedCount) || 0),
    scoring: payload.scoring || { status: "unknown" },
    results: Array.isArray(payload.results) ? payload.results.map(mapResult).filter(Boolean) : [],
  };
}
