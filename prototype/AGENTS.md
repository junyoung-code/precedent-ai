# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

The approved visual direction is a calm Korean AI workspace: white rounded application shell on a pale gray background, slim left navigation, generous whitespace, black typography, and a restrained violet accent. The product must say `사실관계 유사도`, never legal-outcome or complaint-success probability. Show a human-readable AI-use notice before submission and label every AI-authored precedent summary with `AI 생성 요약` plus an official-source reminder. Never display a precedent unless its case number, court, date, source anchors, and official law.go.kr URL are present in the verified local dataset.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
