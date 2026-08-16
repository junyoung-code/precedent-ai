# 안전한 사례 입력 흐름 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캡처 원본을 서버에 보내지 않고, 가려진 사례 텍스트만 최대 1시간 임시 보관해 질문·검색·즉시 삭제까지 처리한다.

**Architecture:** 브라우저는 파일 검증, 미리보기, 수동 전사, 개인정보 가림 확인을 담당한다. Node HTTP API와 PostgreSQL은 가려진 사례·역할·중립 사실·질문 답변만 `intake_sessions`에 저장하며, 검색 완료·취소·TTL 정리 때 삭제한다. 기존 `/api/search`는 검증된 판례 검색만 계속 담당하고, 이미지 바이트·파일명·원문 텍스트를 받지 않는다.

**Tech Stack:** React 19, Node.js ESM HTTP server, PostgreSQL, node:test, Vite 6

## Global Constraints

- 캡처 이미지, 파일명, 원본 사례 설명, 원본 전사문을 서버·DB·로그에 저장하거나 외부 API로 전송하지 않는다.
- 사용자에게 유무죄·고소 가능성·처벌·대응 방법을 묻거나 표시하지 않는다.
- 외부 OCR·Vision API는 구현하지 않고, OCR 어댑터도 호출하지 않는다.
- 세션은 검색 완료·취소 시 즉시 삭제하고, 생성 시각 기준 1시간이 지나면 정리한다.
- 삭제 요청은 멱등적이며, 없는 세션도 성공으로 처리한다.
- 동일한 구현 또는 검증 문제가 두 번 연속 실패하면 세 번째 자동 시도 없이 멈추고 사용자에게 Sol 전환 필요성을 보고한다.
- 기존 검색 API, `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, `tests/sites-worker.test.mjs`를 보존한다.

---

### Task 1: 가림기와 중립 질문 순수 모듈

**Files:**
- Create: `prototype/src/lib/privacy-redaction.js`
- Create: `prototype/server/intake-questions.mjs`
- Create: `prototype/tests/privacy-redaction.test.mjs`
- Create: `prototype/tests/intake-questions.test.mjs`

**Interfaces:**
- Produces: `redactSensitiveText(text) -> { text: string, redactionCount: number }`
- Produces: `buildIntakeQuestions(facts) -> Array<{id, prompt, field}>`

- [ ] **Step 1: 가림기 실패 테스트를 작성한다.**

```js
assert.deepEqual(redactSensitiveText("연락처 010-1234-5678, @case_user, a@b.kr"), {
  text: "연락처 [가림], [가림], [가림]",
  redactionCount: 3,
});
```

- [ ] **Step 2: 가림기 실패를 확인한다.**

Run: `node --test tests/privacy-redaction.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: 최소 가림기를 구현한다.**

전화번호, 이메일, `@` 계정명, URL 계정 링크, 6-7자리 숫자 조합, 도로명 번지 표현을 `[가림]`으로 치환한다. 빈 입력은 빈 텍스트와 0건을 반환한다.

- [ ] **Step 4: 질문 실패 테스트를 작성한다.**

```js
assert.deepEqual(buildIntakeQuestions({ medium: "unknown", reachedRecipient: "unknown", repetition: "once" })
  .map((question) => question.field), ["medium", "recipientIdentification", "reachedRecipient"]);
```

- [ ] **Step 5: 질문 모듈을 구현하고 단위 테스트를 통과시킨다.**

이미 알려진 필드는 생략하고 전달 매체, 상대방 특정, 도달, 관계, 반복 순서로 최대 3개 중립 질문을 반환한다.

Run: `node --test tests/privacy-redaction.test.mjs tests/intake-questions.test.mjs`

Expected: PASS

- [ ] **Step 6: 커밋한다.**

```bash
git add src/lib/privacy-redaction.js server/intake-questions.mjs tests/privacy-redaction.test.mjs tests/intake-questions.test.mjs
git commit -m "feat: add intake redaction and questions"
```

### Task 2: 임시 세션 스키마와 저장소

**Files:**
- Create: `prototype/db/migrations/007_intake_sessions.sql`
- Create: `prototype/server/intake-sessions.mjs`
- Modify: `prototype/tests/db-schema.test.mjs`
- Create: `prototype/tests/intake-sessions.test.mjs`

