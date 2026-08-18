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
});
