import { createHash } from "node:crypto";
import { extractFactTags } from "../src/lib/fact-tags.js";

const OUTCOME_PATTERN = /(유죄|무죄|징역|금고|벌금|집행유예|선고유예|양형|형량|처벌|상고.{0,8}(기각|인용)|원심판결|파기환송|파기자판|공소기각)/u;
const MAX_INPUT_LENGTH = 6_000;

/**
 * How a case ends before it ever reaches a judgment.
 *
 * `OUTCOME_PATTERN` above is a court's vocabulary — 유죄, 징역, 벌금, 파기환송 —
 * because it was written to keep verdicts out of precedent vectors. A gallery
 * post almost never gets that far: it ends at 불송치, 무혐의, 기소유예, and not
 * one of those words appears in the pattern above, so the first version of the
 * web-case input embedded every ending it was supposed to remove.
 *
 * Kept separate rather than folded into `OUTCOME_PATTERN` because that constant
 * feeds the stored hash of every precedent vector. Widening it would mean
 * re-embedding the whole corpus to fix a leak that only exists on this side.
 */
const PROSECUTION_OUTCOME = /불송치|송치|무혐의|혐의\s?없음|불기소|기소유예|약식|공소권\s?없음|각하|이수명령|사회봉사|합의금|사건\s?종결/g;

// The court's vocabulary again, but matched as words rather than as a reason to
// drop the sentence around them. Same source, different job — see the note in
// buildWebCaseEmbeddingInput.
const OUTCOME_WORDS = new RegExp(OUTCOME_PATTERN.source, "gu");

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

/**
 * A community post, written for comparison against what a reader described.
 *
 * Built the same way as a judgment's, and outcome sentences come out of it for
 * the same reason — even though on this side they are the most valuable
 * sentences in the post. A gallery post is worth reading because it says how it
 * ended; but somebody who has not been charged with anything should not be
 * matched to it on the word 불송치. Situation is what the vector is for, and
 * whether a post reaches an ending is carried separately, by its own flag.
 *
 * The summary rather than the original body is what gets embedded. The body is
 * somebody quoting in full what was said to them, and it is not kept anywhere
 * once the batch is stored.
 */
export function buildWebCaseEmbeddingInput({ text, facts = extractFactTags(text) }) {
  // The word, not the sentence it sits in. A judgment runs to pages, so
  // dropping whole sentences that name a verdict costs it nothing; a web case
  // is a title and two sentences, and the gallery writes the situation and the
  // ending into the same one — "성적인 욕설을 했다가 조사를 받았고, 불송치로
  // 끝났다고 적은 글입니다." Removing that sentence left the vector with a
  // header and two tags, which is the weak signal all of this exists to
  // replace. Removing the word keeps what happened and drops how it ended.
  const body = cleanText(text)
    .replace(OUTCOME_WORDS, "")
    .replace(PROSECUTION_OUTCOME, "")
    .replace(/[ \t]{2,}/g, " ")
    .slice(0, MAX_INPUT_LENGTH)
    .trim();
  return ["다른 사람이 인터넷에 쓴 비슷한 상황", ...knownFactLines(facts), body]
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
