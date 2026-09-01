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

// How many posts a reader is shown. The batch behind it is deliberately larger
// so the choice of which ones can be made per reader — see WEB_BATCH_SIZE.
export const WEB_CASE_DISPLAY_LIMIT = 3;
