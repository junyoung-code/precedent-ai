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

test("explains a card that carries no summary instead of leaving a gap", () => {
  assert.match(appSource, /SUMMARY_ABSENCE_REASON/);
  assert.match(appSource, /다른 죄명이 함께 판단된 판례여서 요약을 제공하지 않습니다/);
  assert.match(appSource, /!result\.summary\?\.length/);
  // The explanation must not read as a legal conclusion.
  for (const banned of ["무죄", "유죄", "혐의없음"]) {
    assert.equal(appSource.includes(`${banned}여서 요약`), false);
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

test("requires explicit external embedding consent and uses the private intake client", () => {
  assert.match(appSource, /OpenAI 임베딩 API로 전송/);
  assert.match(appSource, /allowExternalEmbedding/);
  assert.match(appSource, /createIntake/);
  assert.match(appSource, /completeIntake/);
  assert.match(appSource, /캡처 이미지는 서버 또는 외부 AI에 전송하지 않습니다/);
  assert.match(appSource, /중단된 입력은 최대 1시간 뒤 삭제됩니다/);
  assert.doesNotMatch(appSource, /rankPrecedents/);
  assert.match(appSource, /result\.summary\?\.length/);
  assert.match(appSource, /검색 서버에 연결하지 못했습니다/);
});
