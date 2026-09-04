import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { GUIDE_STEPS } from "../src/lib/guide-script.js";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

test("shows compact pre-use and generated-result AI disclosures", () => {
  assert.match(appSource, /AI가 공개 판례를 검색·비교합니다/);
  assert.equal(
    appSource.includes("이 서비스는 AI를 사용하여 공개 판례를 검색·비교하며 일부 설명을 생성합니다"),
    false,
  );
  assert.match(appSource, /AI 생성 요약/);
  assert.match(
    appSource,
    /정확한 내용은 공식 원문을 확인하십시오/,
  );
});

test("keeps role selection inside the composer and scrolls to results", () => {
  assert.match(appSource, /role-segment/);
  assert.match(appSource, /피해자/);
  assert.match(appSource, /피신고인/);
  assert.match(appSource, /scrollIntoView/);
  assert.match(appSource, /prefers-reduced-motion: reduce/);
});

test("does not use legal-outcome probability labels", () => {
  for (const banned of ["성립 확률", "고소 확률", "유죄 확률", "무죄 가능성", "처벌 예상"]) {
    assert.equal(appSource.includes(banned), false, `banned UI copy: ${banned}`);
  }
  assert.match(appSource, /사실관계 유사도/);
});

test("keeps the no-fabrication empty state visible", () => {
  assert.match(appSource, /없는 판례를 만들어 보여주지 않습니다/);
  assert.match(appSource, /공식 원문 보기/);
});

test("keeps the save-result button labelled when its text is hidden", () => {
  // A bare text node cannot be hidden by CSS, so the label needs an element
  // and the button needs a name that survives hiding it.
  assert.match(appSource, /className="print-button-label">결과 저장</);
  assert.match(appSource, /className="print-button"[\s\S]{0,120}?aria-label="결과 저장"/);
});

test("explains a card that carries no summary instead of leaving a gap", () => {
  assert.match(appSource, /SUMMARY_ABSENCE_REASON/);
  assert.match(appSource, /다른 죄명이 함께 판단된 판례여서 요약을 제공하지 않습니다/);
  assert.match(appSource, /!result\.summary\?\.length/);
  // The explanation must not read as a legal conclusion.
  for (const banned of ["무죄", "유죄", "혐의없음"]) {
    assert.equal(appSource.includes(`${banned}여서 요약`), false);
  }
});

test("shows what the court ordered in the precedent, quoted and labelled", () => {
  assert.match(appSource, /이 판례의 결론/);
  assert.match(appSource, /className="disposition-order">\{result\.disposition\.orderText\}/);
  assert.match(appSource, /DISPOSITION_MEANING\[result\.disposition\.kind\] \|\| DISPOSITION_MEANING\.other/);
  // A mixed-offence precedent already withholds its summary for the same reason;
  // its order is not this offence's conclusion either.
  assert.match(appSource, /result\.focus !== "focused" && .{0,40}DISPOSITION_SCOPE_CAVEAT/);
  assert.match(appSource, /위 주문이 통신매체이용음란 부분만의 결론은 아닙니다/);
});

test("keeps the precedent's order from reading as a prediction about the user", () => {
  assert.match(appSource, /회원님 사건의 결과를 예측한 것이 아닙니다/);
  // An order carrying several decisions is never reduced to one of them.
  assert.match(appSource, /multiple: "하나의 주문에 여러 갈래의 판단이 함께 담겨 있습니다/);
  // Remand and first-instance sentences are the two that read as final but are not.
  assert.match(appSource, /remand: "[^"]*결론이 확정된 것은 아닙니다/);
  assert.match(appSource, /sentenced: "[^"]*상급심에서 달라질 수 있습니다/);
  for (const banned of ["성립 확률", "고소 확률", "유죄 확률", "무죄 가능성", "처벌 예상", "예상 형량"]) {
    assert.equal(appSource.includes(banned), false, `banned UI copy: ${banned}`);
  }
});

