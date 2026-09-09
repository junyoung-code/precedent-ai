/**
 * Tells a person's post apart from a law firm's, and notices when a post has an
 * ending.
 *
 * A community is worth reading here for one reason: Lawtalk consultation posts
 * are questions that stop at the question, and someone deciding what to do next
 * wants to know how it turned out. Measuring a real batch of 48 posts, a third
 * carried an ending or field-tested advice — and a seventh were law firm
 * marketing wearing a community post's clothes. The first pass at this filter
 * caught none of those seven: it read "사건 핵심 요약" only in the opening line,
 * and every SEO post buried it further down.
 *
 * So the vocabulary here is not guessed. `fixtures/dcinside-posts.json` holds
 * those 48 posts with the labels a person gave them, and the tests fail when
 * this file stops agreeing with that person.
 */

// How a firm writes when it wants to be found: it explains, and it explains to
// someone it is addressing politely. A person telling a gallery what happened
// to them does neither.
const MARKETING_REGISTER = [
  /정리해\s?드리|알려\s?드리|안내해\s?드리|도와\s?드리|설명해\s?드리/,
  /드립니다|바랍니다|하시기\s|하십시오|주시기\s/,
  /법무법인|변호사(?:입니다|가\s|를\s?선임|\s?상담)|저희\s?(?:사무소|로펌|법인)/,
  /무료\s?상담|상담\s?(?:문의|신청|받아|주세요)|문의\s?(?:주세요|바랍니다)/,
  /사건\s?(?:핵심\s?)?요약|주요\s?내용\s?요약|사건\s?개요|판결\s?요지|처벌\s?수위/,
];

