import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(appSource, /OpenAI API로 전송해 의미 검색과 법조문 분석에 사용합니다/);
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