test("retries a failed search with a new session instead of the deleted one", () => {
  assert.match(appSource, /onRetry=\{retrySearch\}/);
  // Retry rebuilds a session from what the browser still holds.
  assert.match(appSource, /createIntake\(\{ role, redactedText: submittedDescription \}\)/);
  assert.match(appSource, /answersRef\.current\[question\.id\]/);
  // The privacy contract stays: the session is released as the search settles.
  assert.match(appSource, /activeSessionRef\.current = null;\s*\n\s*setIntake\(\{ sessionId: null, questions: \[\] \}\);/);
  assert.doesNotMatch(appSource, /onRetry=\{\(\) => intake\.sessionId/);
});

test("releases an abandoned session on unmount and on page hide", () => {
  assert.match(appSource, /addEventListener\("pagehide", abandon\)/);
  assert.match(appSource, /removeEventListener\("pagehide", abandon\)/);
  assert.match(appSource, /abandonIntake\(\{ sessionId \}\)/);
  // One release per session: the ref is cleared before the request goes out.
  assert.match(appSource, /activeSessionRef\.current = null;\s*\n\s*abandonIntake/);
});

test("accepts a capture from the clipboard and from a drop, not just the file picker", () => {
  assert.match(appSource, /onPaste=\{handlePaste\}/);
  assert.match(appSource, /onDrop=\{handleDrop\}/);
  assert.match(appSource, /clipboardData\?\.items/);
  assert.match(appSource, /dataTransfer\?\.files/);
  // Every entry point runs the same type and size checks.
  assert.equal(appSource.match(/acceptFile\(/g).length >= 4, true);
  assert.equal((appSource.match(/PNG, JPG, WEBP 이미지만 첨부할 수 있습니다/g) || []).length, 1);
});

test("offers a labelled way to remove an attached capture", () => {
  // Both the toolbar chip and the preview overlay clear the attachment.
  assert.equal((appSource.match(/onClick=\{removeFile\}/g) || []).length, 2);
  assert.match(appSource, /className="capture-remove"/);
  assert.match(appSource, /aria-label="첨부한 캡처 삭제"/);
  assert.match(appSource, /aria-label=\{`\$\{file\.name\} 삭제`\}/);
});

test("does not keep capture text the user can no longer see", () => {
  // Removing the capture takes its transcript with it.
  assert.match(appSource, /setPreviewUrl\(""\);\s*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*setTranscript\(""\)/);
  // Starting a new case remounts the composer instead of clearing fields one by one.
  assert.match(appSource, /setCaseKey\(\(key\) => key \+ 1\)/);
  assert.match(appSource, /<HomeView\s*\n\s*key=\{caseKey\}/);
});

test("stops a submit that would drop an untranscribed capture", () => {
  assert.match(appSource, /if \(file && !transcript\.trim\(\) && !captureConfirmed\)/);
  assert.match(appSource, /캡처를 아직 옮겨 적지 않았습니다/);
  assert.match(appSource, /캡처 없이 검색/);
  // The warning is reachable: it scrolls into view and can be overridden once.
  assert.match(appSource, /captureNoticeRef/);
  assert.match(appSource, /submitWithoutTranscript/);
});

test("requires explicit external AI consent and uses the private intake client", () => {
  // One checkbox now covers every external call, so its wording has to name all
  // of them — a consent narrower than what is sent is not consent.
  assert.match(appSource, /OpenAI API로 전송해 의미 검색, 법조문 분석, 비슷한 사례 웹 검색에 사용합니다/);
  assert.match(appSource, /AI 분석은 실행하지 않습니다/);
  assert.match(appSource, /allowExternalAi/);
  assert.match(appSource, /createIntake/);
  assert.match(appSource, /completeIntake/);
  assert.match(appSource, /캡처 이미지는 서버 또는 외부 AI에 전송하지 않습니다/);
  assert.match(appSource, /중단된 입력은 최대 1시간 뒤 삭제됩니다/);
  assert.doesNotMatch(appSource, /rankPrecedents/);
  assert.match(appSource, /result\.summary\?\.length/);
  assert.match(appSource, /검색 서버에 연결하지 못했습니다/);
});

test("moves between records and generated text one screen at a time", () => {
  // Arrows carry the destination's name, so a reader knows where they are going
  // before they commit to the move.
  assert.match(appSource, /aria-label=\{`다음 화면: \$\{next\.title\}`\}/);
  assert.match(appSource, /aria-label=\{`이전 화면: \$\{previous\.title\}`\}/);
  assert.match(appSource, /className="deck-arrow-label">\{next\.title\}/);
  assert.match(appSource, /법조문에 비춰본 내 상황/);
  assert.match(appSource, /AI가 정리한 내 사건/);
  // Arrow keys move the deck too.
  assert.match(appSource, /event\.key === "ArrowRight"/);
  assert.match(appSource, /event\.key === "ArrowLeft"/);
  // Hidden screens stay in the document so printing can reveal them.
  assert.match(appSource, /hidden=\{position !== index\}/);
  // A generated screen says so on the screen and on the arrow that leads to it.
  assert.match(appSource, /screen\.generated && <span className="screen-ai"/);
  assert.match(appSource, /AI가 쓴 설명입니다\. 판례 화면의 기록과 성격이 다릅니다/);
});

test("shows the wait as steps rather than one stalled line", () => {
  assert.match(appSource, /SEARCH_STEPS/);
  assert.match(appSource, /role="status" aria-live="polite"/);
  assert.match(appSource, /검증된 공개 판례와 사실관계를 비교하고 있습니다/);
  // The timer is cleared, or leaving mid-search leaks an interval per search.
  assert.match(appSource, /return \(\) => clearInterval\(timer\)/);
});

test("marks posts strangers wrote as the least reliable thing on the page", () => {
  // This is the section most readers will actually read. A community answer
  // about whether something is a crime is wrong often enough that the warning
  // sits above the list rather than under it.
  assert.match(appSource, /개인이 인터넷에 쓴 글입니다\. 법적으로 정확하지 않을 수 있습니다/);
  assert.match(appSource, /판단의 근거로 삼지 마시고, 참고만 하십시오/);
  assert.match(appSource, /위 판례 화면의 기록과는 성격이 완전히 다릅니다/);
  // The warning renders before the list it warns about.
  assert.ok(appSource.indexOf("web-cases-warning") < appSource.indexOf("web-case-list"));
  // Each link is labelled with where it came from, and opens away from us.
  assert.match(appSource, /SOURCE_TYPE_LABEL\[item\.sourceType\]/);
  assert.match(appSource, /rel="noopener noreferrer nofollow"/);
  // The service says plainly which half is checked and which half is generated.
  assert.match(appSource, /서버가 각 주소에 실제로 접속해 존재를 확인한 것만 남겼습니다/);
  assert.match(appSource, /요약은 AI가 쓴 것이므로 원문을 직접 확인하십시오/);
});

test("keeps the web section from reading as a verdict", () => {
  const panel = appSource.slice(appSource.indexOf("function WebCasesPanel"), appSource.indexOf("function AiSummaryPanel"));
  for (const banned of ["해당됩니다", "성립합니다", "유죄", "무죄", "처벌받습니다"]) {
    assert.equal(panel.includes(banned), false, `banned web copy: ${banned}`);
  }
});

test("shows the shape of what a plan adds, never text it hid", () => {
  // The bars are not covering anything: when the gate is shut the server never
  // calls a model, so there is nothing to uncover. The screen must not imply
  // otherwise, and the notice sits under the blur rather than over it.
  assert.match(appSource, /function LockedNotes/);
  assert.match(appSource, /className="locked-lines" aria-hidden="true"/);
  assert.match(appSource, /state\.unavailable === ANALYSIS_LOCKED_REASON/);
  for (const panel of ["function StatutePanel", "function AiSummaryPanel"]) {
    const body = appSource.slice(appSource.indexOf(panel));
    const block = body.slice(0, body.indexOf("\nfunction ", 1));
    assert.ok(block.indexOf("<LockedNotes") < block.indexOf("<PlanNotice />"), panel);
  }
  assert.match(appSource, /유료 이용 시 제공되는 내용입니다/);
  assert.match(appSource, /위 조문과 요건 표시, 그리고 판례·비슷한 사례는 무료입니다/);
});

test("does not sell a verdict", () => {
  // What is behind the plan is an explanation of the article, in the same terms
  // the rest of the product uses. The conclusion is not for sale either.
  const notice = appSource.slice(appSource.indexOf("function PlanNotice"), appSource.indexOf("function StatutePanel"));
  for (const banned of ["성립", "해당되는지", "유죄", "무죄", "처벌", "승소", "고소 가능"]) {
    assert.equal(notice.includes(banned), false, `banned plan copy: ${banned}`);
  }
  assert.match(notice, /회원님 사건의 결론을 알려드리는 것이 아니라/);
});

test("keeps similar posts on the free side of the gate", () => {
  // They come from our own cache, so they cost nothing per reader and stay
  // visible whether or not the analysis is unlocked.
  assert.match(appSource, /<AiSummaryPanel state=\{state\} \/>\s*\n\s*<WebCasesPanel state=\{webCasesState\} \/>/);
  // Matched loosely on purpose: what this guards is that the call carries the
  // case and the consent flag and nothing else stands between it and the
  // reader, not the exact spelling of its argument list.
  assert.match(appSource, /fetchWebCases\(\{[^}]*redactedText[^}]*allowExternalAi[^}]*\}\)/);
  // Dated, because a cached batch is not what the web looks like right now.
  assert.match(appSource, /일 기준입니다/);
});

