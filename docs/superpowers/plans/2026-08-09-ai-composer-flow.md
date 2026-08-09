# AI Composer Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the large disclosure and role cards with a spacious AI-style composer, embedded role toggle, compact compliant notice, and smooth in-document results transition.

**Architecture:** Keep the existing React single-page prototype and verified precedent ranking logic. Refactor only the presentation state so the home composer remains mounted while results render below it, then use a results ref plus reduced-motion detection for the one-time transition. CSS owns the tall/short/mobile layout variants; Node source-contract tests guard required legal copy and UI structure.

**Tech Stack:** React 19, Vite 6, CSS, Node `node:test`, in-app browser design QA.

## Global Constraints

- Preserve the verified local precedent dataset and `rankPrecedents` behavior.
- Never display a precedent without case number, court, decision date, source anchors, and official `law.go.kr` URL.
- Use `사실관계 유사도`; never show legal-outcome or complaint-success probability.
- Show `AI가 공개 판례를 검색·비교합니다.` before submission.
- Keep `AI 생성 요약` and the official-source reminder on every generated summary.
- Desktop composer maximum width is `1040px`; body input height is `150px`.
- Role and at least 15 characters are required before submission.
- Results render in the same document flow and receive one smooth scroll after completion.
- Respect `prefers-reduced-motion: reduce`.
- Preserve mobile scrolling and verified result interactions.
- Do not modify `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, or `tests/sites-worker.test.mjs`.

---

## File Structure

- Modify `prototype/src/App.jsx`: composer anatomy, inline AI notice, result-flow state, smooth scroll, reset behavior.
- Modify `prototype/src/styles.css`: spacious composer, segmented role control, responsive footer, result reveal and reduced-motion rules.
- Modify `prototype/tests/ui-copy.test.mjs`: legal-copy and structural source contracts.
- Create `prototype/tests/ui-layout.test.mjs`: CSS contracts for composer size, role toggle, responsive layout, and reduced motion.
- Modify `prototype/package.json`: include the new layout test in `npm test`.
- Modify `prototype/AGENTS.md`: record the approved embedded-composer and smooth-results direction.
- Modify `prototype/design-qa.md`: record reference/implementation evidence and final QA result.
- Update `prototype/design-qa-desktop.png`, `prototype/design-qa-mobile.png`, and `prototype/design-qa-results.png`: final browser captures.

---

### Task 1: Lock the new composer contract with failing tests

**Files:**
- Modify: `prototype/tests/ui-copy.test.mjs`
- Create: `prototype/tests/ui-layout.test.mjs`
- Modify: `prototype/package.json`

**Interfaces:**
- Consumes: `prototype/src/App.jsx` and `prototype/src/styles.css` as UTF-8 source strings.
- Produces: source contracts executed by `npm test`.

- [ ] **Step 1: Update the AI disclosure and interaction source test**

Replace the first test and add an interaction contract:

```js
test("shows compact pre-use and generated-result AI disclosures", () => {
  assert.match(appSource, /AI가 공개 판례를 검색·비교합니다/);
  assert.equal(
    appSource.includes("이 서비스는 AI를 사용하여 공개 판례를 검색·비교하며 일부 설명을 생성합니다"),
    false,
  );
  assert.match(appSource, /AI 생성 요약/);
  assert.match(appSource, /정확한 내용은 공식 원문을 확인하십시오/);
});

