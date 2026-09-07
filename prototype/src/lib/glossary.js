/**
 * The words this product cannot avoid using, explained where they are used.
 *
 * A reader arrives knowing the thing that happened to them and none of the
 * vocabulary it is discussed in. 송치, 미수, 약식명령 and 신상정보 등록 are not
 * hard ideas; they are just words nobody outside the profession has needed.
 *
 * Every explanation is read from an article and ships with a link to it, the
 * same rule the procedure timeline and the article notes hold. Where a term has
 * no article to point at, it says only what the word means and cites nothing —
 * an explanation with an invented source is worse than none.
 */

const LAW_BASE = "https://www.law.go.kr/법령";

function source(law, article) {
  return Object.freeze({
    label: `${law} ${article}`,
    url: `${LAW_BASE}/${law.replace(/\s+/g, "")}/${article}`,
  });
}

const SEX_CRIMES = "성폭력범죄의 처벌 등에 관한 특례법";
const CRIMINAL_PROCEDURE = "형사소송법";
const CRIMINAL_ACT = "형법";
const VICTIM_PROTECTION = "범죄피해자 보호법";

export const GLOSSARY = Object.freeze([
  {
    term: "통신매체",
    text: "조문은 전화, 우편, 컴퓨터, 그 밖의 통신매체를 통하여 전달된 경우를 대상으로 합니다.",
    sources: [source(SEX_CRIMES, "제13조")],
  },
  {
    term: "신상정보 등록",
    text: "유죄가 확정된 사람의 이름과 주소 등을 관할기관에 제출하게 하고 보관하는 제도입니다. 누가 대상이고 무엇이 예외인지는 성폭력처벌법 제42조가 정합니다.",
    sources: [source(SEX_CRIMES, "제42조")],
  },
  {
    term: "도달",
    text: "조문은 표현이 상대방에게 도달하게 한 경우를 대상으로 합니다. 실제로 도달했는지는 증거를 확인한 뒤 법원이 판단합니다.",
    sources: [source(SEX_CRIMES, "제13조")],
  },
  {
    term: "미수",
    text: "형법 제25조는 범죄의 실행에 착수했으나 행위를 끝내지 못했거나 결과가 발생하지 않은 경우를 미수로 정합니다. 어떤 죄의 미수를 처벌할지는 그 죄를 정한 법률이 따로 정합니다.",
    sources: [source(CRIMINAL_ACT, "제25조")],
  },
  {
    term: "불송치",
    text: "경찰이 범죄 혐의가 있다고 보지 않아 사건을 검사에게 넘기지 않는 결정입니다. 고소인은 그 사실을 통지받고 이의를 신청할 수 있습니다.",
    sources: [source(CRIMINAL_PROCEDURE, "제245조의5"), source(CRIMINAL_PROCEDURE, "제245조의6")],
  },
  {
    term: "송치",
    text: "경찰이 수사한 사건을 검사에게 넘기는 것입니다.",
    sources: [source(CRIMINAL_PROCEDURE, "제245조의5")],
  },
  {
    term: "약식명령",
    text: "정식 재판 없이 서면 심리로 벌금·과료·몰수를 정하는 재판입니다. 형사소송법 제448조는 검사의 청구가 있을 때 지방법원이 공판절차 없이 이렇게 할 수 있다고 정합니다.",
    sources: [source(CRIMINAL_PROCEDURE, "제448조")],
  },
  {
    term: "형사조정",
    text: "검사가 수사 중인 형사사건을 당사자 사이의 조정 절차에 회부하는 제도입니다. 회부할지는 검사가 정합니다.",
    sources: [source(VICTIM_PROTECTION, "제41조")],
  },
  {
    term: "고소",
    text: "범죄 피해자 등이 수사기관에 범인을 처벌해 달라는 뜻을 밝히는 것입니다.",
    sources: [source(CRIMINAL_PROCEDURE, "제223조")],
  },
  {
    term: "피의자",
    text: "수사기관이 범죄 혐의를 두고 수사하고 있는 사람입니다. 재판에 넘겨지면 피고인이라고 부릅니다.",
    sources: [],
  },
].map((entry) => Object.freeze({ ...entry, sources: Object.freeze([...entry.sources]) })));

/**
 * Splits a line into plain text and the terms worth explaining.
 *
 * Only the first appearance of each term is marked. A paragraph that says 송치
 * four times does not need four buttons in it, and a screen where every other
 * word is underlined is harder to read than one with no help at all.
 *
 * Longer terms win where two overlap, so 신상정보 등록 is one term rather than
 * 등록 inside it.
 */
export function glossTokens(text) {
  const line = String(text || "");
  const marks = [];
  for (const entry of GLOSSARY) {
    const at = line.indexOf(entry.term);
    if (at !== -1) marks.push({ at, end: at + entry.term.length, entry });
  }
  marks.sort((left, right) => left.at - right.at || (right.end - right.at) - (left.end - left.at));

  const tokens = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.at < cursor) continue;
    if (mark.at > cursor) tokens.push({ text: line.slice(cursor, mark.at) });
    tokens.push({ entry: mark.entry });
    cursor = mark.end;
  }
  if (cursor < line.length) tokens.push({ text: line.slice(cursor) });
  return tokens;
}