test("does not describe a result the search never got", () => {
  // The heading announced "사실관계가 닮은 판례" over an error panel, above
  // chips the browser had read out of the description — so a page that reached
  // no server at all still showed 게임 채팅 and 반복 as if something matched.
  const view = appSource.slice(appSource.indexOf("function ResultsView"));
  const header = view.slice(0, view.indexOf("<ResultDeck"));
  assert.match(header, /\{!searchFailed && \(\s*\n\s*<div className="results-title-row">/);
  // The similarity disclaimer and the coverage bar describe a comparison too.
  assert.match(header, /\{!searchFailed && \(\s*\n\s*<>\s*\n\s*<div className="legal-notice"/);
  assert.doesNotMatch(header, /\{!searchFailed && <Coverage/);
});

test("says in the heading when nothing was found", () => {
  assert.match(appSource, /results\.length === 0 \? "닮은 판례를 찾지 못했습니다" : "사실관계가 닮은 판례"/);
  // The panel underneath explains rather than repeating the heading.
  const empty = appSource.slice(appSource.indexOf("function EmptyResults"), appSource.indexOf("function ErrorResults"));
  assert.doesNotMatch(empty, /<h2>/);
  assert.match(empty, /검색 가능한 \{availableCount\}건 전부와 비교했지만/);
  assert.match(empty, /없는 판례를 만들어 보여주지 않습니다/);
});

test("offers the next search where a reader finishes, not in the corner", () => {
  // It was a small button in the top right, furthest from anything being read.
  // It now ends the deck, so it lands after whichever screen is open — the
  // reader who only looks at the precedents meets it as surely as the one who
  // reads to the last panel.
  assert.match(appSource, /<div className="deck-footer">/);
  assert.match(appSource, /className="new-case-button" type="button" onClick=\{onNewCase\}/);
  assert.match(appSource, /다른 사례 검색하기/);
  // Says what it costs, because it throws the case away.
  assert.match(appSource, /지금 입력한 내용과 결과는 지워집니다/);
  // Gone from the header.
  const topBar = appSource.slice(appSource.indexOf("function TopBar"), appSource.indexOf("function HomeView"));
  assert.equal(topBar.includes("new-case-button"), false);
});

test("names the two ways back for what they each do", () => {
  // Both were passed as onHome while doing different things: one wipes the
  // case, the other scrolls back with the input intact so it can be rewritten.
  assert.equal(appSource.includes("onHome"), false);
  assert.match(appSource, /onRevise=\{goHome\}/);
  assert.match(appSource, /onNewCase=\{startNewCase\}/);
  assert.match(appSource, /<EmptyResults onRevise=\{onRevise\}/);
});

test("only the menu entries that lead somewhere take a click", () => {
  // The unbuilt screens keep their place so the shape of the product stays
  // visible, but a menu item that navigates to nothing is worse than one that
  // says it is not ready.
  assert.match(appSource, /const openers = \{ home: onNewCase, guide: onOpenGuide \};/);
  assert.match(appSource, /onClick=\{open\}/);
  assert.match(appSource, /aria-disabled=\{open \? undefined : true\}/);
  assert.match(appSource, /준비 중/);
  // Current page is marked, and it is not the same thing as being clickable.
  assert.match(appSource, /aria-current=\{current \? "page" : undefined\}/);
});

test("the guide plays the real screens rather than a drawing of them", () => {
  const guide = appSource.slice(appSource.indexOf("function GuideScene"));
  // The same components the product renders, so the tour cannot drift away
  // from the screens it is describing.
  assert.match(guide, /<CaseComposer/);
  assert.match(guide, /<PrecedentCard result=\{top\} rank=\{1\} \/>/);
  assert.match(guide, /<EmptyResults onRevise=\{guideNoop\} availableCount=\{GUIDE_AVAILABLE_COUNT\} \/>/);
  // Every handler is a no-op: the tour must not be able to start a search.
  assert.doesNotMatch(guide, /fetch\(/);
  assert.doesNotMatch(guide, /createIntake|completeIntake|analyseCase/);
});

test("the guide stage refuses the keyboard", () => {
  // A reader typing their own case into a picture of the composer would be
  // writing into nothing, so the picture stays out of reach and out of the
  // tab order. The real composer is one click away.
  assert.match(appSource, /<div className="guide-stage-content" ref=\{contentRef\} inert=\{true\}>/);
});

test("the guide says it is an example wherever it is screenshotted", () => {
  // A card on that stage quotes a real case number. Nothing there may pass for
  // a search someone actually ran.
  assert.match(appSource, /예시 화면 · 실제 검색 결과가 아닙니다/);
  // The label sits in the header, outside the viewport the veil dims, so it
  // stays legible on every step and in any screenshot of one.
  assert.ok(appSource.indexOf("guide-frame-label") < appSource.indexOf('className="guide-viewport"'));
});

test("the spotlight explains rather than merely dims", () => {
  // Four panels around the hole, because mask-composite is still spelled two
  // different ways across browsers.
  assert.equal((appSource.match(/className="guide-veil"/g) || []).length, 4);
  assert.match(appSource, /className="guide-lit"/);
  // The veil is decoration; the explanation must never sit behind the blur.
  assert.match(appSource, /<div className="guide-spotlight" aria-hidden="true">/);
  // The words sit in their own row under the stage rather than floating over
  // it: at half scale a bubble on the mock is larger than what it explains.
  assert.ok(appSource.indexOf("<GuideSpotlight lit={framing.lit}") < appSource.indexOf('className="guide-caption"'));
  assert.equal(appSource.includes("GuideCallout"), false);
  // A step that lights nothing, and a selector that stops matching, both fall
  // back to the whole screen rather than covering it with no hole in it.
  assert.match(appSource, /if \(!selectors\) return whole;/);
  assert.match(appSource, /if \(!found\) return whole;/);
  assert.match(appSource, /if \(!lit\) return null;/);
  // The hole never spills outside the frame, or a veil panel gets a negative size.
  assert.match(appSource, /const clamp = \(value, limit\) => Math\.max\(0, Math\.min\(limit, value\)\);/);
});

test("the spotlight follows the screen as it grows", () => {
  // The composer gets taller when the three follow-up questions arrive; a
  // rectangle measured once would be lighting the wrong thing by then.
  assert.match(appSource, /new ResizeObserver\(measure\)/);
  assert.match(appSource, /observer\.observe\(viewport\)/);
  assert.match(appSource, /window\.addEventListener\("resize", measure\)/);
  assert.match(appSource, /observer\.disconnect\(\)/);
});

test("the whole tour fits one screen instead of being scrolled through", () => {
  // The mock is laid out at desktop width and moved into whatever room is left,
  // so a reader sees the real screen rather than its narrow rearrangement.
  assert.match(appSource, /const GUIDE_STAGE_WIDTH = \d+;/);
  assert.match(appSource, /function guideFraming/);
  assert.match(appSource, /const fit = Math\.min\(1, width \/ contentWidth, height \/ contentHeight\)/);
  // The veil and the outline stay outside the transform, or they thin out with it.
  assert.ok(appSource.indexOf('className="guide-stage-content"') < appSource.indexOf("<GuideSpotlight"));
});

test("the tour pushes in on what it is explaining", () => {
  // A score ring is forty pixels tall inside a thousand-pixel screen. Ringing
  // it without magnifying it points at something still too small to read.
  assert.match(appSource, /const GUIDE_MAX_SCALE = [\d.]+;/);
  assert.match(appSource, /const GUIDE_CONTEXT_WIDTH = \d+;/);
  assert.match(appSource, /const GUIDE_CONTEXT_HEIGHT = \d+;/);
  // Never further out than the whole screen, never closer in than is readable.
  assert.match(appSource, /Math\.max\(fit, Math\.min\(GUIDE_MAX_SCALE,/);
  assert.match(appSource, /transform: `translate3d\(\$\{framing\.x\}px, \$\{framing\.y\}px, 0\) scale\(\$\{framing\.scale\}\)`/);

  // offsetLeft/offsetTop are layout values a transform does not touch, so the
  // arithmetic stays true while the stage is still gliding into place —
  // getBoundingClientRect would be reading a moving target mid-animation.
  assert.match(appSource, /function guideLayoutOffset/);
  assert.match(appSource, /element\.offsetLeft/);
  assert.match(appSource, /element\.offsetTop/);
  assert.doesNotMatch(appSource.slice(appSource.indexOf("function guideFraming")), /getBoundingClientRect/);

  // One calculation places the stage and cuts the hole, so the outline cannot
  // lag a frame behind the screen it is drawn around.
  assert.match(appSource, /top: y \+ scale \* box\.y - GUIDE_LIT_PADDING/);
  assert.match(appSource, /left: x \+ scale \* box\.x - GUIDE_LIT_PADDING/);
});

test("the tour plays on arrival and nothing but the reader stops it", () => {
  // Passing the pointer over the screen used to pause it, which made an
  // ordinary scroll look like the tour had broken.
  assert.match(appSource, /const \[playing, setPlaying\] = useState\(!reduced\);/);
  assert.equal(appSource.includes("onMouseEnter"), false);
});

test("the tour walks all three result screens, not just the precedents", () => {
  // The deck screen is chosen from outside for the tour; the real result page
  // keeps its own, so nothing about it changes.
  assert.match(appSource, /const index = controlledIndex \?\? ownIndex;/);
  assert.match(appSource, /const setIndex = onIndexChange \?\? setOwnIndex;/);
  assert.match(appSource, /index=\{step\.deck\}/);
  // The statute is quoted, the four verdicts come from the rules, and the
  // generated half is handed over as it was written.
  assert.match(appSource, /statute: GUIDE_STATUTE/);
  assert.match(appSource, /elements: GUIDE_ELEMENTS/);
  assert.match(appSource, /analysis: GUIDE_ANALYSIS/);
  // A fixed date would be quietly wrong a week later; the panel drops the line.
  assert.match(appSource, /webCases: GUIDE_WEB_CASES, fetchedAt: null/);
});

test("the guide is read at the reader's own pace when motion is unwelcome", () => {
  assert.match(appSource, /function usePrefersReducedMotion/);
  // Typed lines arrive finished instead of one character at a time.
  assert.match(appSource, /if \(reduced\) \{ setCount\(total\); return undefined; \}/);
  // And the tour does not move on by itself.
  assert.match(appSource, /useState\(!reduced\)/);
  assert.match(appSource, /if \(reduced\) setPlaying\(false\)/);
  // Every timer is cleared, or leaving the guide leaks one per step.
  assert.match(appSource, /return \(\) => clearInterval\(timer\)/);
  assert.match(appSource, /return \(\) => clearTimeout\(timer\)/);
});

test("leaving the guide does not throw the case away", () => {
  // The case screens stay mounted behind it, so a half-written case and its
  // capture are still there on the way back. Starting a new one is a separate,
  // clearly named button.
  assert.match(appSource, /guideReturnRef\.current = view;/);
  assert.match(appSource, /setView\(guideReturnRef\.current \|\| "home"\);/);
  assert.match(appSource, /\{view === "guide" && <GuideView onClose=\{closeGuide\} \/>\}/);
  assert.match(appSource, /view === "guide" \? " is-guide" : ""/);
});

test("every part the tour lights up still exists on the screen", () => {
  // The spotlight fails quietly: a selector that stops matching drops the veil,
  // and the step then explains something the reader sees nothing highlighted on.
  // So every class a step points at has to be one the screen still renders.
  const rendered = new Set(
    [...appSource.matchAll(/className=(?:"([^"]*)"|{`([^`]*)`})/g)]
      .flatMap((match) => (match[1] || match[2] || "").split(/[^a-zA-Z0-9_-]+/))
      .filter(Boolean),
  );

  for (const step of GUIDE_STEPS) {
    // null lights nothing and shows the screen whole, which is how the tour opens.
    if (step.target === null) continue;
    const selectors = Array.isArray(step.target) ? step.target : [step.target];
    for (const selector of selectors) {
      // Split on whitespace for descendants, then on the dot for compounds, so
      // ".deck-arrow.is-next" is checked as both of the classes it needs. Bare
      // element names like "textarea" are not classes and are skipped.
      for (const part of selector.split(/\s+/).filter((token) => token.startsWith("."))) {
        for (const name of part.split(".").filter(Boolean)) {
          assert.ok(rendered.has(name), `step "${step.id}" lights up .${name}, which nothing renders any more`);
        }
      }
    }
  }
});

test("names the term the search used instead of printing 의미 0", () => {
  // The consent box starts unticked, so the keyword search is what most readers
  // get — and the card labelled its one missing term 의미 0 directly under a
  // coverage panel saying 키워드·사실 태그 검색.
  const breakdown = appSource.slice(
    appSource.indexOf('className="score-breakdown"'),
    appSource.indexOf('className="comparison-grid"'),
  );
  assert.match(breakdown, /similarity\.semantic === null/);
  assert.match(breakdown, /키워드 <strong>/);
  assert.match(breakdown, /의미 <strong>/);
  // Shown when it applies, because the three terms cannot otherwise reach the
  // total for a judgment that decided more than this offence.
  assert.match(breakdown, /similarity\.penalty > 0/);
});