**Interfaces:**
- Consumes: `{ role, redactedText, facts, questions, answers }`
- Produces: `createIntakeSession`, `answerIntakeSession`, `deleteIntakeSession`, `purgeExpiredIntakeSessions`

- [ ] **Step 1: 스키마·저장소 실패 테스트를 작성한다.**

테스트는 `intake_sessions`가 `role`, `redacted_text`, `facts`, `questions`, `answers`, `created_at`, `expires_at`만 저장하고 이미지·파일명·원문 컬럼이 없음을 검증한다. 삭제 SQL은 이미 없는 ID도 성공 결과를 반환해야 한다.

- [ ] **Step 2: 실패를 확인한다.**

Run: `node --test tests/db-schema.test.mjs tests/intake-sessions.test.mjs`

Expected: FAIL because migration 007 and intake repository do not exist.

- [ ] **Step 3: migration 007을 작성한다.**

```sql
CREATE TABLE intake_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL CHECK (role IN ('victim', 'reported')),
  redacted_text text NOT NULL,
  facts jsonb NOT NULL,
  questions jsonb NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX intake_sessions_expires_at_idx ON intake_sessions (expires_at);
```

- [ ] **Step 4: 저장소를 구현한다.**

`createIntakeSession`은 `expires_at = created_at + interval '1 hour'`로 만들고, `answerIntakeSession`은 허용된 질문 ID의 비어 있지 않은 답만 저장한다. `deleteIntakeSession`은 `DELETE ... RETURNING id`가 0행이어도 `{ deleted: true }`를 반환한다. `purgeExpiredIntakeSessions`는 `expires_at <= now()`만 삭제한다.

- [ ] **Step 5: 테스트를 통과시킨다.**

Run: `node --test tests/db-schema.test.mjs tests/intake-sessions.test.mjs`

Expected: PASS

- [ ] **Step 6: 커밋한다.**

```bash
git add db/migrations/007_intake_sessions.sql server/intake-sessions.mjs tests/db-schema.test.mjs tests/intake-sessions.test.mjs
git commit -m "feat: add expiring intake sessions"
```

### Task 3: 입력 세션 API와 안전한 검색 완료

**Files:**
- Modify: `prototype/server/search-api.mjs`
- Modify: `prototype/tests/search-api.test.mjs`
- Create: `prototype/tests/intake-api.test.mjs`

**Interfaces:**
- Consumes: `POST /api/intake { role, redactedText }`
- Produces: `{ sessionId, questions }`
- Consumes: `POST /api/intake/:id/answers { answers }`
- Produces: `{ sessionId, ready, questions }`
- Consumes: `POST /api/intake/:id/complete { allowExternalEmbedding }`
- Produces: existing verified search payload and deletes the session
- Consumes: `DELETE /api/intake/:id`
- Produces: `{ deleted: true }`

- [ ] **Step 1: API 실패 테스트를 작성한다.**

`POST /api/intake`는 원문이 아니라 호출자가 이미 가린 `redactedText`만 저장소에 전달하는지 검증한다. 답변 API는 만료·없는 세션에 `INTAKE_SESSION_NOT_FOUND`를 반환한다. 완료 API는 검색이 성공·실패한 경우 모두 `deleteIntakeSession`을 한 번 호출해야 한다.

- [ ] **Step 2: 실패를 확인한다.**

Run: `node --test tests/intake-api.test.mjs`

Expected: FAIL with 404 because intake routes are absent.

- [ ] **Step 3: API 라우트를 최소 구현한다.**

`readJson`의 32KB 상한을 적용한다. `createSearchApiServer`에 `intakeSessions`, `buildQuestions`, `extractFacts` 의존성을 주입한다. 완료 처리에는 `try/finally`로 삭제를 보장하고 오류 응답에는 사례 텍스트를 넣지 않는다.

- [ ] **Step 4: API 테스트를 통과시킨다.**

Run: `node --test tests/search-api.test.mjs tests/intake-api.test.mjs`

Expected: PASS

- [ ] **Step 5: 커밋한다.**

```bash
git add server/search-api.mjs tests/search-api.test.mjs tests/intake-api.test.mjs
git commit -m "feat: add private intake API"
```

### Task 4: 브라우저 캡처 검토와 질문 UI

