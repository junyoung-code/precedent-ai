import assert from "node:assert/strict";
import test from "node:test";
import {
  WEB_CASE_GROUPS,
  WEB_CASE_MINIMUM_BASE,
  WEB_CASE_POOL_LIMIT,
  groupWebCases,
  readWebCaseCandidates,
  upsertWebCases,
} from "../server/web-case-pool.mjs";

// A reader reported for sending a picture over Kakao — the combination the
// judgments in this database actually reach a court on.
const READER = { medium: "kakao", expressionType: "sexual_image", messageForm: "image" };

function post(overrides = {}) {
  return {
    url: `https://www.lawtalk.co.kr/qna/${Math.random().toString().slice(2, 8)}`,
    title: "제목",
    quote: "요약",
    sourceType: "lawyer_qna",
    medium: "kakao",
    expression: "sexual_image",
    writerRole: "reported",
    ending: false,
    situation: null,
    ...overrides,
  };
}

// An exact tag match scores 100 on its own, which clears the floor without any
// vector — so a test that wants a post excluded has to say so with the tags.
const candidate = (item, semantic = null) => ({ item, semantic });

function allCases(groups) {
  return groups.flatMap((group) => group.cases);
}

test("puts each post in exactly one group, so the counts on screen are true", () => {
  // This post qualifies for three groups at once: it is closest, it has an
  // ending, and it is on the reader's medium. Shown three times it would read
  // as three separate accounts of three separate cases.
  const both = post({ ending: true });
  const { groups } = groupWebCases({
    candidates: [candidate(both), candidate(post({ ending: true })), candidate(post())],
    facts: READER,
    role: "reported",
  });
  const urls = allCases(groups).map((item) => item.url);
  assert.equal(new Set(urls).size, urls.length, "같은 글이 두 묶음에 나왔습니다");
});

test("keeps a post below the relevance floor out of every group", () => {
  // Different expression and no vector: one of two comparable fields matches,
  // so the base is 50 against a floor of 55. Before the pool this post would
  // still have been shown, because the query key had already vouched for it.
  const distant = post({ expression: "insult_with_sexual_terms" });
  const { groups, total } = groupWebCases({
    candidates: [candidate(distant)],
    facts: READER,
    role: "reported",
  });
  assert.equal(total, 0);
  assert.deepEqual(groups, []);
});

test("lets the bonuses order relevant posts without lifting an irrelevant one over the floor", () => {
  // +40 for the matching role and +15 for an ending would carry this to 105 if
  // the floor were applied to the total. The floor is on the base for exactly
  // this reason: a bonus says which relevant post comes first, never that an
  // unrelated post is relevant.
  const distant = post({ expression: "insult_with_sexual_terms", ending: true, writerRole: "reported" });
  const { total } = groupWebCases({ candidates: [candidate(distant)], facts: READER, role: "reported" });
  assert.equal(total, 0);
});

test("stops one site from owning a group", () => {
  const many = Array.from({ length: 8 }, () => candidate(post()));
  const { groups } = groupWebCases({ candidates: many, facts: READER, role: "reported" });
  const first = groups.find((group) => group.id === "closest");
  const lawtalk = first.cases.filter((item) => item.url.includes("lawtalk.co.kr"));
  assert.ok(lawtalk.length < first.cases.length + 1);
  assert.ok(lawtalk.length <= 3, `한 묶음에 로톡이 ${lawtalk.length}건 들어갔습니다`);
});

test("still refuses a post about a different medium, however close the vector says it is", () => {
  // The vector can be confident about two accounts that share everything but
  // where it happened. Padding a Kakao reader's panel with game chat is the web
  // section's version of inventing a precedent.
  const elsewhere = post({ medium: "game_chat" });
  const { total } = groupWebCases({
    candidates: [candidate(elsewhere, 99)],
    facts: READER,
    role: "reported",
  });
  assert.equal(total, 0);
});

test("keeps a post whose medium the rules could not read", () => {
  // `unknown` is a rule that failed, not a mismatch — the galleries write in a
  // way the extractor reads badly, and dropping those would drop the endings.
  const vague = post({ medium: "unknown", ending: true });
  const { total } = groupWebCases({ candidates: [candidate(vague, 90)], facts: READER, role: "reported" });
  assert.equal(total, 1);
});

test("gathers the posts that say how they ended into their own group", () => {
  // More endings than the first group can hold, so the rest have somewhere of
  // their own to go. An ending that is *also* among the closest stays in the
  // first group — it is the best material and belongs at the top, and the 결과
  // 있음 chip already says what it is. This group is for the others.
  const endings = Array.from({ length: 10 }, (unused, index) => candidate(post({
    ending: true, url: `https://site${index}.test/post`,
  })));
  const { groups } = groupWebCases({ candidates: endings, facts: READER, role: "reported" });
  const ending = groups.find((group) => group.id === "ending");
  assert.ok(ending, "결말 묶음이 없습니다");
  assert.ok(ending.cases.every((item) => item.ending === true));
});

test("leaves an ending in the closest group rather than moving it down to the ending group", () => {
  const only = post({ ending: true });
  const { groups } = groupWebCases({
    candidates: [candidate(only), candidate(post()), candidate(post())],
    facts: READER,
    role: "reported",
  });
  assert.equal(groups.find((group) => group.id === "closest").cases[0].url, only.url);
  assert.equal(groups.find((group) => group.id === "ending"), undefined);
});