test("keeps role selection inside the composer and scrolls to results", () => {
  assert.match(appSource, /role-segment/);
  assert.match(appSource, /피해자/);
  assert.match(appSource, /피신고인/);
  assert.match(appSource, /scrollIntoView/);
  assert.match(appSource, /prefers-reduced-motion: reduce/);
});
```

- [ ] **Step 2: Add CSS layout contracts**

Create `tests/ui-layout.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("uses the approved spacious composer dimensions", () => {
  assert.match(css, /\.composer\s*\{[\s\S]*?1040px/);
  assert.match(css, /\.composer textarea\s*\{[\s\S]*?height:\s*150px/);
});

test("styles the embedded role segment and mobile toolbar", () => {
  assert.match(css, /\.role-segment/);
  assert.match(css, /\.role-segment-button\.is-selected/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.composer-toolbar/);
});

test("keeps reduced-motion behavior explicit", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /scroll-behavior:\s*auto/);
});
```

- [ ] **Step 3: Add the new test to `npm test`**

Change the script to:

```json
"test": "node --test tests/analysis.test.mjs tests/ui-copy.test.mjs tests/ui-layout.test.mjs"
```

- [ ] **Step 4: Run the contract tests and verify failure**

Run: `npm test`

Expected: failures for missing compact copy, `.role-segment`, `scrollIntoView`, `1040px`, and `150px` composer styles.

- [ ] **Step 5: Commit the failing contracts**

```bash
git add prototype/tests/ui-copy.test.mjs prototype/tests/ui-layout.test.mjs prototype/package.json
git commit -m "test: define AI composer flow contract"
```

---

### Task 2: Refactor the React experience into a continuous composer flow

**Files:**
- Modify: `prototype/src/App.jsx`

**Interfaces:**
- Consumes: `rankPrecedents({ role: string, description: string })` and existing verified result components.
- Produces: `RoleSelector({ value, onChange })`, `CaseComposer(...)`, `HomeView(...)`, and `ResultsView(...)` rendered in one document flow; `resultsStartRef: React.RefObject<HTMLElement>`.

- [ ] **Step 1: Replace role cards with an accessible segmented control**

Implement `RoleSelector` as:

```jsx
function RoleSelector({ value, onChange }) {
  return (
    <div className="role-segment" role="group" aria-label="사례를 살펴볼 입장">
      {[
        ["victim", "피해자"],
        ["reported", "피신고인"],
      ].map(([nextValue, label]) => (
        <button
          type="button"
          key={nextValue}
          className={`role-segment-button ${value === nextValue ? "is-selected" : ""}`}
          aria-pressed={value === nextValue}
          onClick={() => onChange(nextValue)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Rebuild the composer toolbar**

Keep the existing file validation and `ready` condition, remove the top fieldset and visible textarea label, use the approved placeholder, and render this toolbar order:

```jsx
<div className="composer-toolbar">
  <div className="composer-tools-primary">
    <label className="attach-button" htmlFor="case-image">대화 캡처 첨부</label>
    <RoleSelector value={role} onChange={onRoleChange} />
  </div>
  <div className="submit-area">
    <span className="character-count">{description.length}/2,000</span>
    <button className="analyze-button" type="submit" disabled={!ready} aria-label="비슷한 판례 찾기">
      <span aria-hidden="true">↑</span>
    </button>
  </div>
</div>
```

Render two separate helper lines below the card:

```jsx
<div className="composer-notices">
  <p><span aria-hidden="true">✦</span> AI가 공개 판례를 검색·비교합니다.</p>
  <p><span aria-hidden="true">◉</span> 입력과 첨부 파일을 서버로 보내거나 저장하지 않습니다.</p>
</div>
```

- [ ] **Step 3: Keep home and results in the same main flow**

Import `useEffect`, add `homeStartRef` and `resultsStartRef`, keep `HomeView` mounted, and render results after it only when `view === "results"`:

```jsx
<HomeView ... compact={view === "results"} />
{view === "results" && (
  <ResultsView
    ref={resultsStartRef}
    description={description}
    results={results}
    onHome={goHome}
  />
)}
```

Wrap the results section with `forwardRef`, or pass `resultsStartRef` as a regular prop and attach it to `<section ref={resultsStartRef}>`.

- [ ] **Step 4: Add the one-time reduced-motion-aware scroll**

After `view` changes to `results`, run:

```jsx
useEffect(() => {
  if (view !== "results" || !resultsStartRef.current) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  resultsStartRef.current.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });
}, [view]);
```

Remove the existing `window.scrollTo`. `goHome()` should clear only results and smoothly scroll back to `homeStartRef`; `startNewCase()` additionally clears role and description.

- [ ] **Step 5: Run tests and verify the React contracts pass or isolate CSS-only failures**

Run: `npm test`

Expected: AI copy, role segment, scroll transition, no-fabrication, and neutral legal-label tests pass; only CSS layout tests may still fail.

- [ ] **Step 6: Commit the React flow**

```bash
git add prototype/src/App.jsx prototype/tests/ui-copy.test.mjs
git commit -m "feat: embed role selection in composer flow"
```

---

### Task 3: Implement the spacious responsive composer and result reveal

**Files:**
- Modify: `prototype/src/styles.css`
- Modify: `prototype/AGENTS.md`

**Interfaces:**
- Consumes: `.home-view`, `.composer`, `.composer-toolbar`, `.composer-tools-primary`, `.role-segment`, `.role-segment-button`, `.composer-notices`, `.results-view`.
- Produces: fixed landing composition on desktop, two-row toolbar on mobile, smooth document result reveal.

- [ ] **Step 1: Replace the old form-card rules**

Set the composer contract:

```css
.home-view { width: min(1160px, calc(100% - 64px)); }
.hero-copy { margin-top: 18px; }
.composer {
  width: min(100%, 1040px);
  min-height: 238px;
  margin: 52px auto 0;
  padding: 0;
  overflow: hidden;
  border-radius: 22px;
}
.composer textarea {
  height: 150px;
  min-height: 150px;
  padding: 24px 26px;
  background: transparent;
  font-size: 15px;
}
```

Delete obsolete `.role-fieldset`, `.role-options`, `.role-option`, `.composer-divider`, `.textarea-label`, `.privacy-line`, and landing `.ai-disclosure` spacing rules when no longer consumed.

- [ ] **Step 2: Style the embedded toolbar and role segment**

```css
.composer-toolbar {
  min-height: 72px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-top: 1px solid var(--line);
}
.composer-tools-primary { display: flex; align-items: center; gap: 10px; }
.role-segment { display: inline-flex; padding: 3px; border-radius: 11px; background: #f3eeea; }
.role-segment-button { min-width: 72px; height: 34px; border: 0; border-radius: 8px; background: transparent; }
.role-segment-button.is-selected { color: white; background: var(--violet); }
.composer-notices { width: min(100%, 1040px); margin: 12px auto 0; display: flex; justify-content: center; gap: 24px; }
```

- [ ] **Step 3: Add result-flow and responsive rules**

Make `.app-shell.has-results` auto-height and scrollable, hide or compact the hero only after results appear, and animate results:

```css
.app-shell.has-results { height: auto; min-height: calc(100vh - 48px); }
.app-shell.has-results .main-content { height: auto; overflow: visible; }
.app-shell.has-results .home-view { padding-bottom: 44px; }
.results-view { scroll-margin-top: 32px; animation: results-enter .2s ease-out both; }
@keyframes results-enter { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
```

At `max-width: 620px`, stack `.composer-toolbar`, keep `.composer-tools-primary` full width, and keep `.submit-area` full width. In reduced-motion mode, disable the result animation and force `scroll-behavior: auto`.

- [ ] **Step 4: Record the durable design decision**

Update `prototype/AGENTS.md` to state that the approved landing uses one spacious 1040px composer with the role segment in its toolbar, a compact pre-use AI line instead of a disclosure card, and continuous reduced-motion-aware results scrolling.

- [ ] **Step 5: Run all source and layout tests**

Run: `npm test`

Expected: all analysis, copy, and layout tests pass with zero failures.

- [ ] **Step 6: Commit the responsive styling**

```bash
git add prototype/src/styles.css prototype/AGENTS.md prototype/tests/ui-layout.test.mjs prototype/package.json
git commit -m "feat: add spacious responsive AI composer"
```

---

### Task 4: Browser verification and Product Design QA

**Files:**
- Modify: `prototype/design-qa.md`
- Modify: `prototype/design-qa-desktop.png`
- Modify: `prototype/design-qa-mobile.png`
- Modify: `prototype/design-qa-results.png`

**Interfaces:**
- Consumes: local Vite preview and the two user reference screenshots.
- Produces: browser evidence and `final result: passed` or an explicit blocker.

- [ ] **Step 1: Start or reuse the local Vite server**

Run: `npm run dev -- --host 0.0.0.0`

Expected: a reachable local preview URL with no startup error.

- [ ] **Step 2: Verify desktop empty-state composition**

In the in-app browser at 1280 × 720 and a tall desktop viewport, confirm:

- no large AI disclosure card;
- no separate role cards;
- textarea height 150px and composer width capped at 1040px;
- role buttons, attachment button, character count, and submit arrow are visible;
- no clipped persistent controls.

Save the desktop capture to `prototype/design-qa-desktop.png`.

- [ ] **Step 3: Verify submit and smooth result transition**

Select `피해자`, enter `온라인 게임에서 처음 만난 사람과 다툰 뒤 카카오톡으로 성적인 욕설을 한 차례 받았습니다.`, submit, and confirm:

- the result section appears below the composer;
- the viewport moves to the result heading rather than jumping to document top;
- at least one verified card, `AI 생성 요약`, and official `law.go.kr` link appear;
- no runtime error appears during the flow.

Save the result capture to `prototype/design-qa-results.png`.

- [ ] **Step 4: Verify mobile responsive behavior**

At 390 × 844, confirm the toolbar becomes two rows, the role segment remains usable, the document scrolls naturally, and the bottom navigation does not cover the submit control. Save `prototype/design-qa-mobile.png`.

- [ ] **Step 5: Compare reference and implementation together**

Open both user reference screenshots and all final browser captures in one comparison input. Evaluate typography, spacing, colors, source asset quality, copy, interaction affordance, and responsiveness. Fix and recapture every P0/P1/P2 difference.

- [ ] **Step 6: Write the QA report**

Update `prototype/design-qa.md` with exact source paths, capture paths, viewport sizes, state, primary interactions, error check, five fidelity surfaces, comparison history, and the exact final line:

```md
final result: passed
```

Use `blocked` instead if any P0/P1/P2 issue remains.

- [ ] **Step 7: Run final verification**

Run:

```bash
npm test
npm run build
npm run test:sites
git diff --check
```

Expected: all tests pass, Vite production build exits `0`, Sites packaging tests pass, and diff check emits no output.

- [ ] **Step 8: Commit the verified implementation evidence**

```bash
git add prototype/design-qa.md prototype/design-qa-desktop.png prototype/design-qa-mobile.png prototype/design-qa-results.png
git commit -m "test: verify continuous composer experience"
```
