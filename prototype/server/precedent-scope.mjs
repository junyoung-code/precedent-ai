const TARGET_OFFENSE = "통신매체이용음란";
const PERIPHERAL_TERMS = ["13세미만미성년자강간", "강간", "미성년자의제간음", "간음유인", "부착명령"];
const RELEVANCE_TERMS = [
  TARGET_OFFENSE,
  "성폭력처벌법제13조",
  "통신매체",
  "성적욕망",
  "성적수치심",
  "성적혐오감",
];

function compact(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, "");
}

export function classifyPrecedentFocus(caseName) {
  const name = compact(caseName);
  if (name.includes(TARGET_OFFENSE) && PERIPHERAL_TERMS.some((term) => name.includes(term))) {
    return "peripheral";
  }
  if (name.includes(TARGET_OFFENSE) && (name.includes("·") || name.includes("(병합)") || name.includes(","))) {
    return "mixed";
  }
  return "focused";
}

export function isFocusedCommunicationObscenity(caseName) {
  return compact(caseName).includes(TARGET_OFFENSE)
    && classifyPrecedentFocus(caseName) === "focused";
}

export function focusPenalty(focus) {
  if (focus === "peripheral") return 30;
  if (focus === "mixed") return 15;
  return 0;
}

export function selectCommunicationObscenityParagraphs(
  paragraphs,
  { minParagraphs = 3, maxChars = 40_000 } = {},
) {
  const ordered = [...(paragraphs || [])]
    .map((paragraph) => ({
      paragraphId: typeof paragraph?.paragraphId === "string" ? paragraph.paragraphId : "",
      ordinal: Number(paragraph?.ordinal) || 0,
      text: typeof paragraph?.body === "string"
        ? paragraph.body.trim()
        : typeof paragraph?.text === "string" ? paragraph.text.trim() : "",
    }))
    .filter((paragraph) => paragraph.paragraphId && paragraph.text)
    .sort((left, right) => left.ordinal - right.ordinal);

  const selectedIndexes = new Set();
  ordered.forEach((paragraph, index) => {
    const text = compact(paragraph.text);
    if (!RELEVANCE_TERMS.some((term) => text.includes(term))) return;
    for (const neighbor of [index - 1, index, index + 1]) {
      if (neighbor >= 0 && neighbor < ordered.length) selectedIndexes.add(neighbor);
    }
  });

  const candidates = [...selectedIndexes].sort((left, right) => left - right).map((index) => ordered[index]);
  if (candidates.length < Math.max(1, Number(minParagraphs) || 3)) return [];

  const selected = [];
  let remaining = Math.max(0, Number(maxChars) || 0);
  for (const paragraph of candidates) {
    if (remaining === 0) break;
    const text = paragraph.text.slice(0, remaining);
    if (!text) break;
    selected.push({ ...paragraph, text });
    remaining -= text.length;
  }
  return selected.length >= Math.max(1, Number(minParagraphs) || 3) ? selected : [];
}
