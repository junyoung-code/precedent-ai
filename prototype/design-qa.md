# Design QA

## Evidence

- Source visual truth:
  - `/var/folders/7h/pzbct4xn2zz74jxfyclfsn2w0000gn/T/codex-clipboard-389da4fe-99dd-4bfd-ad08-6080d31ee6d8.png` (2302 × 576 px, example-card reference)
  - `/var/folders/7h/pzbct4xn2zz74jxfyclfsn2w0000gn/T/codex-clipboard-208234ff-217f-4931-92d7-88423b136444.png` (2024 × 966 px, hero/composition reference)
  - `/var/folders/7h/pzbct4xn2zz74jxfyclfsn2w0000gn/T/codex-clipboard-8b1e6f51-b930-4108-a2c3-8bdfdd394a3c.png` (1074 × 730 px, gavel subject reference)
- Implementation screenshots:
  - `/Users/junyoung/Desktop/판례AI/prototype/design-qa-desktop.png` (1280 × 720 px browser-rendered desktop viewport)
  - `/Users/junyoung/Desktop/판례AI/prototype/design-qa-mobile.png` (390 × 844 px browser-rendered mobile viewport)
  - `/Users/junyoung/Desktop/판례AI/prototype/design-qa-results.png` (1280 × 720 px browser-rendered results state)
- CSS viewport and density: desktop browser capture was clamped by the in-app browser to 1280 × 720 CSS px; mobile capture was 390 × 844 CSS px. Device pixel ratio was the browser default. No density scaling was used for implementation captures.
- State: empty home form on desktop/mobile, plus a populated victim/game-chat comparison result.

## Full-view comparison evidence

The three source images and the desktop/mobile implementation captures were opened together in one comparison input. The implementation intentionally preserves the source workspace anatomy while applying the requested changes: the formerly purple hero orb is now a warm brown medallion containing a real generated wooden-gavel asset, the violet accents are mapped to walnut/caramel tokens, and the four example cards are represented as compact quick-select controls inside the composer so they remain visible in the first viewport.

## Focused-region comparison evidence

No separate crop was required. At original resolution, the hero medallion, headline, AI notice, role controls, and four quick examples are all readable in the desktop capture, while the mobile capture exposes the same regions at 390 px without overlap or clipping. The generated gavel has a clean transparent edge, correct diagonal orientation, and no visible chroma halo.

## Required fidelity surfaces

- Fonts and typography: the existing Korean system/Pretendard stack and black display hierarchy are preserved; the brown gradient emphasizes only the second headline line. Desktop and mobile wrapping is deliberate and readable.
- Spacing and layout rhythm: top-bar and hero height were reduced, moving the AI notice, role selection, and all four quick examples above the fold. The composer retains clear group spacing and 2-column mobile quick-example layout.
- Colors and visual tokens: the cool violet/gray treatment was replaced consistently with walnut, caramel, warm ivory, and warm gray. Green remains only for official-source verification and local-processing status.
- Image quality and asset fidelity: the orb uses `/public/assets/gavel.png`, a real RGBA raster asset generated from the supplied gavel direction. The crop is centered and sharp at both tested sizes.
- Copy and content: legal-neutral language, AI-use disclosure, verified-source count, `사실관계 유사도`, AI-summary labeling, and official-source reminder remain intact.
- Accessibility and interaction: semantic buttons/fieldset/textbox remain keyboard reachable; quick examples have visible focus treatment; mobile tap controls do not overlap the fixed navigation.

## Findings

- No actionable P0, P1, or P2 findings.

## Open Questions

- None. The change from large cards to compact buttons is an intentional response to the user's above-the-fold readability request rather than fidelity drift.

## Primary interactions tested

1. Selected `피해자`.
2. Selected the `게임 채팅` quick example and confirmed that it populated the textarea.
3. Confirmed that the comparison button became enabled.
4. Submitted the case and confirmed a verified result card, `AI 생성 요약`, and `공식 원문 보기` link.
5. Checked browser console warnings and errors in both home and results states: none.

## Comparison history

- Pass 1: no P0/P1/P2 mismatch remained after implementation. The first-viewport visibility, brown palette, real gavel asset, desktop results state, and mobile responsive state all matched the requested direction, so no visual fix iteration was required.

## Implementation checklist

- [x] Replace purple orb with brown gavel medallion.
- [x] Apply brown/ivory palette across home and results.
- [x] Move examples inside the composer and keep all four visible above the fold.
- [x] Verify desktop, mobile, results, interactions, official-source link, and console state.

final result: passed
