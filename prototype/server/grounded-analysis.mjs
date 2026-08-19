import { ARTICLE_13_ELEMENTS } from "./statute-elements.mjs";

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sentence(value, maxLength = 400) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= maxLength ? text : "";
}

/**
 * Language that decides the user's case. The service compares facts and quotes
 * records; it does not tell anyone whether an offence is made out, and a model
 * asked to "analyse" drifts here on its own.
 */
const VERDICT_PATTERNS = [
  /해당(합니다|한다|됩니다|된다|하는\s*것으로|될\s*(것|가능))/,
  /성립(합니다|한다|하는|할\s*(것|가능|수)|될)/,
  /충족(합니다|한다|하는\s*것으로|됩니다)/,
  /처벌(받습니다|받게|될\s*(것|가능)|이\s*예상)/,
  /(유죄|무죄|기소|고소|신고).{0,10}(가능성|확률|예상|될\s*것|하면\s*됩니다)/,
  /(승소|패소|형량|양형).{0,6}(예상|가능|은\s*\d)/,
  /범죄가\s*(됩니다|된다|아닙니다)/,
];

// A note about a precedent may say what that court did — the card already quotes
// its order. What it may not do is turn that into a statement about the reader.
const ABOUT_THE_READER = /(회원님|귀하|당신|의뢰인|사용자)\s*(의)?\s*(사건|상황|경우)?[^.]{0,20}(해당|성립|충족|처벌|유죄|무죄)/;

function isNeutral(text, { aboutPrecedent = false } = {}) {
  if (aboutPrecedent) return !ABOUT_THE_READER.test(text);
  return !VERDICT_PATTERNS.some((pattern) => pattern.test(text)) && !ABOUT_THE_READER.test(text);
}

/**
 * Keeps only the parts of a model's analysis that are checkable.
 *
 * Unlike the grounded summary this never throws: the analysis is an extra layer
 * over a result that already stands on its own, so a bad sentence is dropped
 * rather than failing the whole request. What survives is reported so the caller
 * can tell an empty analysis from a censored one.
 */
export function validateGroundedAnalysis(payload, allowedCaseNumbers) {
  const allowed = allowedCaseNumbers instanceof Set ? allowedCaseNumbers : new Set(allowedCaseNumbers || []);
  const elementIds = new Set(ARTICLE_13_ELEMENTS.map((item) => item.id));
  const dropped = [];

  if (!isPlainObject(payload)) return { overview: [], elementNotes: [], precedentNotes: [], nextSteps: [], dropped: ["payload"] };

  const overview = (Array.isArray(payload.overview) ? payload.overview : [])
    .map((item) => sentence(item))
    .filter((text) => {
      if (!text) return false;
      if (isNeutral(text)) return true;
      dropped.push("overview");
      return false;
    })
    .slice(0, 4);

  const seenElements = new Set();
  const elementNotes = (Array.isArray(payload.elementNotes) ? payload.elementNotes : [])
    .map((item) => ({ id: isPlainObject(item) ? String(item.id || "") : "", text: sentence(item?.text) }))
    .filter((item) => {
      if (!item.id || !item.text || !elementIds.has(item.id) || seenElements.has(item.id)) {
        dropped.push("elementNote");
        return false;
      }
      if (!isNeutral(item.text)) {
        dropped.push("elementNote");
        return false;
      }
      seenElements.add(item.id);
      return true;
    });

  const precedentNotes = (Array.isArray(payload.precedentNotes) ? payload.precedentNotes : [])
    .map((item) => ({ caseNumber: isPlainObject(item) ? String(item.caseNumber || "") : "", text: sentence(item?.text) }))
    .filter((item) => {
      // The same rule the summary uses on paragraph ids: a citation the caller
      // did not supply cannot be checked, so it does not ship.
      if (!item.caseNumber || !item.text || !allowed.has(item.caseNumber) || !isNeutral(item.text, { aboutPrecedent: true })) {
        dropped.push("precedentNote");
        return false;
      }
      return true;
    })
    .slice(0, 6);

  const nextSteps = (Array.isArray(payload.nextSteps) ? payload.nextSteps : [])
    .map((item) => sentence(item, 200))
    .filter((text) => {
      if (!text) return false;
      if (isNeutral(text)) return true;
      dropped.push("nextStep");
      return false;
    })
    .slice(0, 5);

  return { overview, elementNotes, precedentNotes, nextSteps, dropped };
}
