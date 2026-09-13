/**
 * The vocabulary and limits both sides of the web-case feature agree on.
 *
 * The source types were written out three times — the server's schema, the
 * browser's filter, and the screen's labels — and the display count twice, as
 * 3 on the server and 6 in the browser. Neither had gone wrong yet, but a
 * number kept in two places is one that will eventually be changed in one.
 *
 * Lives under src/ because the dependency runs server → src, the same way
 * fact-tags.js is shared.
 */
export const WEB_SOURCE_TYPES = ["community", "qna", "lawyer_qna", "blog", "news"];

export const WEB_SOURCE_TYPE_LABEL = {
  community: "커뮤니티",
  qna: "지식iN",
  lawyer_qna: "변호사 Q&A",
  blog: "블로그",
  news: "뉴스",
};

// How many posts one query's batch may put on screen at once.
//
// This is the old whole-panel limit and it is no longer what a reader sees:
// the panel reads the pool, which groups and counts for itself. It survives
// because `selectWebCases` and scripts/compare-web-cache.mjs still rank a
// single batch, which is a different question from what to show.
export const WEB_CASE_DISPLAY_LIMIT = 3;

// How many posts a reader may be shown across every group.
//
// The panel used to be three links at the bottom of the summary screen, which
// is where a reader stopped reading. It has a screen of its own now, and the
// thing most people came for is the one thing there was least of.
export const WEB_CASE_POOL_LIMIT = 24;

// How many of a group are open before the reader asks for the rest. Enough to
// show what the group is; few enough that four headings still fit on a phone.
export const WEB_CASE_GROUP_VISIBLE = 5;
