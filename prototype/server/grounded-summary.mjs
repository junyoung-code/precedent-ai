function summaryError(message) {
  return Object.assign(new Error(message), { code: "SUMMARY_RESPONSE_INVALID" });
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

const PREDICTION_PATTERNS = [
  /고소\s*(가능|할\s*수)/,
  /신고.{0,8}(처벌|가능)/,
  /유죄.{0,8}(가능|확률|될)/,
  /무죄.{0,8}(가능|확률)/,
  /처벌.{0,8}(가능|예상|될\s*수)/,
  /사용자\s*사건/,
  /이\s*사례.{0,12}(가능|성립|처벌)/,
];

export function validateGroundedSummary(payload, allowedParagraphIds) {
  if (!isPlainObject(payload) || !hasExactKeys(payload, ["sentences"])) {
    throw summaryError("요약 최상위 형식이 올바르지 않습니다.");
  }
  if (!Array.isArray(payload.sentences) || payload.sentences.length < 1 || payload.sentences.length > 3) {
    throw summaryError("요약 문장은 1개 이상 3개 이하여야 합니다.");
  }
  if (!(allowedParagraphIds instanceof Set) || allowedParagraphIds.size === 0) {
    throw summaryError("검증 가능한 판결문 문단이 없습니다.");
  }

  return payload.sentences.map((sentence) => {
    if (!isPlainObject(sentence) || !hasExactKeys(sentence, ["paragraphIds", "text"])) {
      throw summaryError("요약 문장 형식이 올바르지 않습니다.");
    }
    const text = typeof sentence.text === "string" ? sentence.text.trim() : "";
    if (!text || text.length > 500 || PREDICTION_PATTERNS.some((pattern) => pattern.test(text))) {
      throw summaryError("중립적인 요약 문장이 아닙니다.");
    }
    if (!Array.isArray(sentence.paragraphIds) || sentence.paragraphIds.length < 1) {
      throw summaryError("각 문장에는 판결문 근거가 필요합니다.");
    }
    const paragraphIds = [...new Set(sentence.paragraphIds)];
    if (paragraphIds.length > 5
      || paragraphIds.some((id) => typeof id !== "string" || !allowedParagraphIds.has(id))) {
      throw summaryError("동일 판례에 존재하지 않는 문단을 참조했습니다.");
    }
    return { text, paragraphIds };
  });
}
