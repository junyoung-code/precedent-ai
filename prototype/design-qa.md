# Design QA

## Evidence

- Source visual truth:
  - `/var/folders/7h/pzbct4xn2zz74jxfyclfsn2w0000gn/T/codex-clipboard-f074a04c-469c-4049-b420-dcd733c32862.png` (940 × 650 px, spacious layout reference)
  - `/var/folders/7h/pzbct4xn2zz74jxfyclfsn2w0000gn/T/codex-clipboard-8b2dd9d9-83cb-4814-b41b-94facd577d5a.png` (3396 × 1908 px, pre-change implementation capture)
- Implementation screenshots:
  - `/Users/junyoung/Desktop/판례AI/prototype/design-qa-desktop.png` (1280 × 720 px browser-rendered desktop capture)
  - `/Users/junyoung/Desktop/판례AI/prototype/design-qa-mobile.png` (390 × 922 px full-page mobile capture from a 390 × 844 CSS viewport)
  - `/Users/junyoung/Desktop/판례AI/prototype/design-qa-results.png` (1280 × 720 px results state)
- CSS viewport measurements:
  - Tall desktop verification: 1440 × 1080 CSS px, browser-default density.
  - Short desktop verification: 1280 × 720 CSS px, browser-default density.
- Density normalization: the browser capture layer stores desktop evidence at 1280 × 720 px. The tall CSS viewport was therefore verified additionally with DOM geometry and computed typography values; the differently sized source screenshots were compared for hierarchy, density, and requested deltas rather than pixel-level cloning.
- State: empty landing form on desktop/mobile and populated victim/game-chat results state.

## Full-view comparison evidence

The spacious source reference, the user's pre-change capture, and the final browser-rendered landing were opened together in one comparison input. On a tall desktop the landing is now vertically centered with visibly larger gaps between the emblem, eyebrow, title, supporting copy, disclosure, and form. The display title grows to 44 px and the supporting copy to 15 px, while role labels, helper copy, textarea text, attachment control, and submit button also receive a proportional type increase.

The increased spacing does not reintroduce scrolling. At 1440 × 1080 CSS px the document scroll height equals the viewport height, the shell ends at 1056 px, and the composer ends at 968.4 px. At 1280 × 720 CSS px the compact rules remain active: the document scroll height equals 720 px and the composer ends at 696.44 px inside the shell.

## Focused-region comparison evidence

The title/hero region and complete composer are readable at original capture resolution, so no separate crop was necessary. Focused checks used computed styles and element geometry: tall desktop title `44px`, supporting copy `15px`, hero bounds `193.6–444.9px`, and composer bounds `551.4–968.4px`. This confirms the requested increase in both typography and section spacing without relying only on visual impression.

## Required fidelity surfaces

- Fonts and typography: the existing Pretendard/Korean system stack is preserved. Tall desktop display text increases to 44 px with 1.1 line height; supporting and form text increase proportionally. Short desktop and mobile retain their established responsive sizes to prevent clipping.
- Spacing and layout rhythm: the tall-screen layout uses a centered vertical stack, a larger medallion margin, a 28 px disclosure gap, roomier role controls, 20 px form dividers, and a 112 px textarea. Compact desktop remains fixed and non-scrolling; mobile remains naturally scrollable.
- Colors and visual tokens: the approved walnut, caramel, ivory, neutral gray, and official-source green tokens remain unchanged.
- Image quality and asset fidelity: the approved real gavel-plus-sound-block asset is unchanged, remains centered, and gains a modest 72 px medallion on tall screens without stretching or cropping.
- Copy and content: no copy was added or removed. The legal-neutral statement, AI-use disclosure, verified-source count, `사실관계 유사도`, AI summary labeling, and official-source link remain intact.
- Accessibility and interaction: role buttons, labeled textarea, attachment input, and submit control remain semantic and keyboard reachable. Responsive type increases do not hide or overlap controls.

## Findings

- No actionable P0, P1, or P2 findings remain.

## Open Questions

- None.

## Primary interactions tested

1. Selected `피해자` and entered a realistic game-chat case.
2. Submitted the enabled comparison button.
3. Confirmed one verified result card, one official `law.go.kr` link, and an `AI 생성 요약` badge.
4. Confirmed the results title `사실관계가 닮은 판례`.
5. No runtime failure occurred during the complete submit/results flow.

## Comparison history

- Earlier state `[P2]`: on a tall display the compact spacing and 38.4 px title made the hero and form feel visually compressed relative to the user's spacious reference.
- Fix: added a tall-desktop-only media query at `min-width: 901px` and `min-height: 1020px`, increasing display/body/form typography, vertical gaps, control heights, and textarea height while vertically centering the complete landing stack.
- Post-fix evidence: the tall desktop title is 44 px, the hero and composer have a 106.5 px separation that includes the disclosure region, and the composer retains 87.6 px of clearance from the shell bottom. The short desktop stays at 38.4 px with no document scroll.
- Responsive evidence: the tall-screen rule is excluded below 901 px width, so the existing mobile layout and bottom navigation remain unchanged.

## Implementation checklist

- [x] Increase tall-desktop headline and supporting typography.
- [x] Increase spacing between hero, disclosure, and form.
- [x] Increase form typography, controls, and textarea only when vertical room exists.
- [x] Preserve fixed, no-scroll compact desktop behavior.
- [x] Preserve mobile scrolling and responsive stacking.
- [x] Verify the complete precedent-search results flow and official-source labeling.

final result: passed
