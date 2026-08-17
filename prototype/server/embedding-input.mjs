import { createHash } from "node:crypto";
import { extractFactTags } from "../src/lib/fact-tags.js";

const OUTCOME_PATTERN = /(유죄|무죄|징역|금고|벌금|집행유예|선고유예|양형|형량|처벌|상고.{0,8}(기각|인용)|원심판결|파기환송|파기자판|공소기각)/u;
const MAX_INPUT_LENGTH = 6_000;

function cleanText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\r/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function withoutOutcomeSentences(value) {
  return cleanText(value)
    .split(/(?<=[.!?。]|다\.)\s+|\n+/u)
    .map((part) => part.trim())
    .filter((part) => part && !OUTCOME_PATTERN.test(part))
    .join("\n")
    .slice(0, MAX_INPUT_LENGTH);
}

function knownFactLines(facts) {
  const fields = [
    ["medium", facts.medium],
    ["messageForm", facts.messageForm],
    ["recipientIdentification", facts.recipientIdentification],
    ["reachedRecipient", facts.reachedRecipient],
    ["relationship", facts.relationship],
    ["context", facts.context],
    ["expressionType", facts.expressionType],
    ["repetition", facts.repetition],
  ];
  return fields
    .filter(([, value]) => value && !["unknown", "other"].includes(value))
    .map(([name, value]) => `${name}: ${value}`)
    .concat((facts.issueTags || []).map((value) => `issue: ${value}`));
}

export function buildPrecedentEmbeddingInput({ sourceText, facts = extractFactTags(sourceText) }) {
  const body = withoutOutcomeSentences(sourceText);
  return ["검증된 공개 판례의 중립적 사실관계", ...knownFactLines(facts), body]
    .filter(Boolean)
    .join("\n");
}

export function buildQueryEmbeddingInput(query) {
  const cleaned = withoutOutcomeSentences(query);
  const facts = extractFactTags(cleaned);
  return ["사용자가 입력한 중립적 사실관계", ...knownFactLines(facts), cleaned]
    .filter(Boolean)
    .join("\n");
}

export function hashEmbeddingInput(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
