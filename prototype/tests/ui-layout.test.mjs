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
