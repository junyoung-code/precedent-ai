# 근거 연결 판례 요약 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검증된 판결문 문단만 사용해 판례별 AI 요약을 사전 생성하고, 모든 문장을 동일 판례의 실제 문단 ID에 연결한 뒤 검색 결과에 안전하게 표시한다.

**Architecture:** `summaries:backfill`이 검색 가능한 판례와 요약 허용 권리, 검증 문단을 읽어 OpenAI Responses API의 strict JSON schema로 최대 3문장을 생성한다. 서버 검증기를 통과한 결과만 원문 해시·모델·버전과 함께 저장하며, 검색은 현재 원문 해시와 일치하는 요약만 읽는다. 사용자 사례와 검색 요청은 요약 생성 API에 전달하지 않는다.

**Tech Stack:** PostgreSQL, Node.js ESM, OpenAI Responses API, React 19, Node test runner

## Global Constraints

- 사용자 입력, 역할 선택, 첨부 이미지는 요약 모델에 전달하지 않는다.
- 판결 결과 예측, 사용자 사건에 대한 판단, 신고·고소 가능성, 형량 예측은 생성하지 않는다.
- 사건번호·법원·날짜·공식 URL은 AI가 만들지 않고 검증 DB에서만 읽는다.
- 문장마다 동일 판례의 실제 `paragraph_id`를 1개 이상 가져야 한다.
- 하나라도 검증에 실패하면 일부 저장 없이 요약 전체를 `null`로 처리한다.
- 요약 생성 장애가 사용자 검색 API를 실패시키지 않는다.

---

### Task 1: 요약 저장 스키마

**Files:**
- Create: `prototype/db/migrations/006_grounded_summaries.sql`
- Modify: `prototype/tests/db-schema.test.mjs`

**Interfaces:**
- Consumes: `precedents(id, source_hash)`
- Produces: `precedent_summaries(precedent_id, source_hash, summary_version, model, sentences, generated_at)`

- [x] 마이그레이션 테스트에 `precedent_summaries`, 판례 외래 키, JSON 배열 체크, 원문 해시·모델·버전 필수 컬럼 검증을 추가한다.
- [x] 테스트를 실행해 migration 006 부재로 실패하는지 확인한다.
- [x] 판례당 현재 요약 하나만 저장하는 migration 006을 작성한다.
- [x] DB 스키마 테스트를 다시 실행한다.

### Task 2: OpenAI 요약 클라이언트와 근거 검증기

**Files:**
- Create: `prototype/server/summary-client.mjs`
- Create: `prototype/server/grounded-summary.mjs`
- Create: `prototype/tests/summary-client.test.mjs`
- Create: `prototype/tests/grounded-summary.test.mjs`

**Interfaces:**
- Consumes: `summarize({ paragraphs: Array<{paragraphId:string,text:string}> })`
- Produces: `validateGroundedSummary(payload, allowedParagraphIds)` → 검증된 문장 배열 또는 `SUMMARY_RESPONSE_INVALID`

- [x] mock fetch로 `/v1/responses`, `store:false`, `text.format.type=json_schema`, 모델과 문단 입력을 검증하는 실패 테스트를 작성한다.
- [x] API 키 누락, 비정상 HTTP, 잘못된 JSON 응답을 안정된 오류 코드로 변환하는 테스트를 작성한다.
- [x] 1~3개 문장, 비어 있지 않은 text, 1개 이상의 문단 ID, 허용 ID 집합, 정확한 키만 통과시키는 검증 테스트를 작성한다.
- [x] 존재하지 않는 문단 ID, 빈 근거, 4문장, 메타데이터 키, 예측 표현을 전체 거부하는 테스트를 작성한다.
- [x] `OpenAiSummaryClient`와 `validateGroundedSummary`를 최소 구현하고 테스트를 통과시킨다.

### Task 3: 사전 생성 backfill

**Files:**
- Create: `prototype/server/precedent-summaries.mjs`
- Create: `prototype/scripts/backfill-summaries.mjs`
- Create: `prototype/tests/precedent-summaries.test.mjs`
- Modify: `prototype/package.json`
- Modify: `prototype/.env.example`

**Interfaces:**
- Consumes: `backfillPrecedentSummaries({pool, summaryClient, limit})`
- Produces: `{selected, generated, skipped, failed, model, version}`

- [x] 검색 가능·링크 검증·`summary_allowed=true` 판례와 해당 문단만 선택하는 테스트를 작성한다.
- [x] 같은 source hash·model·version은 API 호출 없이 skipped 처리하는 테스트를 작성한다.
- [x] 검증 성공은 upsert하고 AI 호출·검증 실패는 다음 판례를 계속 처리하며 failed로 집계하는 테스트를 작성한다.
- [x] 입력은 문단 ID와 본문만 포함하고 최대 40,000자로 제한하는 선택 로직을 구현한다.
- [x] `summaries:backfill` 스크립트와 `SUMMARY_MODEL=gpt-5-mini`, `SUMMARY_BACKFILL_LIMIT=100` 예시 설정을 추가한다.

### Task 4: 검색 응답과 프런트 요약 연결

**Files:**
- Modify: `prototype/server/search-precedents.mjs`
- Modify: `prototype/src/lib/search-api.js`
- Modify: `prototype/tests/search-api.test.mjs`
- Modify: `prototype/tests/search-client.test.mjs`
- Modify: `prototype/tests/ui-copy.test.mjs`

**Interfaces:**
- Consumes: 현재 판례 `source_hash`와 일치하는 `precedent_summaries.sentences`
- Produces: `summary: Array<{text:string,sourceAnchor:string}> | null`

- [x] 검색 SQL이 현재 source hash와 일치하는 저장 요약만 join하는 테스트를 작성한다.
- [x] 저장 문장을 `판결문 문단 <id>` 근거 표시로 변환하고 잘못된 저장 형식은 `summary:null`로 만드는 테스트를 작성한다.
- [x] 브라우저 adapter가 검증된 summary만 UI 모델에 복사하고 임의 metadata·outcome을 버리는 테스트를 작성한다.
- [x] 기존 조건부 `result.summary?.length` UI와 AI 표시·공식 원문 안내 테스트를 통과시킨다.

### Task 5: 검증과 실제 생성 전 안전 확인

**Files:**
- Modify: `docs/superpowers/plans/2026-08-16-grounded-precedent-summaries.md`

**Interfaces:**
- Consumes: Tasks 1~4 구현
- Produces: 검증 결과와 미완료 외부 실행 상태

- [x] `npm test` 전체를 실행한다. (71/71)
- [x] `npm run build`와 `npm run test:sites`를 실행한다. (Sites 4/4)
- [x] migration 006을 로컬 DB에 적용한다.
- [x] 실제 OpenAI backfill은 공개 판결문 전송과 API 비용이 발생하므로 실행 직전에 사용자 확인을 받는다. (51/51 저장)
- [x] 생성 후 브라우저에서 `AI 생성 요약`, 문단 근거, 공식 원문 링크를 확인한다.

## 실행 결과 (2026-08-16)

- 선택 판례: 51건
- 요약 저장: 51건 (`grounded-v1`, `gpt-5-mini`)
- 현재 원문 해시 일치: 51건
- 존재하지 않는 문단 근거: 0건
