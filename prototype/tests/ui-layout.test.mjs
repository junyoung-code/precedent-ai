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

test("gives the labelled intake button room instead of the icon button's box", () => {
  // It reuses .analyze-button for colour, which is a 42px square built for a
  // single glyph. Its own rule has to come later and undo that box, or the label
  // wraps one character per line.
  const iconButton = css.indexOf(".analyze-button {");
  const intakeButton = css.indexOf(".intake-complete {");
  assert.equal(iconButton > -1 && intakeButton > iconButton, true, ".intake-complete must be declared after .analyze-button");
  const rule = css.slice(intakeButton, css.indexOf("}", intakeButton));
  assert.match(rule, /width:\s*auto/);
  assert.match(rule, /min-width:\s*0/);
  assert.match(rule, /white-space:\s*nowrap/);
});

test("keeps reduced-motion behavior explicit", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /scroll-behavior:\s*auto/);
  // The screen-to-screen slide is motion a reader may have asked not to see.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.deck-screen\.is-active\.slide-forward[^}]*animation: none/);
});

test("keeps every result panel in the printed copy", () => {
  // Saving the result must not save only whichever tab happened to be open.
  assert.match(css, /@media print[\s\S]*?\.deck-screen\[hidden\] \{ display: block !important; \}/);
  assert.match(css, /@media print[\s\S]*?\.deck-arrow, \.deck-progress/);
});

test("separates quoted law, applied rule, and generated text by size and weight", () => {
  // Three kinds of statement share one card. Rendered alike they read as one
  // voice, which is a trust problem before it is a readability one.
  const size = (selector) => {
    const rule = css.slice(css.indexOf(`${selector} {`));
    return Number(/font-size:\s*([\d.]+)px/.exec(rule.slice(0, rule.indexOf("}")))?.[1]);
  };
  const statute = size(".statute-body");
  const quote = size(".element-quote");
  const evidence = size(".element-evidence");
  const note = size(".element-note");

  assert.ok(statute > quote, `statute ${statute} must lead quote ${quote}`);
  assert.ok(quote > evidence, `quote ${quote} must lead evidence ${evidence}`);
  assert.ok(evidence > note, `evidence ${evidence} must lead note ${note}`);
  // The body text the reader has to work through is no longer 11px.
  assert.ok(note >= 12.5, `generated note ${note} is too small`);
  // Generated wording carries a label of its own.
  assert.match(css, /\.ai-tag \{/);
});
