import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../db/migrations/001_initial.sql", import.meta.url), "utf8");
const searchSql = await readFile(new URL("../db/migrations/003_keyword_search.sql", import.meta.url), "utf8");
const factTagSql = await readFile(new URL("../db/migrations/004_fact_tags.sql", import.meta.url), "utf8");
const embeddingSql = await readFile(new URL("../db/migrations/005_embeddings.sql", import.meta.url), "utf8");
const summarySql = await readFile(new URL("../db/migrations/006_grounded_summaries.sql", import.meta.url), "utf8");
const intakeSql = await readFile(new URL("../db/migrations/007_intake_sessions.sql", import.meta.url), "utf8");
const dispositionSql = await readFile(new URL("../db/migrations/008_dispositions.sql", import.meta.url), "utf8");

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

test("stores one versioned neutral fact-tag record per canonical precedent", () => {
  assert.match(factTagSql, /CREATE TABLE IF NOT EXISTS precedent_fact_tags/);
  assert.match(factTagSql, /precedent_id uuid PRIMARY KEY REFERENCES precedents\(id\) ON DELETE CASCADE/);
  assert.match(factTagSql, /extraction_version text NOT NULL/);
  assert.match(factTagSql, /issue_tags text\[\] NOT NULL/);
  assert.match(factTagSql, /additional_channels text\[\] NOT NULL/);
  assert.match(factTagSql, /USING gin \(issue_tags\)/);
  assert.doesNotMatch(factTagSql, /guilt|outcome|complaint|punishment/i);
});

test("stores versioned embedding metadata and a cosine index without outcome fields", () => {
  assert.match(embeddingSql, /embedding_model text/);
  assert.match(embeddingSql, /embedding_input_hash char\(64\)/);
  assert.match(embeddingSql, /embedding_source_hash char\(64\)/);
  assert.match(embeddingSql, /embedded_at timestamptz/);
  assert.match(embeddingSql, /USING hnsw \(embedding vector_cosine_ops\)/);
  assert.doesNotMatch(embeddingSql, /guilt|outcome|complaint|punishment/i);
});

test("stores only versioned grounded summaries for a canonical precedent", () => {
  assert.match(summarySql, /CREATE TABLE IF NOT EXISTS precedent_summaries/);
  assert.match(summarySql, /precedent_id uuid PRIMARY KEY REFERENCES precedents\(id\) ON DELETE CASCADE/);
  assert.match(summarySql, /source_hash char\(64\) NOT NULL/);
  assert.match(summarySql, /summary_version text NOT NULL/);
  assert.match(summarySql, /model text NOT NULL/);
  assert.match(summarySql, /sentences jsonb NOT NULL/);
  assert.match(summarySql, /jsonb_typeof\(sentences\) = 'array'/);
  assert.doesNotMatch(summarySql, /user_query|user_role|complaint_probability/i);
});

test("stores the court's own order as quoted text with a closed set of labels", () => {
  assert.match(dispositionSql, /CREATE TABLE IF NOT EXISTS precedent_dispositions/);
  assert.match(dispositionSql, /precedent_id uuid PRIMARY KEY REFERENCES precedents\(id\) ON DELETE CASCADE/);
  assert.match(dispositionSql, /order_text text NOT NULL CHECK \(length\(btrim\(order_text\)\) > 0\)/);
  assert.match(dispositionSql, /paragraph_ids text\[\] NOT NULL CHECK \(cardinality\(paragraph_ids\) > 0\)/);
  assert.match(dispositionSql, /kind text NOT NULL CHECK \(kind IN \(/);
  // The table records one precedent's own order. It must not gain a field that
  // could hold a reading of the user's case.
  assert.doesNotMatch(dispositionSql, /user_query|user_role|probability|prediction/i);
});

test("stores only redacted short-lived intake session fields", () => {
  assert.match(intakeSql, /CREATE TABLE IF NOT EXISTS intake_sessions/);
  assert.match(intakeSql, /role text NOT NULL CHECK \(role IN \('victim', 'reported'\)\)/);
  assert.match(intakeSql, /redacted_text text NOT NULL/);
  assert.match(intakeSql, /expires_at timestamptz NOT NULL/);
  assert.match(intakeSql, /expires_at = created_at \+ interval '1 hour'/);
  assert.match(intakeSql, /CREATE INDEX IF NOT EXISTS intake_sessions_expires_at_idx/);
  assert.doesNotMatch(intakeSql, /image|file_name|original_text|raw_transcript/i);
});
