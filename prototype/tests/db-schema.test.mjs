import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../db/migrations/001_initial.sql", import.meta.url), "utf8");
const searchSql = await readFile(new URL("../db/migrations/003_keyword_search.sql", import.meta.url), "utf8");

test("keeps imported precedents unsearchable until verification and link checks pass", () => {
  assert.match(sql, /searchable boolean NOT NULL DEFAULT false/);
  assert.match(sql, /searchable = false OR verified_at IS NOT NULL/);
  assert.match(sql, /searchable = false OR link_status BETWEEN 200 AND 399/);
});

test("preserves raw source payloads and hashes", () => {
  assert.match(sql, /CREATE TABLE source_documents/);
  assert.match(sql, /raw_hash char\(64\) NOT NULL/);
  assert.match(sql, /raw_payload jsonb NOT NULL/);
});

test("adds a stored full-text vector and GIN index for verified precedent search", () => {
  assert.match(searchSql, /search_vector tsvector GENERATED ALWAYS AS/);
  assert.match(searchSql, /CREATE INDEX IF NOT EXISTS precedents_search_vector_idx/);
  assert.match(searchSql, /USING gin \(search_vector\)/);
});
