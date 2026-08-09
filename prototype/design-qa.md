# Design QA

## Evidence

- Source visual truth:
  - `/var/folders/7h/pzbct4xn2zz74jxfyclfsn2w0000gn/T/codex-clipboard-6ea3e83f-e5d1-4aa7-92b8-698887df59fb.png` (932 × 230 px, roomy AI-composer reference).
  - `/var/folders/7h/pzbct4xn2zz74jxfyclfsn2w0000gn/T/codex-clipboard-7948e6ed-8e0e-4371-acf4-70839bc54518.png` (1770 × 178 px, cramped textarea and awkward internal-scroll reference).
- Implementation screenshots:
  - `/Users/junyoung/Desktop/판례AI/prototype/design-qa-desktop.png` (1280 × 720 px, empty desktop landing at a 1280 × 720 CSS viewport).
  - `/Users/junyoung/Desktop/판례AI/prototype/design-qa-results.png` (1280 × 720 px, populated results after smooth in-document scrolling).
  - `/Users/junyoung/Desktop/판례AI/prototype/design-qa-mobile.png` (1280 × 720 px capture surface containing the 390 px responsive layout at the left; the in-app capture layer padded the remaining width).
- State: empty landing form on desktop and mobile, plus a populated victim/game-chat results state.
- Normalization: source and implementation captures differ in dimensions, so the comparison evaluates hierarchy, component anatomy, density, spacing, and requested interaction deltas rather than pixel-for-pixel cloning.

## Full-view comparison evidence

Both user references and all three final implementation captures were opened together at original resolution. The final desktop keeps the approved brown legal-AI shell while adopting the requested common AI-platform anatomy: one wide 1040 px composer, a 150 px writing area, controls in the bottom toolbar, and substantial whitespace separating the gavel, title, supporting copy, and composer. The former standalone role cards and large AI-disclosure card are absent.

The results capture verifies that submission does not replace the landing with a disconnected screen. The results section remains below the composer in the same document and arrives at the top of the viewport after smooth scrolling. The mobile evidence shows the toolbar wrapping into two rows without narrowing the writing area or introducing a nested textarea scrollbar.

## Focused-region comparison evidence

The 932 × 230 composer reference is itself a focused crop, so it was compared directly with the complete composer visible in the desktop implementation capture. Both use a large blank writing surface, a distinct footer row, left-aligned auxiliary controls, and a compact circular submit control on the right. Product-specific differences are deliberate: `피해자 | 피신고인` replaces the reference's writing-style control, and the legally relevant AI-use line sits immediately below the composer instead of consuming a large card above it.

## Required fidelity surfaces

- Fonts and typography: the existing Korean system/Pretendard stack is preserved. The desktop title retains clear two-line hierarchy; composer input is 15 px with 1.65 line height. The mobile title is 28 px so the final Korean character no longer becomes an orphaned third line.
- Spacing and layout rhythm: desktop uses a 1040 px composer, 150 px writing area, 52 px hero-to-composer gap, and 238 px minimum composer height. Mobile keeps the same writing height and converts the footer to two rows.
- Colors and visual tokens: approved walnut, caramel, ivory, gray, and official-source green tokens remain intact. Selected role state uses the restrained walnut accent.
- Image quality and asset fidelity: the approved centered gavel-and-sound-block medallion is unchanged and is rendered without stretching or cropping.
- Copy and content: the pre-use notice is reduced to `AI가 공개 판례를 검색·비교합니다.`; the privacy line remains beside it. Results retain `AI 생성 요약`, an official-source reminder, verified case metadata, and the neutral `사실관계 유사도` framing.
- Accessibility and interaction: the textarea has an accessible label; the role group exposes `aria-pressed`; attachment and submit controls remain keyboard reachable. `prefers-reduced-motion` replaces smooth movement with immediate movement.

## Primary interactions tested

1. Selected `피해자` and entered a realistic game-chat case.
2. Confirmed the submit control became enabled and submitted the form.
3. Measured document movement from `scrollY = 0` to `677.5`; the results heading landed at approximately 20 px from the viewport top.
4. Confirmed one verified result card, one official `law.go.kr` link, and one `AI 생성 요약` badge.
5. Confirmed the former AI-disclosure card count is zero and both role buttons remain present.
6. No runtime failure or failed interaction was observed during landing, submission, results, and return-flow checks.

## Findings and comparison history

- First mobile check `[P2]`: the 31 px title left the final `요` on a third line.
- Fix: reduced the narrow-screen title to 28 px with 1.12 line height, producing two balanced lines.
- First compact-notice check `[P2]`: 9 px notice text was too faint at the target capture size.
- Fix: increased compact notice text to 10 px while preserving its low-priority position below the composer.
- Post-fix comparison: desktop shows the full composer without document scrolling; mobile shows a two-row footer and two-line title; results appear in continuous document flow. No actionable P0, P1, or P2 findings remain.

## Implementation checklist

- [x] Replace the large AI-use card with a compact pre-use line.
- [x] Embed `피해자 | 피신고인` in the composer toolbar.
- [x] Expand the writing surface to 1040 × 150 px on desktop.
- [x] Preserve generous gaps among medallion, title, supporting copy, and composer.
- [x] Keep results in the same document flow and scroll to them smoothly.
- [x] Respect reduced-motion preferences.
- [x] Stack mobile controls without a nested textarea scrollbar.
- [x] Preserve verified-source and AI-generated-summary labeling in results.

final result: passed