// A reference card rather than an experience: the statute quoted as authority,
// or the offence defined the way a dictionary would.
const STATUTE_RECITAL = [
  /제\s?13\s?조\s?\(통신매체(?:를\s?)?이용(?:한)?\s?음란/,
  /[「『]?성폭력범죄의?\s?처벌\s?등에?\s?관한\s?특례법[」』]?\s*제?\s?13/,
  /통[신매]{1,2}음?\s?\((?:통신매체이용음란죄?)\)\s?은/,
  /자기\s?또는\s?(?:다른\s?사람|타인)의\s?성적\s?욕망을\s?(?:유발|만족)/,
];

// What a person sounds like. The gallery's register is the one thing a firm
// does not imitate, and it is the only reason a genuinely useful post that
// quotes a case number survives this file — one of the six advice posts cites
// 대법원 2022도10688 and would otherwise read as a recital.
// Kept narrow on purpose. The first version counted 받았음, 없음, 있음 and 는거,
// all of which a firm writes too — "과거 통매음으로 벌금형을 2차례 받았음에도"
// sits in the middle of the clearest marketing post in the batch, and rescued
// it. What survives here is what a brochure will not print.
const COMMUNITY_VOICE = [
  /(?:거|것)임|셈임|임\?|음\?|냐\?|노\?|자나|하셈|하지마|해봄|했노|하노/,
  /ㅇㅇ|ㅋㅋ|ㅎㅎ|ㅅㅂ|ㅆㅂ|ㄹㅇ|ㅈㄴ|ㄷㄷ|ㅠㅠ|ㅜㅜ|ㅈㄹ/,
  /씨발|시발|존나|개같|병신|새끼|좆같|엿같|ㅈ같/,
  // Second person. A firm addresses 회원님 or nobody; it never says 니가.
  /니가|니한테|너가|너한테|느그|얘들아|형들아|게이야/,
];

// A brochure explains, and it explains politely. A person telling a gallery
// what happened writes almost none of these; a firm's post is made of them.
const POLITE_SENTENCE = /(?:습니다|입니다|합니다|됩니다|세요|어요|네요|드려요)(?=[\s.,·]|$)/g;
const POLITE_DENSITY = 3;

// A post whose whole body is somebody's marketing link.
const OUTBOUND_ONLY = /^\s*https?:\/\/\S+\s*$/;
const LAW_FIRM_HOST = /(?:law|lawyer|attorney|법률|변호)/i;

// The gallery's own house ads, which arrive in the listing alongside real posts.
const HOUSE_AD = /디시\s?공식|공식설계사|보험\s?(?:상담|진단|정밀)|디시인사이드\s?회원들을\s?위한/;

const hits = (patterns, text) => patterns.filter((pattern) => pattern.test(text)).length;

function bodyText(post) {
  return String(post?.body || "");
}

/**
 * Whether the body reads as a person rather than a brochure.
 *
 * Deliberately reads the body alone. A title carries the gallery's register
 * even when the body underneath is a pasted statute — "통매음 이거만 봐도 절대
 * 안됨ㅇㅇ" sits above nothing but Article 13 — and counting the title would
 * hand every recital an alibi.
 */
export function hasCommunityVoice(post) {
  return hits(COMMUNITY_VOICE, bodyText(post)) > 0;
}

/**
 * Whether this post was written to be found rather than to be answered.
 *
 * Two marketing signals are required, or one recital of the statute, and a
 * personal voice in the body overrides both — a firm does not write "그냥
 * 나혼자 똥꼬쇼함".
 */
export function isMarketingPost(post) {
  const body = bodyText(post);
  const title = String(post?.title || "");
  if (HOUSE_AD.test(title) || HOUSE_AD.test(body)) return true;

  const trimmed = body.trim();
  if (OUTBOUND_ONLY.test(trimmed) && LAW_FIRM_HOST.test(trimmed)) return true;

  if (hasCommunityVoice(post)) return false;
  if (hits(MARKETING_REGISTER, body) >= 2) return true;
  // Nothing named a firm, but the whole post is written in the polite
  // explaining register — a counsellor's reply pasted in, or an answer written
  // for a search engine. One such post carried no other signal at all:
  // 성생활을 동의 없이 유포한 것은 … 해당할 수 있습니다.
  return (body.match(POLITE_SENTENCE) || []).length >= POLITE_DENSITY;
}

/**
 * Whether the post is the statute rather than an account of anything.
 *
 * Separate from marketing, because it is a different thing and pretending
 * otherwise made the labels incoherent: two posts in the batch paste Article 13
 * and add a line of their own, and calling one a firm's work and the other a
 * person's was a distinction that could not be drawn. Neither is somebody's
 * experience, which is the only thing this source is here to supply.
 *
 * A personal voice does not rescue a recital — "이거만 봐도 절대 안됨ㅇㅇ" above
 * Article 13 pasted twice is still Article 13 pasted twice.
 */
export function isStatuteRecital(post) {
  return hits(STATUTE_RECITAL, bodyText(post)) >= 1;
}

// A disposition that ended the matter, reported as something that happened.
//
// Two things are deliberately absent. 송치 and 고소당함 are stages, not endings
// — "송치전에 합의하는게 맞음 원래?" is somebody mid-process asking what comes
// next, and counting them read a fifth of the batch as endings that a person
// had read as questions. And the verb matters as much as the noun: 불송치 in
// "불송치 가능할까요?" is a hope, not a result.
const ENDING_EVENTS = [
  /불송치\s?\S{0,6}(?:됐|되었|뜸|떴|나옴|났|받았|처분|인증)/,
  /무혐의\s?\S{0,6}(?:받았|나왔|났|됐|처분)|혐의\s?없음\s?(?:처분|나왔)/,
  /기소유예\s?\S{0,6}(?:받았|나왔|났|됐)/,
  /벌금\s?\d+\s?(?:만\s?원?)?.{0,12}(?:냈|냇|납부|다\s?냄)|벌금형\s?\S{0,6}(?:받았|나왔|났)/,
  /약식\s?(?:기소|명령)\s?\S{0,6}(?:받았|나왔|됐)/,
  /합의\s?(?:했|봤|하고\s?끝|보고\s?끝|성립됐|성립된)/,
  /(?:징역|집행유예|사회봉사|이수명령)\s?\S{0,14}(?:받았|선고|나왔|났|됐|끝)|선고받/,
  /불기소\s?\S{0,6}(?:처분|됐|나왔)|기각\s?\S{0,6}(?:당했|됐|나왔|됨|한다고)/,
  /사건\s?종결|종결\s?처리|공소권\s?없음/,
];

/**
 * 후기 — the word people use for the genre, not for anything that happened.
 *
 * Kept apart from the dispositions above because the two are not equally
 * reliable in a title. "불송치떴고" and "벌금 400 벌써 다냇는데" are statements
 * of fact wherever they appear; 후기 is a label anybody can put on anything,
 * and the complainant-side query has to ask by it, because that is what those
 * writers call their posts. It brought back "일단 첫번째 글 링크 달아놓음" and
 * "그런건 없고 점메추나 해줘봐" under that title.
 *
 * Guarded further, because asking for one reads the same to a substring match:
 * "후기 좀 끓여와라" and "여기 겜매음 후기는 많은데" are a request and an
 * observation.
 */
const GENRE_MARKER = /후기(?!\s*(?:좀|는|도|가)?\s*(?:알려|써|올려|끓여|많|없|구함|구해|부탁))/;

// How much of an account has to sit under a post that only calls itself a 후기.
// The dispositions need none of this: "성드립 치긴 했는데 불송치 나옴" is
// sixteen characters and says everything.
const MIN_ACCOUNT_LENGTH = 60;

// Where one thought stops, so a disposition can be read together with the
// ending that governs it. Follows the clause boundary fact-tags.js already uses
// on the reader's own description.
// Captured rather than consumed, because the terminator is the evidence: split
// on a bare `?` and "언제쯤 사건종결됨?" arrives as "언제쯤 사건종결됨", with the
// one mark that made it a question thrown away by the split itself.
const CLAUSE = /([.!?？\n]|[,·]|는데|지만|면서|더니)/;

function clausesOf(text) {
  const parts = String(text).split(CLAUSE);
  const clauses = [];
  for (let index = 0; index < parts.length; index += 2) {
    clauses.push(`${parts[index] || ""}${parts[index + 1] || ""}`);
  }
  return clauses;
}

// The same words in a clause that is asking rather than telling. Checked after
// a disposition is found, not before, so this only ever removes a match.
//
// Without it the rules read "언제쯤 사건종결됨?" as an ending because 사건종결 is
// in it, and "판례보면 꼭 피의자가 합의 봤다거나" as an ending because 합의 봤 is
// in it — one a hypothetical, the other somebody's commentary on case law.
// Tuning on the labelled 48 alone did not surface this; running the collector
// on two queries that were not in that sample did, at three false positives in
// seven.
const ASKING = /[?？]|나요|까요|ㄹ까|을까|는지|은지|됨\?|임\?|가능(?:할|한|함|성)|다거나|려면|어떻게|어떡|얼마(?:나|임|나요)/;

// Somebody else's ending, in a post whose writer is still waiting for their
// own. Both survivors of the first clause fix were this: "같이 신고당한 친구는
// … 불송치 떴는데" and "다른사람은 얼마에 합의했냐 물으니 300만원에 했다는데".
// A reader opening either one finds a case that is not the one the title
// promised.
const THIRD_PARTY = /친구(?:는|가|도|랑|한테)|다른\s?사람|남들은|지인(?:은|이)|걔(?:는|가)|얘(?:는|가)|형(?:은|이)\s|아는\s?(?:사람|애|형)/;

/**
 * Whether the post says how it turned out.
 *
 * This describes the post, not the reader's case. Nothing downstream is allowed
 * to turn a count of these into a rate — a handful of self-selected posts is not
 * evidence about anybody's odds, and a screen that said "불송치 60%" would be
 * predicting an outcome, which this service does not do.
 */
export function hasEnding(post) {
  const text = `${post?.title || ""}\n${bodyText(post)}`;
  const told = clausesOf(text).some((clause) => hits(ENDING_EVENTS, clause) > 0
    && !ASKING.test(clause)
    && !THIRD_PARTY.test(clause));
  if (told) return true;
  // Nothing named a disposition, but the post calls itself a 후기 and there is
  // an account under it. Addresses do not count toward that: the post that
  // forced this rule cleared an earlier floor on a 90-character gallery URL
  // alone, and the model summarising it was what noticed — 이 글에는 이전
  // 게시물로 연결되는 링크만 있으며, 구체적인 내용은 적혀 있지 않다.
  // Only in the title. A person titles their own post 후기; the word in a body
  // is almost always about somebody else's — "다른 통매음 유동이 … 고소 후기인데
  // 처벌 맥였다고 함" and "여기갤에 고소 후기도 올린 새끼도 있고 … 뭐가 진실?"
  // both arrived once the complainant-side query was added, and both are a
  // gallery talking about posts rather than being one.
  if (!GENRE_MARKER.test(String(post?.title || ""))) return false;
  return bodyText(post).replace(/https?:\/\/\S+/g, "").trim().length >= MIN_ACCOUNT_LENGTH;
}

/**
 * Whether the post is about being baited into the offence for a settlement.
 *
 * The galleries call the person doing it a 통매음 헌터: they open a random chat,
 * move it to another app, provoke something sexual, then say a report has been
 * filed and ask for money to withdraw it. Neither the judgments nor Lawtalk
 * know the word, and somebody it happened to needs different reading from
 * somebody in an ordinary case.
 *
 * Keyed on the word itself, and only on the word, because that is what the
 * measurement supported: across 56 posts, not one was identifiable from the
 * surrounding circumstances — random chat, moving apps, the threat, the money —
 * without 헌터 also appearing. Inferring the situation from prose was not
 * something the data would carry, so this does not try.
 *
 * Nothing downstream tells a reader they were hunted. This only decides which
 * post to put in front of them.
 */
export function hunterSituation(post) {
  return /헌터/.test(`${post?.title || ""} ${bodyText(post)}`);
}

// Measured across the title and the body together, and set low, because a
// gallery packs a whole case into a line: "재항고 했는데 또기각 당하고 대법원
// 까지 감 대법관이 이유없으므로 기각한다고 끝임ㄷㄷㄷㄷ" is 46 characters and
// runs from the appeal to the Supreme Court. A 60-character floor on the body
// alone threw away four of the ten endings in the sample, including that one,
// and one whose ending was in its title.
const MIN_POST_LENGTH = 35;

/**
 * The one call the collector makes: is this post worth showing to anybody?
 *
 * The bar is an ending. Lawtalk already supplies "somebody in my situation
 * asked this" — cleanly, safely, and in quantity — so a question copied out of
 * a gallery adds nothing but coarser language. What Lawtalk structurally cannot
 * supply is how it turned out, because a consultation post stops at the
 * question. That is the whole reason this source exists, so it is the whole
 * bar.
 *
 * Returns the reason rather than a bare false, because the refresh counts the
 * reasons and a batch that suddenly drops everything for one reason is how we
 * find out the site changed shape.
 */
export function screenPost(post) {
  if (!post || typeof post !== "object") return { keep: false, reason: "shape" };
  if (!post.title || !post.url) return { keep: false, reason: "shape" };
  if (isMarketingPost(post)) return { keep: false, reason: "marketing" };
  if (isStatuteRecital(post)) return { keep: false, reason: "recital" };
  if (!hasEnding(post)) return { keep: false, reason: "noEnding" };
  const length = `${post.title} ${bodyText(post)}`.replace(/https?:\/\/\S+/g, "").trim().length;
  if (length < MIN_POST_LENGTH) return { keep: false, reason: "thin" };
  return { keep: true, reason: null, ending: true };
}
