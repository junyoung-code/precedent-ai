# Fact Tag Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Extract neutral, deterministic fact tags from user descriptions and verified precedent text, persist precedent tags, and use them as an additional candidate and ranking signal in `POST /api/search`.

**Architecture:** One pure shared extractor is used by the browser prototype, verification/backfill jobs, and the search API. PostgreSQL stores one versioned tag record per canonical precedent. Phase 2B returns tag evidence and a provisional retrieval score; it does not claim legal probability or replace the later embedding-based 45/45/10 score.

**Tech Stack:** Node.js ESM, React/Vite, PostgreSQL 18, `node:test`, existing `pg` client.

## Global Constraints

- Do not create fields for guilt, innocence, complaint viability, punishment, or legal outcome.
- The selected user role may change copy later but must never change extracted tags or ranking.
- Only `precedents.searchable = true` records may be returned.
- Unknown fields are excluded from the tag-score denominator.
- The API label is `tagScore` or `retrievalScore`, never legal probability or final factual similarity.
- No new runtime dependency or external AI call is introduced in Phase 2B.

---

### Task 1: Shared neutral fact extraction

**Files:**
- Create: `prototype/src/lib/fact-tags.js`
- Modify: `prototype/src/lib/search.js`
- Create: `prototype/tests/fact-tags.test.mjs`

**Interfaces:**
- Produces: `extractFactTags(text)` and `compareFactTags(queryFacts, precedentFacts)`.
- Produces fields: `medium`, `messageForm`, `recipientIdentification`, `reachedRecipient`, `relationship`, `context`, `expressionType`, `repetition`, `additionalChannels`, `issueTags`, `normalizedText`, `extractionVersion`.

- [x] Write tests for channel, relationship, context, expression, repetition, delivery, neutral schema, and role-invariant extraction.
- [x] Run `node --test tests/fact-tags.test.mjs` and confirm failure before the module exists.
- [x] Move the current deterministic extractor out of `search.js`, add comparison evidence, and keep the existing prototype ranking behavior stable.
- [x] Run `node --test tests/fact-tags.test.mjs tests/analysis.test.mjs`.

### Task 2: Persist and backfill precedent fact tags

**Files:**
- Create: `prototype/db/migrations/004_fact_tags.sql`
- Create: `prototype/server/precedent-fact-tags.mjs`
- Modify: `prototype/server/source-verifier.mjs`
- Create: `prototype/scripts/backfill-fact-tags.mjs`
- Modify: `prototype/package.json`
- Modify: `prototype/tests/db-schema.test.mjs`
- Modify: `prototype/tests/source-verifier.test.mjs`

**Interfaces:**
- Produces: `upsertPrecedentFactTags({ connection, precedentId, sourceText })`.
- Stores one row per precedent with extraction version, scalar fact fields, issue tags, evidence, and extraction time.

- [x] Add failing schema and upsert tests.
- [x] Add `precedent_fact_tags`, constrained values, GIN issue-tag index, and extraction-version index.
- [x] Upsert tags in the same verification transaction that writes paragraphs and searchable state.
- [x] Add `npm run tags:backfill` for the existing 51 verified records.
- [x] Run DB/schema and source-verifier tests.

### Task 3: Use fact tags in the search API

**Files:**
- Modify: `prototype/server/search-precedents.mjs`
- Modify: `prototype/server/search-api.mjs`
- Modify: `prototype/tests/search-api.test.mjs`
- Modify: `prototype/docs/law-open-data.md`

**Interfaces:**
- `searchPrecedents({ pool, query, limit })` returns `queryFacts`, `comparedCount`, and results containing `keywordScore`, `tagScore`, `issueScore`, `retrievalScore`, `matchedFacts`, and `differentFacts`.

- [x] Add a failing test where a tag-matching precedent is found even when literal keyword overlap is weak.
- [x] Select at most 50 verified candidates using full-text or known tag matches.
- [x] Compute tag and issue scores in JavaScript, normalize lexical scores within the candidate set, and rank provisionally as lexical 45%, facts 45%, issues 10%.
- [x] Return evidence labels without emitting any outcome-related field.
- [x] Document the response and clearly state that embeddings are not included yet.
- [x] Run the full test suite and production build.
