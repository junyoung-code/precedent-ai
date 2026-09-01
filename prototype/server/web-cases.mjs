import { compareFactTags } from "../src/lib/fact-tags.js";
import { WEB_CASE_DISPLAY_LIMIT, WEB_SOURCE_TYPES } from "../src/lib/web-case-vocab.js";
import { USER_AGENT, mayFetch } from "./robots.mjs";
import { redactSensitiveText } from "../src/lib/privacy-redaction.js";

// Re-exported so callers that already read this module keep one import.
export { WEB_CASE_DISPLAY_LIMIT, WEB_SOURCE_TYPES };

// Who the post was written by. Two people can describe the same facts and want
// completely different reading: one is asking how to report, the other how to
// answer a report.
export const WEB_WRITER_ROLES = ["victim", "reported", "unclear"];

// The tag vocabularies a stored post is labelled with. They are the same values
// extractFactTags produces, so compareFactTags can weigh a post against a
// reader's facts without any translation in between.
export const WEB_MEDIUMS = [
  "kakao", "game_chat", "sns_mention", "digital_message", "bank_transfer", "direct_delivery", "unknown",
];
export const WEB_EXPRESSIONS = ["sexual_text", "insult_with_sexual_terms", "sexual_image", "other"];

// How many posts one query's batch holds. Bigger than any screen shows, because
// the batch is fetched once and narrowed per reader. The fetch schema and the
// validator have to agree on it, so it lives here and analysis-client imports it.
export const WEB_BATCH_SIZE = 12;
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
export function validateWebCases(items, { limit = WEB_BATCH_SIZE } = {}) {
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
    cases.push({
      title,
      url: url.toString(),
      sourceType,
      quote,
      // What the post is about, so a stored batch can be narrowed later without
      // asking a model again. Absent or unrecognised reads as unknown, which
      // compareFactTags skips rather than counting as a mismatch.
      medium: typeof item.medium === "string" ? item.medium : "unknown",
      expression: typeof item.expression === "string" ? item.expression : "other",
      writerRole: WEB_WRITER_ROLES.includes(item.writerRole) ? item.writerRole : "unclear",
    });
    if (cases.length >= limit) break;
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
export async function verifyWebCases({ cases, fetchImpl = fetch, timeoutMs = 8_000, minOverlap = 0.6, allowFetch = mayFetch } = {}) {
  const dropped = [];
  const checked = await Promise.all((cases || []).map(async (item) => {
    // Ask before opening. A page we are not allowed to read is a page we cannot
    // vouch for, so it is dropped rather than shown unverified — the whole
    // point of this step is that every link on screen was opened once.
    if (!(await allowFetch({ url: item.url, fetchImpl, timeoutMs }))) {
      return { item, drop: "disallowed" };
    }

    let response;
    try {
      response = await fetchImpl(item.url, {
        redirect: "follow",
        headers: { "user-agent": USER_AGENT, "accept-language": "ko" },
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

// Every medium the rules can produce needs a word here. A gap does not fail
// loudly — the query simply goes out without a medium, and a bank-transfer memo
// case comes back holding game chat posts. `other_digital` sat here for a day
// naming a value extractFactTags never produces, while two real ones were
// missing. WEB_MEDIUM_WORDS_COVERAGE in the tests is what keeps that honest.
const MEDIUM_WORDS = {
  kakao: "카카오톡",
  game_chat: "게임 채팅",
  sns_mention: "SNS 디엠",
  digital_message: "문자 메시지",
  bank_transfer: "송금 메모",
  direct_delivery: "편지 직접 전달",
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
/**
 * Narrows a stored batch down to what this reader should see.
 *
 * A cached row is shared by everyone whose facts reduce to the same tags, which
 * is the whole reason it is cheap. Picking from a batch of eight rather than
 * storing three puts the last step back under our control — and it runs on the
 * full fact comparison the precedent cards already use, rather than on a
 * model's reading of a sentence.
 */
export function selectWebCases({ cases, facts = {}, role = null, limit = WEB_CASE_DISPLAY_LIMIT } = {}) {
  const readerMedium = facts.medium && facts.medium !== "unknown" ? facts.medium : null;

  const scored = (cases || []).map((item, index) => {
    const { factScore, comparableCount } = compareFactTags(facts, {
      medium: item.medium || "unknown",
      expressionType: item.expression || "other",
    });
    // The row is already shared by both sides, so this is the only thing that
    // tells them apart: a post plainly written from the other side goes last.
    const known = item.writerRole && item.writerRole !== "unclear" && role;
    const roleScore = known ? (item.writerRole === role ? 40 : -40) : 0;
    return { item, index, score: (comparableCount === 0 ? 0 : factScore) + roleScore };
  });

  scored.sort((left, right) => right.score - left.score || left.index - right.index);
  return scored
    // A post about a different medium is not the same situation, whatever else
    // it shares. Padding the list to three with game chat posts for a bank
    // transfer memo case is the web-section version of inventing a precedent,
    // and this service does not do that. Fewer is the honest answer.
    .filter(({ item }) => !readerMedium
      || !item.medium
      || item.medium === "unknown"
      || item.medium === readerMedium)
    .slice(0, Math.max(limit, 0))
    .map(({ item }) => item);
}

export function buildWebSearchQuery(facts = {}) {
  const parts = [MEDIUM_WORDS[facts.medium], EXPRESSION_WORDS[facts.expressionType]].filter(Boolean);
  return [...parts, "통매음", "통신매체이용음란"].join(" ");
}

// How long a stored batch is considered current. Past this a reader still gets
// it immediately and a refresh runs behind the response, so nobody waits on a
// web search and a query is never fetched more than once a day.
export const WEB_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const CACHE_UPSERT_SQL = `INSERT INTO web_case_cache (query_key, cases, model, fetched_at)
 VALUES ($1, $2::jsonb, $3, now())
 ON CONFLICT (query_key) DO UPDATE SET
   cases = EXCLUDED.cases,
   model = EXCLUDED.model,
   fetched_at = now()`;

export async function readCachedWebCases({ pool, queryKey }) {
  const { rows } = await pool.query(
    "SELECT cases, model, fetched_at AS \"fetchedAt\" FROM web_case_cache WHERE query_key = $1",
    [String(queryKey)],
  );
  if (rows.length === 0) return null;
  const fetchedAt = new Date(rows[0].fetchedAt);
  return {
    cases: Array.isArray(rows[0].cases) ? rows[0].cases : [],
    model: rows[0].model,
    fetchedAt,
    stale: Date.now() - fetchedAt.getTime() > WEB_CACHE_TTL_MS,
  };
}

export async function writeCachedWebCases({ pool, queryKey, cases, model }) {
  // A search that came back with nothing is not a result worth keeping: writing
  // it would replace a good batch with an empty one and then look fresh for a
  // day. Leaving the old row alone means a reader keeps seeing what worked.
  if (!Array.isArray(cases) || cases.length === 0) return false;
  await pool.query(CACHE_UPSERT_SQL, [String(queryKey), JSON.stringify(cases), String(model || "")]);
  return true;
}
