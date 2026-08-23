import { redactSensitiveText } from "../src/lib/privacy-redaction.js";

export const WEB_SOURCE_TYPES = ["community", "qna", "lawyer_qna", "blog", "news"];

const MAX_CASES = 6;
const MAX_BODY = 400_000;

/**
 * A case number, or a court naming its own decision. Items that lean on these
 * are dropped: the verified cards above them are the only place this service
 * puts a judgment on screen, and a blog post that looks like one blurs the line
 * the whole result page is built around.
 */
const PRECEDENT_LOOKALIKE = [
  // Only the case-type markers a Korean case number actually uses. Matching
  // any Korean syllable between digits threw away posts that merely dated
  // themselves — "2024년 12월" reads as a case number to a loose pattern.
  /\d{4}\s?(?:도|노|고단|고합|고정|구단|구합|가단|가합|가소|드단|드합|므|카단|카합|재도|재노|초기|허|후)\s?\d{1,6}/,
  /(대법원|고등법원|지방법원|지원).{0,25}선고/,
];

// Schools and workplaces are not in the shared redaction patterns because a user
// describing their own case may need to say them. Someone else's post is a
// different matter — we are copying it onto our page.
const AFFILIATION = /[가-힣]{2,10}(대학교|대학|고등학교|중학교|초등학교|주식회사|㈜)|주식회사\s*[가-힣A-Za-z]{2,10}/;

function isPublicHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  // The URL arrives in a model's output, so it is untrusted input to a request
  // our server makes. Nothing that could point back inside gets fetched.
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^(localhost|\[|0\.|10\.|127\.|169\.254\.|192\.168\.)/.test(host)) return null;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
  return url;
}

/**
 * Drops the site's own tail from a page title.
 *
 * A model copying a title verbatim brings the whole <title> with it — "…질문 |
 * 성폭력 상담사례 | 로톡" — and three of those stacked in a list is mostly
 * boilerplate. Only short trailing segments go, so a title that really contains
 * a separator keeps its words.
 */
export function tidyTitle(value) {
  let title = String(value || "").trim();
  for (let pass = 0; pass < 2; pass += 1) {
    const match = /^(.{8,})\s[|:\-–]\s([^|:]{1,16})$/.exec(title);
    if (!match || /[.?!]$/.test(match[2].trim())) break;
    title = match[1].trim();
  }
  return title;
}

function text(value, maxLength) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed && trimmed.length <= maxLength ? trimmed : "";
}

/**
 * Checks the shape of what the model returned, without going to the network.
 *
 * Everything here is a reason the item cannot be shown at all: no reachable
 * address, someone else's identity in the quote, or a post dressed up as a
 * judgment. Reachability and whether the page really says this is a separate
 * step, because it costs requests.
 */
export function validateWebCases(items) {
  const dropped = [];
  const seen = new Set();
  const cases = [];

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") { dropped.push("shape"); continue; }
    const title = tidyTitle(text(item.title, 200));
    const quote = text(item.quote, 300);
    const sourceType = WEB_SOURCE_TYPES.includes(item.sourceType) ? item.sourceType : "";
    const url = isPublicHttpUrl(typeof item.url === "string" ? item.url.trim() : "");

    if (!title || !quote || !sourceType || !url) { dropped.push("shape"); continue; }
    if (redactSensitiveText(quote).redactionCount > 0 || AFFILIATION.test(quote)) { dropped.push("identity"); continue; }
    if (PRECEDENT_LOOKALIKE.some((pattern) => pattern.test(quote) || pattern.test(title))) { dropped.push("precedentLookalike"); continue; }

    const key = `${url.host}${url.pathname}${url.search}`;
    if (seen.has(key)) { dropped.push("duplicate"); continue; }
    seen.add(key);
    cases.push({ title, url: url.toString(), sourceType, quote });
    if (cases.length >= MAX_CASES) break;
  }

  return { cases, dropped };
}

function words(value) {
  return [...new Set(String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter((word) => word.length >= 2))];
}

/**
 * Asks each page whether it exists and whether it is about what the model said.
 *
 * The model writes the address and the title as free text — the search tool
 * returns no citations alongside a json_schema response, so there is nothing to
 * check them against except the page itself. An unreachable link, or one whose
 * text carries little of the reported title, is a link we cannot vouch for.
 */
export async function verifyWebCases({ cases, fetchImpl = fetch, timeoutMs = 8_000, minOverlap = 0.6 } = {}) {
  const dropped = [];
  const checked = await Promise.all((cases || []).map(async (item) => {
    let response;
    try {
      response = await fetchImpl(item.url, {
        redirect: "follow",
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "accept-language": "ko" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { item, drop: "unreachable" };
    }
    if (!response.ok) return { item, drop: "unreachable" };

    let body = "";
    try {
      body = (await response.text()).slice(0, MAX_BODY);
    } catch {
      return { item, drop: "unreachable" };
    }
    const page = body.replace(/<[^>]*>/g, " ").toLowerCase();
    const titleWords = words(item.title);
    if (titleWords.length === 0) return { item, drop: "unverified" };
    const found = titleWords.filter((word) => page.includes(word)).length;
    if (found / titleWords.length < minOverlap) return { item, drop: "unverified" };
    return { item, drop: null };
  }));

  const verified = [];
  for (const { item, drop } of checked) {
    if (drop) dropped.push(drop);
    else verified.push(item);
  }
  return { cases: verified, dropped };
}

const MEDIUM_WORDS = {
  kakao: "카카오톡",
  game_chat: "게임 채팅",
  sns_mention: "SNS 디엠",
  digital_message: "문자 메시지",
  other_digital: "온라인",
};

const EXPRESSION_WORDS = {
  sexual_image: "음란 사진 전송",
  insult_with_sexual_terms: "성적 욕설 패드립",
  sexual_text: "성적인 메시지",
};

/**
 * The words the search actually goes out with.
 *
 * A victim's own sentences are not sent to a search engine — they describe a
 * sex offence and name whoever was involved. What travels instead is the case
 * reduced to its neutral tags, which is also what makes the results comparable:
 * the reader wants posts about the same kind of situation, not their own words
 * echoed back.
 */
export function buildWebSearchQuery(facts = {}) {
  const parts = [MEDIUM_WORDS[facts.medium], EXPRESSION_WORDS[facts.expressionType]].filter(Boolean);
  return [...parts, "통매음", "통신매체이용음란"].join(" ");
}