test("offers what the other side wrote as its own group rather than mixed in", () => {
  const { groups } = groupWebCases({
    candidates: [
      ...Array.from({ length: 6 }, () => candidate(post())),
      candidate(post({ writerRole: "victim" })),
    ],
    facts: READER,
    role: "reported",
  });
  const other = groups.find((group) => group.id === "otherSide");
  assert.ok(other, "반대 입장 묶음이 없습니다");
  assert.ok(other.cases.every((item) => item.writerRole === "victim"));
});

test("does not let the catch-all group swallow the other side's posts", () => {
  // Every post that survives the medium rule is on the reader's medium or on
  // none, so 같은 매체 matches almost everything left. Ordered above 반대 입장
  // it took the victim-side posts first and that group never appeared — which
  // is what happened on a real Kakao case with two victim-side posts in reach.
  const { groups } = groupWebCases({
    candidates: [
      ...Array.from({ length: 8 }, () => candidate(post())),
      candidate(post({ writerRole: "victim", url: "https://kin.naver.com/a" })),
      candidate(post({ writerRole: "victim", url: "https://kin.naver.com/b" })),
    ],
    facts: READER,
    role: "reported",
  });
  const ids = groups.map((group) => group.id);
  assert.ok(ids.includes("otherSide"), `반대 입장 묶음이 사라졌습니다: ${ids.join(", ")}`);
  assert.ok(ids.indexOf("otherSide") < ids.indexOf("sameMedium") || !ids.includes("sameMedium"));
});

test("drops a group entirely rather than showing an empty heading", () => {
  const { groups } = groupWebCases({
    candidates: [candidate(post())],
    facts: READER,
    role: "reported",
  });
  assert.deepEqual(groups.map((group) => group.id), ["closest"]);
  assert.ok(groups.every((group) => group.cases.length > 0));
});

test("never shows more than the whole-panel limit", () => {
  const many = Array.from({ length: 200 }, (unused, index) => candidate(post({
    url: `https://example${index % 9}.test/${index}`,
    ending: index % 2 === 0,
    writerRole: index % 3 === 0 ? "victim" : "reported",
  })));
  const { total, groups } = groupWebCases({ candidates: many, facts: READER, role: "reported" });
  assert.ok(total <= WEB_CASE_POOL_LIMIT, `${total}건은 상한 ${WEB_CASE_POOL_LIMIT}을 넘습니다`);
  assert.equal(total, allCases(groups).length);
});

test("ranks on tags alone when there is no vector, and asks for none", () => {
  // The path a reader who consented to nothing takes. It must not need a query
  // vector to exist — that is what makes it free and keeps the screen from
  // being blank for them.
  const { total } = groupWebCases({
    candidates: [candidate(post()), candidate(post({ ending: true }))],
    facts: READER,
    role: "reported",
  });
  assert.equal(total, 2);
});

test("refuses to store a post the rules cannot label", async () => {
  const calls = [];
  const pool = { query: async (...args) => { calls.push(args); return { rows: [{ inserted: true }] }; } };
  const result = await upsertWebCases({
    pool,
    collectedBy: "claude",
    cases: [
      post(),
      { ...post(), sourceType: "정체불명" },
      { ...post(), url: "" },
    ],
  });
  assert.equal(result.inserted, 1);
  assert.equal(result.rejected, 2);
  assert.equal(calls.length, 1, "거절한 항목까지 데이터베이스에 보냈습니다");
});

test("does not let a weaker collector overwrite a stronger one", async () => {
  // A post the nightly refresh happens to re-find arrives with a thinner quote
  // than one written against the page itself — and the quote is what the vector
  // is built from, so a silent downgrade there is a silent downgrade of every
  // future match.
  const sql = [];
  const pool = { query: async (text, values) => { sql.push({ text, values }); return { rows: [] }; } };
  const result = await upsertWebCases({ pool, collectedBy: "openai_web_search", cases: [post()] });
  assert.equal(result.kept, 1);
  assert.match(sql[0].text, /array_position/);
});

/**
 * `facts` carries the reader's own normalised sentence, because the statute
 * screen quotes it back to them. That object is passed into the pool search, so
 * the guard that matters is which of its fields reach the database.
 */
test("sends the database tags and a limit, never anything the reader wrote", async () => {
  const sent = [];
  const pool = { query: async (text, values) => { sent.push({ text, values }); return { rows: [] }; } };
  const facts = {
    ...READER,
    normalizedText: "니애미 어쩌고 하는 성적인 욕설을 여러 번 보냈습니다",
    elementQuotes: { medium: "카카오톡으로 보냈습니다" },
  };

  await readWebCaseCandidates({ pool, queryVector: null, facts });
  await readWebCaseCandidates({ pool, queryVector: new Array(1_536).fill(0.01), facts });

  assert.equal(sent.length, 2);
  for (const { values } of sent) {
    for (const value of values) {
      assert.equal(String(value).includes("니애미"), false, "사용자가 쓴 말이 질의에 들어갔습니다");
      assert.equal(String(value).includes("카카오톡으로"), false);
    }
  }
  // Only the medium and the limit narrow it — plus the vector, which is a
  // vector and not the sentence.
  assert.deepEqual(sent[0].values.slice(1), ["kakao"]);
});

test("names a title for every group, so no heading is generated at render time", () => {
  for (const group of WEB_CASE_GROUPS) {
    assert.ok(group.title && group.title.trim(), `${group.id} 에 제목이 없습니다`);
    assert.equal(typeof group.fits, "function");
  }
  assert.ok(WEB_CASE_MINIMUM_BASE > 0 && WEB_CASE_MINIMUM_BASE <= 100);
});