**Files:**
- Modify: `prototype/src/App.jsx`
- Modify: `prototype/src/styles.css`
- Create: `prototype/src/lib/intake-api.js`
- Create: `prototype/tests/intake-client.test.mjs`
- Modify: `prototype/tests/ui-copy.test.mjs`

**Interfaces:**
- Consumes: `createIntake({role, redactedText})`, `answerIntake({sessionId, answers})`, `completeIntake({sessionId, allowExternalEmbedding})`, `cancelIntake({sessionId})`
- Produces: browser-only `previewUrl`, editable `transcript`, confirmed `redactedText`, and question state

- [ ] **Step 1: 브라우저 adapter와 UI 실패 테스트를 작성한다.**

테스트는 client가 파일 또는 파일명을 request body에 포함하지 않고 `redactedText`만 보내는지, 가림 미리보기·최대 3개 질문·취소 안내가 렌더되는지 검증한다.

- [ ] **Step 2: 실패를 확인한다.**

Run: `node --test tests/intake-client.test.mjs tests/ui-copy.test.mjs`

Expected: FAIL because intake adapter and UI copy are absent.

- [ ] **Step 3: 캡처 검토 UI를 구현한다.**

선택한 이미지는 `URL.createObjectURL`로만 미리보기하고 제거·컴포넌트 정리 때 `URL.revokeObjectURL`을 호출한다. 전사문은 사용자가 직접 입력한다. `redactSensitiveText` 결과를 제출 전 편집 가능한 확인 영역으로 보여준다. 화면에는 `캡처 이미지는 서버 또는 외부 AI에 전송하지 않습니다.`를 표시한다.

- [ ] **Step 4: 세션 질문과 완료 흐름을 연결한다.**

제출은 intake 생성 → 질문 답변 → 완료 검색 순으로 진행한다. 취소·새 사례·언마운트에서는 세션이 있으면 `DELETE`를 한 번 요청한다. 완료 API의 결과를 기존 결과 UI에 그대로 연결한다.

- [ ] **Step 5: 테스트를 통과시킨다.**

Run: `node --test tests/intake-client.test.mjs tests/ui-copy.test.mjs`

Expected: PASS

- [ ] **Step 6: 커밋한다.**

```bash
git add src/App.jsx src/styles.css src/lib/intake-api.js tests/intake-client.test.mjs tests/ui-copy.test.mjs
git commit -m "feat: add private intake review flow"
```

### Task 5: TTL 정리 명령과 전체 검증

**Files:**
- Create: `prototype/scripts/purge-expired-intake-sessions.mjs`
- Modify: `prototype/package.json`
- Modify: `prototype/.env.example`
- Modify: `prototype/docs/law-open-data.md`
- Modify: `docs/superpowers/plans/2026-08-16-private-intake-flow.md`

**Interfaces:**
- Consumes: `DATABASE_URL`
- Produces: `npm run intake:purge` and `{ deleted: number }`

- [ ] **Step 1: 정리 명령 실패 테스트를 작성한다.**

테스트는 만료된 세션만 삭제하며 사례 원문·전사문·식별 정보를 stdout에 출력하지 않는지 검증한다.

- [ ] **Step 2: 실패를 확인한다.**

Run: `node --test tests/intake-sessions.test.mjs`

Expected: FAIL because purge script is absent.

- [ ] **Step 3: 정리 명령과 문서를 구현한다.**

`intake:purge`는 DB 연결 후 `purgeExpiredIntakeSessions`를 한 번 실행하고 `{ "deleted": N }`만 출력한다. `.env.example`와 운영 문서는 cron 또는 플랫폼 스케줄러에서 매시간 이하 간격으로 실행해야 함을 설명한다.

- [ ] **Step 4: 전체 검증을 실행한다.**

Run: `npm test && npm run build && npm run test:sites && npm run data:check`

Expected: all tests pass, production build succeeds, Sites tests pass, and integrity check reports no stale hashes or invalid anchors.

- [ ] **Step 5: 계획 결과를 갱신하고 커밋한다.**

```bash
git add scripts/purge-expired-intake-sessions.mjs package.json .env.example docs/law-open-data.md docs/superpowers/plans/2026-08-16-private-intake-flow.md
git commit -m "feat: add intake session cleanup"
```
