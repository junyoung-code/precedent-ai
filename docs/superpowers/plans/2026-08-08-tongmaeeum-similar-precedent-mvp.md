# 통신매체이용음란 유사 판례 탐색 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비회원 사용자가 피해자·피신고인 관점을 선택하고 사건 설명과 대화 캡처를 제출하면, 검증된 통신매체이용음란 판례 30~50건 안에서 사실관계가 비슷한 판례만 찾아 근거 문단·공식 원문과 함께 보여주는 비공개 프로토타입을 만든다.

**Architecture:** Next.js 단일 애플리케이션 안에서 입력 세션, OCR·개인정보 가림, 사실 구조화, 혼합 검색, 출처 검증, 근거 요약을 명시적인 포트/어댑터로 분리한다. PostgreSQL + pgvector에는 검증된 판례와 암호화된 임시 세션만 두고, 사용자 결과는 저장하지 않는다. 판례 ID·사건번호·공식 URL은 오직 검증 저장소에서 읽으며 AI 출력은 이를 생성하거나 덮어쓸 수 없다.

**Tech Stack:** Node.js 22, pnpm 10, Next.js 16 App Router, React 19, TypeScript strict, PostgreSQL 18, pgvector 0.8.x, `pg`, Zod, OpenAI Responses/Embeddings API 뒤의 교체 가능한 게이트웨이, Vitest + Testing Library, Playwright, Docker Compose.

## Global Constraints

- 구현 기준 문서는 `docs/superpowers/specs/2026-08-08-tongmaeeum-similar-precedent-design.md`이며 충돌 시 이 문서가 우선한다.
- 화면에서 `성립 확률`, `고소 확률`, `유죄 확률`, `무죄 가능성`, `처벌 예상`이라는 표현을 사용하지 않는다. 숫자 라벨은 항상 `사실관계 유사도`다.
- AI에 사건번호, 법원명, 선고일, 공식 URL을 생성하도록 요청하지 않는다. 이 필드는 `VerifiedPrecedentRepository`만 공급한다.
- 검색 후보는 `searchable = true`이면서 최근 출처 검증과 원문 해시 검증을 통과한 판례로 제한한다.
- 최상위 점수가 55 미만이면 판례 카드를 하나도 만들지 않는다. 55 이상은 기본 3건, 사용자가 펼칠 때 최대 5건이다.
- 유사도는 `의미 45% + 구조화 사실 태그 45% + 쟁점 중복 10%`로 계산하며 판결 결과·형량은 입력 피처에서 제외한다.
- 사용자 원문, OCR 원문, 구조화 사례, 첨부 파일은 결과 응답 직후 삭제를 요청하고 생성 후 1시간을 절대 TTL로 강제한다.
- 실사용자 대상 공개 배포는 하지 않는다. 변호사 감수 전 테스트 데이터는 합성 사례 또는 공개 판례에서 재구성한 사례만 사용한다.
- OpenAI API를 쓰는 프로토타입은 API 입력·출력이 기본적으로 학습에 사용되지 않더라도 일부 API 로그가 기본 최대 30일 보관될 수 있음을 화면에 알린다. 실제 사건 입력을 받기 전 적격 엔드포인트의 Zero Data Retention 또는 동등한 최소 보관 계약을 확인한다.
- 국가법령정보 공동활용 API는 이용 승인 후에만 운영 호출한다. 승인 전에는 녹화된 공식 응답 fixture와 관리자 검증 import만 사용한다.
- 법원 판결서 인터넷열람은 이용조건·수수료·재이용 범위와 명시적 허가가 확인될 때까지 자동 수집 코드를 만들지 않는다.
- 모든 기능은 실패 테스트를 먼저 작성하고, 실패를 확인한 다음 최소 구현, 전체 관련 테스트, 커밋 순서로 진행한다.

---

## 1. Repository Map

```text
.
├── .env.example
├── .gitignore
├── docker-compose.yml
├── eslint.config.mjs
├── package.json
├── playwright.config.ts
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── docs/
│   ├── data-sources/
│   │   ├── law-open-data.md
│   │   └── court-judgment-internet-access.md
│   ├── operations/
│   │   ├── data-retention.md
│   │   └── incident-checklist.md
│   ├── research/
│   │   └── prototype-test-script.md
│   └── superpowers/
│       ├── specs/2026-08-08-tongmaeeum-similar-precedent-design.md
│       └── plans/2026-08-08-tongmaeeum-similar-precedent-mvp.md
├── data/
│   ├── curated/precedents.json
│   └── fixtures/law-open-data/
│       ├── list.xml
│       └── detail.xml
├── db/migrations/
│   ├── 0001_extensions.sql
│   ├── 0002_precedents.sql
│   └── 0003_analysis_sessions.sql
├── scripts/
│   ├── migrate.ts
│   ├── import-curated.ts
│   ├── sync-law-open-data.ts
│   ├── verify-official-links.ts
│   └── purge-expired-sessions.ts
├── src/
│   ├── app/
│   │   ├── api/analysis/route.ts
│   │   ├── api/analysis/[sessionId]/ocr/route.ts
│   │   ├── api/analysis/[sessionId]/facts/route.ts
│   │   ├── api/analysis/[sessionId]/search/route.ts
│   │   ├── api/analysis/[sessionId]/complete/route.ts
│   │   ├── analysis/[sessionId]/page.tsx
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── app-shell.tsx
│   │   ├── role-selector.tsx
│   │   ├── case-composer.tsx
│   │   ├── ocr-review.tsx
│   │   ├── follow-up-form.tsx
│   │   ├── confirmed-case-summary.tsx
│   │   ├── search-coverage.tsx
│   │   ├── precedent-card.tsx
│   │   └── result-empty-state.tsx
│   └── lib/
│       ├── ai/ai-gateway.ts
│       ├── ai/openai-gateway.ts
│       ├── config/env.ts
│       ├── db/pool.ts
│       ├── domain/analysis.ts
│       ├── domain/precedent.ts
│       ├── facts/extract-facts.ts
│       ├── facts/follow-up-questions.ts
│       ├── ocr/ocr-gateway.ts
│       ├── precedents/source-adapter.ts
│       ├── precedents/curated-source.ts
│       ├── precedents/law-open-data-source.ts
│       ├── precedents/court-judgment-source.ts
│       ├── precedents/verified-manual-source.ts
│       ├── precedents/repository.ts
│       ├── precedents/source-verifier.ts
│       ├── privacy/encrypted-payload.ts
│       ├── privacy/encrypted-upload-store.ts
│       ├── privacy/pii-redactor.ts
│       ├── privacy/session-repository.ts
│       ├── retrieval/hybrid-search.ts
│       ├── retrieval/similarity.ts
│       ├── results/assemble-results.ts
│       └── summaries/grounded-summarizer.ts
└── tests/
    ├── e2e/analysis-flow.spec.ts
    ├── fixtures/precedents.ts
    ├── integration/
    │   ├── curated-import.test.ts
    │   ├── law-open-data.test.ts
    │   ├── privacy-lifecycle.test.ts
    │   ├── retrieval.test.ts
    │   └── source-verification.test.ts
    ├── quality/retrieval-cases.json
    ├── quality/retrieval-quality.test.ts
    ├── setup.ts
    └── unit/
        ├── analysis-schema.test.ts
        ├── pii-redactor.test.ts
        ├── follow-up-questions.test.ts
        ├── similarity.test.ts
        ├── grounded-summarizer.test.ts
        └── assemble-results.test.ts
```

## 2. Core Contracts

계획 전체에서 아래 타입을 바꾸지 않고 사용한다. 이름이 바뀌면 관련 테스트·DB 컬럼·API 응답을 같은 커밋에서 함께 바꾼다.

```ts
export type UserRole = "victim" | "reported";

export type CaseFacts = {
  role: UserRole;
  medium: "kakao" | "sns_dm" | "game_chat" | "sms" | "community" | "other" | "unknown";
  messageForm: "text" | "image" | "audio" | "mixed" | "unknown";
  recipientIdentification: "direct_account" | "group_member" | "public_post" | "unknown";
  reachedRecipient: "yes" | "no" | "unknown";
  relationship: "stranger" | "acquaintance" | "partner_or_ex" | "coworker" | "game_user" | "unknown";
  context: "conflict" | "sexual_conversation" | "one_sided" | "joke_claimed" | "other" | "unknown";
  expressionType: Array<"sexual_text" | "sexual_image" | "sexual_audio" | "insult_with_sexual_terms" | "other">;
  repetition: "once" | "repeated" | "unknown";
  additionalChannels: "yes" | "no" | "unknown";
  neutralSummary: string;
  issueTags: string[];
};

export type VerifiedPrecedent = {
  id: string;
  provider: "curated" | "law_open_data" | "verified_manual" | "court_judgment";
  providerRecordId: string;
  court: string;
  caseNumber: string;
  caseName: string;
  decisionDate: string;
  officialUrl: string;
  sourceHash: string;
  collectedAt: string;
  verifiedAt: string;
  searchable: true;
  facts: Omit<CaseFacts, "role" | "neutralSummary" | "issueTags">;
  neutralSummary: string;
  issueTags: string[];
  paragraphs: Array<{ id: string; text: string }>;
  embedding: number[];
};

export type SimilarityBreakdown = {
  semantic: number;
  facts: number;
  issues: number;
  total: number;
};

export type GroundedSentence = {
  text: string;
  paragraphIds: string[];
};

export type PrecedentResult = {
  id: string;
  court: string;
  caseNumber: string;
  caseName: string;
  decisionDate: string;
  officialUrl: string;
  similarity: SimilarityBreakdown;
  similarities: string[];
  differences: string[];
  summary: GroundedSentence[] | null;
};
```

---

### Task 1: 실행 가능한 Next.js·테스트·PostgreSQL 골격 만들기

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Modify: `.gitignore`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `tests/setup.ts`
- Create: `tests/unit/smoke.test.ts`

- [ ] **Step 1: 의존성과 스크립트를 선언한다**

  ```bash
  pnpm init
  pnpm add next@latest react@latest react-dom@latest openai pg sharp zod
  pnpm add -D typescript @types/node @types/pg @types/react @types/react-dom eslint eslint-config-next vitest jsdom @vitejs/plugin-react @testing-library/react @testing-library/jest-dom @playwright/test tsx
  ```

  `package.json` 스크립트는 다음 이름을 정확히 둔다.

  ```json
  {
    "scripts": {
      "dev": "next dev",
      "build": "next build",
      "lint": "eslint .",
      "typecheck": "tsc --noEmit",
      "test": "vitest run",
      "test:watch": "vitest",
      "test:e2e": "playwright test",
      "db:migrate": "tsx scripts/migrate.ts",
      "db:import-curated": "tsx scripts/import-curated.ts",
      "db:verify-links": "tsx scripts/verify-official-links.ts",
      "privacy:purge": "tsx scripts/purge-expired-sessions.ts"
    }
  }
  ```

- [ ] **Step 2: 실패하는 smoke test를 작성한다**

  ```ts
  import { render, screen } from "@testing-library/react";
  import HomePage from "@/app/page";

  test("홈은 법적 판단이 아닌 사실관계 유사도임을 알린다", () => {
    render(<HomePage />);
    expect(screen.getByText(/법적 판단이 아닌 사실관계 유사도/)).toBeInTheDocument();
  });
  ```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

  Run: `pnpm test tests/unit/smoke.test.ts`

  Expected: `HomePage` 또는 안내 문구가 없어 FAIL.

- [ ] **Step 4: 최소 홈 페이지와 테스트 설정을 구현한다**

  `vitest.config.ts`에 `jsdom`, `@` alias, `tests/setup.ts`를 연결하고 setup 파일에서 `@testing-library/jest-dom/vitest`를 import한다. `eslint.config.mjs`는 `eslint-config-next/core-web-vitals`와 `eslint-config-next/typescript` flat config를 사용한다. 홈에는 `법적 판단이 아닌 사실관계 유사도를 보여드려요` 문구를 넣는다. `docker-compose.yml`은 `pgvector/pgvector:pg18` 이미지와 `precedent_ai` DB, healthcheck를 선언한다. 로컬 `.env.local`의 세션 키는 `openssl rand -base64 32` 출력으로 생성하고 저장소에는 커밋하지 않는다.

  `.env.example`은 실제 비밀값 없이 아래 키를 포함한다.

  ```dotenv
  DATABASE_URL=postgres://precedent:precedent@localhost:5432/precedent_ai
  SESSION_ENCRYPTION_KEY_BASE64=
  AI_GATEWAY_MODE=openai
  OPENAI_API_KEY=
  OPENAI_TEXT_MODEL=gpt-5-mini
  OPENAI_EMBEDDING_MODEL=text-embedding-3-small
  LAW_OPEN_DATA_OC=
  APP_ORIGIN=http://localhost:3000
  ```

  `.gitignore`에 `.env*`, `!.env.example`, `.next/`, `node_modules/`, `coverage/`, `playwright-report/`, `test-results/`, `var/`를 추가한다.

- [ ] **Step 5: 골격을 검증한다**

  Run: `pnpm test tests/unit/smoke.test.ts && pnpm typecheck && pnpm build`

  Expected: smoke 1개 PASS, type error 0개, Next build 성공.

- [ ] **Step 6: 커밋한다**

  ```bash
  git add package.json pnpm-lock.yaml tsconfig.json next.config.ts eslint.config.mjs vitest.config.ts playwright.config.ts docker-compose.yml .env.example .gitignore src tests/setup.ts tests/unit/smoke.test.ts
  git commit -m "chore: scaffold precedent finder app"
  ```

### Task 2: 법적 판단 필드가 없는 도메인 스키마와 DB를 만든다

**Files:**
- Create: `src/lib/domain/analysis.ts`
- Create: `src/lib/domain/precedent.ts`
- Create: `src/lib/config/env.ts`
- Create: `src/lib/db/pool.ts`
- Create: `db/migrations/0001_extensions.sql`
- Create: `db/migrations/0002_precedents.sql`
- Create: `db/migrations/0003_analysis_sessions.sql`
- Create: `scripts/migrate.ts`
- Create: `tests/unit/analysis-schema.test.ts`

- [ ] **Step 1: 금지 필드를 거부하는 실패 테스트를 작성한다**

  ```ts
  const valid = { ...validCaseFacts, convictionProbability: 0.8 };
  expect(() => caseFactsSchema.parse(valid)).toThrow();
  expect(caseFactsSchema.keyof().options).not.toContain("outcome");
  expect(caseFactsSchema.keyof().options).not.toContain("sentence");
  ```

- [ ] **Step 2: 실패를 확인한다**

  Run: `pnpm test tests/unit/analysis-schema.test.ts`

  Expected: schema 모듈이 없어 FAIL.

- [ ] **Step 3: strict Zod 스키마와 환경 스키마를 구현한다**

  `caseFactsSchema`와 `verifiedPrecedentSchema`는 `.strict()`를 사용한다. `neutralSummary`는 30~2,000자, `issueTags`는 최대 12개, embedding은 정확히 1,536개 숫자로 제한한다. `officialUrl`은 URL 형식만 여기서 검사하고 공식 도메인 검사는 source verifier가 담당한다.

- [ ] **Step 4: 마이그레이션을 구현한다**

  핵심 판례 테이블은 아래 제약을 포함한다.

  ```sql
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE TABLE precedents (
    id uuid PRIMARY KEY,
    provider text NOT NULL CHECK (provider IN ('curated','law_open_data','verified_manual','court_judgment')),
    provider_record_id text NOT NULL,
    court text NOT NULL,
    case_number text NOT NULL,
    case_name text NOT NULL,
    decision_date date NOT NULL,
    official_url text NOT NULL,
    source_text text NOT NULL,
    source_hash char(64) NOT NULL,
    collected_at timestamptz NOT NULL,
    verified_at timestamptz,
    link_checked_at timestamptz,
    link_status integer,
    facts jsonb NOT NULL,
    neutral_summary text NOT NULL,
    issue_tags text[] NOT NULL,
    embedding vector(1536),
    searchable boolean NOT NULL DEFAULT false,
    UNIQUE(provider, provider_record_id),
    UNIQUE(court, case_number, decision_date)
  );

  CREATE TABLE precedent_paragraphs (
    precedent_id uuid NOT NULL REFERENCES precedents(id) ON DELETE CASCADE,
    paragraph_id text NOT NULL,
    ordinal integer NOT NULL,
    body text NOT NULL,
    PRIMARY KEY(precedent_id, paragraph_id),
    UNIQUE(precedent_id, ordinal)
  );
  ```

  `analysis_sessions`에는 `session_id`, AES-GCM 암호문, IV, auth tag, `created_at`, `expires_at`, `delete_requested_at`, `deleted_at`만 둔다. 원문용 평문 컬럼은 만들지 않는다.

- [ ] **Step 5: 실제 DB에 적용하고 검증한다**

  Run: `docker compose up -d db && pnpm db:migrate && pnpm test tests/unit/analysis-schema.test.ts && pnpm typecheck`

  Expected: migration 3개 적용, schema tests PASS, type error 0개.

- [ ] **Step 6: 커밋한다**

  ```bash
  git add src/lib/domain src/lib/config src/lib/db db scripts/migrate.ts tests/unit/analysis-schema.test.ts
  git commit -m "feat: define non-predictive case and precedent schema"
  ```

### Task 3: 판례 import가 검증 전에는 검색 가능해지지 않게 만든다

**Files:**
- Create: `src/lib/precedents/source-adapter.ts`
- Create: `src/lib/precedents/curated-source.ts`
- Create: `src/lib/precedents/repository.ts`
- Create: `src/lib/precedents/source-verifier.ts`
- Create: `scripts/import-curated.ts`
- Create: `scripts/verify-official-links.ts`
- Create: `data/curated/precedents.json`
- Create: `tests/fixtures/precedents.ts`
- Create: `tests/integration/curated-import.test.ts`
- Create: `tests/integration/source-verification.test.ts`

- [ ] **Step 1: 검색 차단 실패 테스트를 작성한다**

  아래 네 경우를 각각 테스트한다.

  1. 공식 URL이 `law.go.kr`, `www.law.go.kr`, `open.law.go.kr`, `scourt.go.kr` 하위가 아니다.
  2. `court`, `caseNumber`, `decisionDate`, `sourceText` 중 하나가 비어 있다.
  3. 현재 본문 SHA-256과 `sourceHash`가 다르다.
  4. 성공 링크 검사 기록이 없거나 24시간보다 오래됐다.

  모든 경우 `repository.listSearchable()` 결과가 빈 배열이어야 한다.

- [ ] **Step 2: 실패를 확인한다**

  Run: `pnpm test tests/integration/curated-import.test.ts tests/integration/source-verification.test.ts`

  Expected: import/verifier 모듈이 없어 FAIL.

- [ ] **Step 3: source adapter와 fail-closed verifier를 구현한다**

  ```ts
  export interface PrecedentSourceAdapter {
    readonly provider: VerifiedPrecedent["provider"];
    listCandidates(): Promise<SourceCandidate[]>;
    fetchRecord(providerRecordId: string): Promise<SourceRecord>;
  }

  export const ALLOWED_OFFICIAL_HOSTS = [
    "law.go.kr",
    "www.law.go.kr",
    "open.law.go.kr",
    "scourt.go.kr",
    "www.scourt.go.kr",
  ] as const;
  ```

  `SourceVerifier.verify(id, now)`는 DB 레코드를 다시 읽어 URL host, 필수 메타데이터, SHA-256, paragraph 존재, 24시간 이내 2xx/3xx 링크 검사를 모두 통과한 때에만 `searchable=true`로 바꾼다. 하나라도 실패하면 같은 트랜잭션에서 `searchable=false`로 강등한다.

- [ ] **Step 4: production import와 test fixture를 분리한다**

  테스트 fixture의 URL은 `https://example.test/...`을 쓰고 `NODE_ENV=test`에서만 in-memory repository와 `OfficialUrlPolicy(["example.test"])`를 주입한다. production `OfficialUrlPolicy`는 위 공식 host 목록만 받는다. `scripts/import-curated.ts`는 `.test`, `localhost`, 사설 IP URL을 즉시 거부한다. 초기 `data/curated/precedents.json`은 빈 배열 `[]`로 커밋하고, 실제 판례는 Task 12의 검증 절차로 채운다.

- [ ] **Step 5: 링크 검사 결과가 검색 상태를 바꾸는지 확인한다**

  Run: `pnpm test tests/integration/curated-import.test.ts tests/integration/source-verification.test.ts`

  Expected: 허위/불완전/오래된 레코드 0건 노출, 검증 fixture 1건만 노출.

- [ ] **Step 6: 커밋한다**

  ```bash
  git add src/lib/precedents scripts/import-curated.ts scripts/verify-official-links.ts data/curated tests/fixtures tests/integration/curated-import.test.ts tests/integration/source-verification.test.ts
  git commit -m "feat: fail closed on unverified precedent sources"
  ```

### Task 4: 암호화된 일회성 세션과 1시간 강제 삭제를 구현한다

**Files:**
- Create: `src/lib/privacy/encrypted-payload.ts`
- Create: `src/lib/privacy/encrypted-upload-store.ts`
- Create: `src/lib/privacy/session-repository.ts`
- Create: `scripts/purge-expired-sessions.ts`
- Create: `src/app/api/analysis/route.ts`
- Create: `src/app/api/analysis/[sessionId]/complete/route.ts`
- Create: `tests/integration/privacy-lifecycle.test.ts`
- Create: `docs/operations/data-retention.md`

- [ ] **Step 1: 삭제 생명주기 실패 테스트를 작성한다**

  가짜 시계를 사용해 다음을 검증한다.

  ```ts
  const session = await repo.create({ role: "victim", narrative: "합성 입력" }, now);
  expect(await repo.read(session.id)).toMatchObject({ narrative: "합성 입력" });
  expect(await rawDbValue(session.id)).not.toContain("합성 입력");
  await repo.complete(session.id, plusMinutes(now, 5));
  expect(await repo.read(session.id)).toBeNull();

  const expired = await repo.create(payload, now);
  const upload = await uploads.put(expired.id, pngBytes);
  expect(await readRawFile(upload.path)).not.toContain(pngBytes);
  await repo.purgeExpired(plusMinutes(now, 61));
  expect(await repo.read(expired.id)).toBeNull();
  expect(await uploads.exists(upload.id)).toBe(false);
  ```

- [ ] **Step 2: 실패를 확인한다**

  Run: `pnpm test tests/integration/privacy-lifecycle.test.ts`

  Expected: session repository가 없어 FAIL.

- [ ] **Step 3: AES-256-GCM 암호화와 세션 저장소를 구현한다**

  `SESSION_ENCRYPTION_KEY_BASE64`는 디코딩 후 정확히 32바이트여야 한다. 각 저장마다 12바이트 난수 IV를 만들고 auth tag를 별도 컬럼에 저장한다. 세션 ID는 `crypto.randomUUID()`를 쓰며 `expires_at = created_at + interval '1 hour'`를 DB에서 강제한다.

  첨부 파일은 `var/uploads/{sessionId}/{uploadId}.bin`에 AES-256-GCM 암호문으로만 저장하고 파일 권한을 `0600`으로 제한한다. 경로 구성 전 session/upload ID가 UUID인지 검사해 path traversal을 막는다. OCR 성공 직후 해당 암호문을 삭제하고, 실패·취소 파일은 session complete 또는 TTL purge가 삭제한다.

- [ ] **Step 4: 생성·완료 API를 구현한다**

  `POST /api/analysis`는 role과 20~5,000자 narrative를 받고 `{sessionId, expiresAt}`만 반환한다. `POST /api/analysis/:sessionId/complete`는 암호문과 임시 업로드를 지우고 `{deleted: true}`를 반환한다. 어떤 응답·로그에도 narrative를 출력하지 않는다.

- [ ] **Step 5: purge와 실패 재시도를 구현한다**

  `pnpm privacy:purge`는 TTL 경과 세션을 100개씩 `FOR UPDATE SKIP LOCKED`로 삭제하고 삭제 건수만 로그에 남긴다. 삭제 실패는 error code와 session ID의 앞 8자만 기록하고 다음 실행에서 재시도한다. 운영 문서에는 5분 주기 실행과 1시간 TTL 경고 기준을 명시한다.

- [ ] **Step 6: 검증하고 커밋한다**

  Run: `pnpm test tests/integration/privacy-lifecycle.test.ts && pnpm typecheck`

  Expected: 암호문 비노출, complete 즉시 삭제, 61분 purge 모두 PASS.

  ```bash
  git add src/lib/privacy src/app/api/analysis scripts/purge-expired-sessions.ts tests/integration/privacy-lifecycle.test.ts docs/operations/data-retention.md
  git commit -m "feat: enforce encrypted one-hour analysis sessions"
  ```

### Task 5: 역할 선택·서술·첨부 중심의 홈 화면을 구현한다

**Files:**
- Create: `src/components/app-shell.tsx`
- Create: `src/components/role-selector.tsx`
- Create: `src/components/case-composer.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/unit/case-composer.test.tsx`

- [ ] **Step 1: 역할과 고지 문구의 실패 테스트를 작성한다**

  테스트는 피해자/피신고인 두 버튼, 이미지 `accept="image/png,image/jpeg,image/webp"`, submit 비활성 조건, 자동 삭제 고지, 사실관계 유사도 고지를 확인한다. `고소 가능`, `유죄 확률` 텍스트가 DOM에 없음을 함께 확인한다.

- [ ] **Step 2: 실패를 확인한다**

  Run: `pnpm test tests/unit/case-composer.test.tsx`

  Expected: UI component가 없어 FAIL.

- [ ] **Step 3: 참고 이미지의 시각 언어로 홈을 구현한다**

  - 바깥 배경 `#f2f2f3`, 24px radius의 흰 앱 프레임, 72px 세로 사이드바.
  - 중앙 최대 너비 960px, 보라색 blur orb, 큰 한국어 제목, 얇은 `#e7e7ec` 테두리 입력 카드.
  - 역할 선택은 `피해를 받은 사람` / `신고를 받았거나 연락을 받은 사람`으로 표시한다.
  - 첨부는 최대 5장, 파일당 8MB, PNG/JPEG/WebP만 클라이언트와 서버에서 모두 검사한다.
  - 모바일에서는 사이드바를 상단 56px 바로 바꾸고 입력 카드를 화면 폭에 맞춘다.

- [ ] **Step 4: 분석 시작 흐름을 연결한다**

  submit은 `POST /api/analysis`를 호출하고 성공 시 `/analysis/{sessionId}`로 이동한다. 파일은 이 단계에서 서버에 올리지 않고 세션 생성 뒤 Task 6의 OCR endpoint로 올린다.

- [ ] **Step 5: UI 테스트와 빌드를 확인한다**

  Run: `pnpm test tests/unit/case-composer.test.tsx && pnpm typecheck && pnpm build`

  Expected: UI tests PASS, build 성공.

- [ ] **Step 6: 커밋한다**

  ```bash
  git add src/components src/app/page.tsx src/app/globals.css tests/unit/case-composer.test.tsx
  git commit -m "feat: build role-aware private case intake"
  ```

### Task 6: OCR 검토와 개인정보 가림 단계를 구현한다

**Files:**
- Create: `src/lib/ocr/ocr-gateway.ts`
- Create: `src/lib/ai/ai-gateway.ts`
- Create: `src/lib/ai/openai-gateway.ts`
- Create: `src/lib/privacy/pii-redactor.ts`
- Create: `src/app/api/analysis/[sessionId]/ocr/route.ts`
- Create: `src/components/ocr-review.tsx`
- Create: `tests/unit/pii-redactor.test.ts`
- Create: `tests/integration/ocr-route.test.ts`

- [ ] **Step 1: 개인정보 가림과 저신뢰 OCR 실패 테스트를 작성한다**

  입력 `김민수, 010-1234-5678, minsu@example.com, @real_id`가 각각 `[이름]`, `[전화번호]`, `[이메일]`, `[계정]`으로 바뀌어야 한다. confidence 0.8 미만 문장이 하나라도 있으면 `confirmed=false` 상태에서 다음 단계로 갈 수 없어야 한다.

- [ ] **Step 2: 실패를 확인한다**

  Run: `pnpm test tests/unit/pii-redactor.test.ts tests/integration/ocr-route.test.ts`

  Expected: OCR/redactor 모듈이 없어 FAIL.

- [ ] **Step 3: 교체 가능한 OCR gateway를 구현한다**

  ```ts
  export interface OcrGateway {
    extract(input: { bytes: Uint8Array; mimeType: "image/png" | "image/jpeg" | "image/webp" }): Promise<{
      lines: Array<{ id: string; text: string; confidence: number }>;
    }>;
  }
  ```

  OpenAI adapter는 서버에서만 `gpt-5-mini`의 image input을 호출하고, line ID·text·legibility confidence만 구조화 JSON으로 받는다. API key, base64 image, OCR text를 로그에 남기지 않는다. 테스트는 네트워크를 호출하지 않고 `FakeOcrGateway`를 주입한다.

- [ ] **Step 4: 서버 파일 방어와 가림 순서를 구현한다**

  `sharp().metadata()`로 실제 이미지인지 확인하고 픽셀 수를 20MP 이하로 제한한다. 검증된 bytes를 encrypted upload store에 넣고 OCR 호출 직전에 메모리로 복호화하며, OCR 성공 뒤 암호문과 메모리 buffer를 즉시 지운다. OCR 원문은 암호화 세션에만 넣고, 정규식 기반 전화·이메일·계정 가림 뒤 한국 이름 후보는 OCR 검토 화면에서 사용자가 추가로 선택해 가릴 수 있게 한다. 다음 단계에는 사용자가 확인한 가림 텍스트만 전달한다.

- [ ] **Step 5: OCR 검토 화면을 구현한다**

  confidence 0.8 미만 줄을 보라색 테두리로 표시하고 직접 수정할 수 있게 한다. `확인한 텍스트로 계속` 버튼은 모든 저신뢰 줄을 확인한 뒤 활성화한다. 외부 AI 처리와 프로토타입 데이터 제한 안내를 업로드 직전에 표시한다.

- [ ] **Step 6: 검증하고 커밋한다**

  Run: `pnpm test tests/unit/pii-redactor.test.ts tests/integration/ocr-route.test.ts && pnpm typecheck`

  Expected: PII fixture 전부 가림, 미확인 OCR 차단, 이미지 위장 파일 거부.

  ```bash
  git add src/lib/ocr src/lib/ai src/lib/privacy/pii-redactor.ts src/app/api/analysis src/components/ocr-review.tsx tests/unit/pii-redactor.test.ts tests/integration/ocr-route.test.ts
  git commit -m "feat: add reviewable OCR and PII redaction"
  ```

### Task 7: 중립적 사실 구조화와 최대 3개 추가 질문을 구현한다

**Files:**
- Create: `src/lib/facts/extract-facts.ts`
- Create: `src/lib/facts/follow-up-questions.ts`
- Create: `src/app/api/analysis/[sessionId]/facts/route.ts`
- Create: `src/components/follow-up-form.tsx`
- Create: `src/components/confirmed-case-summary.tsx`
- Create: `tests/unit/follow-up-questions.test.ts`
- Create: `tests/integration/facts-route.test.ts`

- [ ] **Step 1: 판단어 제거와 질문 수 제한 실패 테스트를 작성한다**

  - AI fixture가 `outcome`, `guilt`, `complaintPossible`을 반환하면 Zod parse가 실패해야 한다.
  - unknown 필드가 6개여도 질문은 정확히 최대 3개여야 한다.
  - 역할이 달라도 같은 사실 입력의 태그와 점수용 필드는 같고 질문 문구의 주어만 달라야 한다.

- [ ] **Step 2: 실패를 확인한다**

  Run: `pnpm test tests/unit/follow-up-questions.test.ts tests/integration/facts-route.test.ts`

  Expected: facts modules가 없어 FAIL.

- [ ] **Step 3: 사실 추출 gateway 호출을 구현한다**

  AI에는 가림 완료 텍스트만 전달하고 Core Contracts의 `CaseFacts` JSON만 요청한다. 응답을 strict Zod로 검사한 뒤 `유죄`, `무죄`, `성립`, `고소`, `처벌` 판단어가 neutralSummary에 들어오면 한 번 재생성하고 두 번째도 실패하면 `INSUFFICIENT_NEUTRAL_SUMMARY`로 중단한다.

- [ ] **Step 4: 결정론적 질문 우선순위를 구현한다**

  우선순위는 `reachedRecipient`, `medium`, `relationship`, `repetition`, `context`, `additionalChannels`다. unknown인 첫 3개만 질문한다. 질문 ID와 허용 답변은 코드 상수로 두어 AI가 질문을 새로 만들지 못하게 한다.

- [ ] **Step 5: 확인 UI와 부족 정보 빈 상태를 구현한다**

  질문 답변 뒤 중립 요약과 태그를 보여주고 사용자가 수정·확인하도록 한다. 최대 3개 답변 뒤에도 `medium`, `reachedRecipient`, `expressionType` 중 두 개 이상이 unknown이면 검색 버튼 대신 `비교에 필요한 정보가 부족합니다`를 보여준다.

- [ ] **Step 6: 검증하고 커밋한다**

  Run: `pnpm test tests/unit/follow-up-questions.test.ts tests/integration/facts-route.test.ts && pnpm typecheck`

  Expected: 질문 최대 3개, 판단 필드 거부, 불충분 입력 검색 차단.

  ```bash
  git add src/lib/facts src/app/api/analysis src/components/follow-up-form.tsx src/components/confirmed-case-summary.tsx tests/unit/follow-up-questions.test.ts tests/integration/facts-route.test.ts
  git commit -m "feat: structure neutral case facts with bounded questions"
  ```

### Task 8: 판결 결과를 보지 않는 45/45/10 혼합 검색을 구현한다

**Files:**
- Create: `src/lib/retrieval/similarity.ts`
- Create: `src/lib/retrieval/hybrid-search.ts`
- Create: `tests/unit/similarity.test.ts`
- Create: `tests/integration/retrieval.test.ts`

- [ ] **Step 1: 공식 점수와 임계값의 실패 테스트를 작성한다**

  ```ts
  expect(combine({ semantic: 0.8, facts: 0.6, issues: 0.5 })).toBe(67);
  expect(selectResults([{ id: "a", total: 54.99 }])).toEqual([]);
  expect(selectResults(makeScores(6, 80), { expanded: true })).toHaveLength(5);
  ```

  같은 사실·본문에 판결 결과와 형량만 바꾼 두 fixture의 순위가 같아야 한다.

- [ ] **Step 2: 실패를 확인한다**

  Run: `pnpm test tests/unit/similarity.test.ts tests/integration/retrieval.test.ts`

  Expected: retrieval modules가 없어 FAIL.

- [ ] **Step 3: 결정론적 tag similarity를 구현한다**

  facts 점수는 `medium`, `messageForm`, `recipientIdentification`, `reachedRecipient`, `relationship`, `context`, `repetition`, `additionalChannels`의 알려진 값 일치율 80%와 `expressionType` Jaccard 20%로 계산한다. 양쪽 모두 unknown인 필드는 분모에서 제외한다. issues는 Jaccard, semantic은 pgvector cosine similarity를 0~1로 clamp한다.

- [ ] **Step 4: DB 후보 검색과 최종 정렬을 구현한다**

  SQL은 `searchable=true`, `verified_at IS NOT NULL`, `link_checked_at >= now() - interval '24 hours'`, `link_status BETWEEN 200 AND 399`, `embedding IS NOT NULL`을 모두 요구한다. semantic 상위 20건을 가져와 TS에서 facts/issues 점수를 합치고 `total DESC, decision_date DESC, id ASC`로 안정 정렬한다.

- [ ] **Step 5: 55점·3/5건 정책을 구현한다**

  `search(facts, {expanded:false})`는 최상위가 55 미만이면 `[]`, 아니면 3건을 반환한다. `{expanded:true}`일 때만 최대 5건을 반환한다. DB 전체 판례 수가 아니라 이 쿼리에서 실제 비교한 verified 후보 수를 `coverage.comparedCount`로 반환한다.

- [ ] **Step 6: 검증하고 커밋한다**

  Run: `pnpm test tests/unit/similarity.test.ts tests/integration/retrieval.test.ts && pnpm typecheck`

  Expected: 45/45/10 산식, 55 임계값, top 3/5, outcome 불변 테스트 PASS.

  ```bash
  git add src/lib/retrieval tests/unit/similarity.test.ts tests/integration/retrieval.test.ts
  git commit -m "feat: rank verified precedents by factual similarity"
  ```

### Task 9: 동일 판례 문단에만 근거를 둔 요약과 결과 조립을 구현한다

**Files:**
- Create: `src/lib/summaries/grounded-summarizer.ts`
- Create: `src/lib/results/assemble-results.ts`
- Create: `tests/unit/grounded-summarizer.test.ts`
- Create: `tests/unit/assemble-results.test.ts`

- [ ] **Step 1: 환각 방지 실패 테스트를 작성한다**

  다음 입력을 각각 거부해야 한다.

  - 저장소에 없는 사건번호·URL을 AI 응답에 포함.
  - 판례 A summary가 판례 B paragraph ID를 참조.
  - 존재하지 않는 paragraph ID 참조.
  - 근거 문단 없이 summary text만 반환.

  거부 결과는 판례 카드 자체 삭제가 아니라 `summary:null`이며, 사건번호와 URL은 저장소의 값 그대로 남아야 한다.

- [ ] **Step 2: 실패를 확인한다**

  Run: `pnpm test tests/unit/grounded-summarizer.test.ts tests/unit/assemble-results.test.ts`

  Expected: summary/result modules가 없어 FAIL.

- [ ] **Step 3: 요약 입력과 출력을 최소화한다**

  AI에는 검증된 한 판례의 `[{paragraphId,text}]`와 사용자 중립 요약만 전달하고 아래 타입만 받는다.

  ```ts
  type SummaryDraft = {
    sentences: Array<{ text: string; paragraphIds: string[] }>;
  };
  ```

  사건번호, 법원, 날짜, URL 필드는 AI schema에 존재하지 않는다. 문장마다 paragraph ID 1개 이상, 모든 ID가 현재 precedent에 소속되어야 한다. 하나라도 어기면 전체 요약을 `null`로 만든다.

- [ ] **Step 4: 닮은 점·다른 점을 태그에서 결정론적으로 만든다**

  `medium`, `relationship`, `context`, `reachedRecipient`, `repetition`, `expressionType`의 일치/불일치를 한국어 label map으로 변환한다. unknown은 설명에서 제외한다. 각각 최대 4개이며 AI 자유 텍스트를 쓰지 않는다.

- [ ] **Step 5: 결과 assembler를 fail-closed로 구현한다**

  assembler는 검색 결과 ID를 받아 repository에서 다시 verified record를 로드한다. 검색 시점 이후 `searchable=false`가 된 레코드는 제외한다. 최종 `caseNumber`, `officialUrl`, `court`, `decisionDate`는 repository object에서만 복사한다.

- [ ] **Step 6: 검증하고 커밋한다**

  Run: `pnpm test tests/unit/grounded-summarizer.test.ts tests/unit/assemble-results.test.ts && pnpm typecheck`

  Expected: 교차 판례 근거 0건 통과, 생성 사건번호 0건 노출, 근거 실패 시 link-only 결과 PASS.

  ```bash
  git add src/lib/summaries src/lib/results tests/unit/grounded-summarizer.test.ts tests/unit/assemble-results.test.ts
  git commit -m "feat: ground every precedent summary in source paragraphs"
  ```

### Task 10: 검색 API와 결과 화면을 끝까지 연결한다

**Files:**
- Create: `src/app/api/analysis/[sessionId]/search/route.ts`
- Create: `src/app/analysis/[sessionId]/page.tsx`
- Create: `src/components/search-coverage.tsx`
- Create: `src/components/precedent-card.tsx`
- Create: `src/components/result-empty-state.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/integration/search-route.test.ts`
- Create: `tests/unit/precedent-card.test.tsx`

- [ ] **Step 1: API와 금지 표현 실패 테스트를 작성한다**

  verified fixture 2건과 invalid fixture 1건을 검색하면 2건 이하만 반환되고 invalid case number는 JSON에 없어야 한다. 결과 component DOM에는 `사실관계 유사도`, `공식 원문 보기`, `비교한 판례`가 있고 금지 표현은 없어야 한다.

- [ ] **Step 2: 실패를 확인한다**

  Run: `pnpm test tests/integration/search-route.test.ts tests/unit/precedent-card.test.tsx`

  Expected: route/components가 없어 FAIL.

- [ ] **Step 3: search route의 순서를 고정한다**

  route는 `세션 조회 → confirmed facts 확인 → embedding 생성 → hybrid search → source 재검증 → grounded summary → response 조립 → 세션 삭제 요청` 순서만 허용한다. 삭제 요청 실패 시 결과에 `deletionStatus:"retrying"`을 넣고 운영 경고를 기록하되 TTL은 유지한다.

- [ ] **Step 4: 결과 화면을 구현한다**

  상단에는 `이 결과는 법적 판단이나 가능성 예측이 아닙니다` 고정 고지를 둔다. coverage에는 제공기관별 비교 건수와 마지막 검증일을 표시한다. 카드에는 총점과 45/45/10 설명, 닮은 점, 다른 점, 근거 요약, 법원·사건번호·선고일, `target="_blank" rel="noopener noreferrer"` 공식 링크를 둔다.

- [ ] **Step 5: 빈 결과와 인쇄를 구현한다**

  후보 없음, 검증 전부 실패, 55 미만을 같은 안전한 빈 결과 구조로 처리하되 사유 코드만 다르게 둔다. 화면에는 `현재 검증된 데이터에서 확인된 유사 판례가 없습니다`와 실제 coverage를 표시한다. `결과 인쇄/PDF 저장` 버튼은 `window.print()`만 호출하고 서버 PDF를 만들지 않는다. print CSS에서 sidebar와 버튼을 숨긴다.

- [ ] **Step 6: 검증하고 커밋한다**

  Run: `pnpm test tests/integration/search-route.test.ts tests/unit/precedent-card.test.tsx && pnpm typecheck && pnpm build`

  Expected: invalid 판례 노출 0, 빈 결과 강제, build 성공.

  ```bash
  git add src/app/api/analysis src/app/analysis src/components src/app/globals.css tests/integration/search-route.test.ts tests/unit/precedent-card.test.tsx
  git commit -m "feat: deliver verified precedent results and empty states"
  ```

### Task 11: 국가법령정보 공동활용 API 어댑터를 승인 전 안전하게 준비한다

**Files:**
- Create: `src/lib/precedents/law-open-data-source.ts`
- Create: `scripts/sync-law-open-data.ts`
- Create: `data/fixtures/law-open-data/list.xml`
- Create: `data/fixtures/law-open-data/detail.xml`
- Create: `tests/integration/law-open-data.test.ts`
- Create: `docs/data-sources/law-open-data.md`

- [ ] **Step 1: fixture parser 실패 테스트를 작성한다**

  공식 문서 형식에서 provider ID, 법원, 사건번호, 사건명, 선고일, 원문과 문단을 추출하고, 필수 필드가 빠진 XML은 reject해야 한다. live client가 timeout을 내도 기존 verified DB 레코드 수·해시·`searchable` 상태가 바뀌지 않고 `LAW_API_UNAVAILABLE`만 반환하는 테스트를 함께 쓴다. 이 테스트는 네트워크를 호출하지 않는다.

- [ ] **Step 2: 실패를 확인한다**

  Run: `pnpm test tests/integration/law-open-data.test.ts`

  Expected: adapter가 없어 FAIL.

- [ ] **Step 3: 승인 상태를 강제하는 adapter를 구현한다**

  `LAW_OPEN_DATA_OC`가 비어 있으면 live fetch가 `LAW_OPEN_DATA_APPROVAL_REQUIRED`를 던지게 한다. 목록과 본문 호출은 `https://www.law.go.kr/DRF/lawSearch.do` 및 `https://www.law.go.kr/DRF/lawService.do` 계열을 env의 승인 식별자 `OC`와 `target=prec`로 호출하되, endpoint·parameter는 실제 승인 화면의 최신 판례 API 가이드와 대조한 뒤 fixture를 갱신한다. 응답 원문은 SHA-256을 계산하고 검증 전 `searchable=false`로 저장한다.

- [ ] **Step 4: 동기화 CLI를 구현한다**

  CLI는 `통신매체이용음란`, 관련 법 조문 키워드로 후보만 수집하고 자동 공개하지 않는다. 신규/변경/삭제 후보 건수와 provider ID만 출력한다. API timeout·5xx·invalid XML에서는 트랜잭션을 rollback하여 마지막 verified local index를 그대로 유지한다. 사용자 검색 경로는 이 sync API를 실시간 호출하지 않고 항상 local index만 읽으며, 결과 화면에는 마지막 성공 검증일을 표시한다. 이어서 관리자가 메타데이터·본문·공식 URL을 확인하고 `pnpm db:verify-links`를 실행해야 검색 상태가 된다.

- [ ] **Step 5: 이용 승인과 출처 표기 runbook을 작성한다**

  문서에 `회원가입 → OPEN API 활용 신청 → 승인 확인 → OC 발급 → 개발 fixture 확인 → 운영 등록 및 출처 표시` 순서를 적고, 결과 화면 출처 문구를 `국가법령정보센터 제공, 마지막 검증 YYYY-MM-DD`로 고정한다.

- [ ] **Step 6: 검증하고 커밋한다**

  Run: `env -u LAW_OPEN_DATA_OC pnpm test tests/integration/law-open-data.test.ts && pnpm typecheck`

  Expected: fixture parsing PASS, 무승인 live call 차단 PASS, API 장애 시 기존 verified index 보존 PASS.

  ```bash
  git add src/lib/precedents/law-open-data-source.ts scripts/sync-law-open-data.ts data/fixtures/law-open-data tests/integration/law-open-data.test.ts docs/data-sources/law-open-data.md
  git commit -m "feat: add approval-gated law open data adapter"
  ```

### Task 12: 실제 검증 판례 30~50건을 구축하고 검색 품질 세트를 만든다

**Files:**
- Modify: `data/curated/precedents.json`
- Create: `tests/quality/retrieval-cases.json`
- Create: `tests/quality/retrieval-quality.test.ts`
- Create: `docs/data-sources/curation-log.md`

- [ ] **Step 1: import acceptance test를 30건 미만에서 실패하게 만든다**

  quality test는 production curated JSON에 30~50건이 있고, provider ID·법원·사건번호·선고일·공식 URL·본문·해시·문단·facts가 모두 존재하며 중복 사건이 0건인지 검사한다. import 후 DB의 각 검색 가능 레코드에는 `text-embedding-3-small`의 1,536차원 embedding이 있어야 한다.

- [ ] **Step 2: 실패를 확인한다**

  Run: `pnpm test tests/quality/retrieval-quality.test.ts`

  Expected: curated dataset이 0건이므로 FAIL.

- [ ] **Step 3: 공식 판례를 5건씩 수집·이중 확인한다**

  국가법령정보센터의 공개 판례에서 통신매체이용음란 관련 판례를 5건 단위로 추가한다. 각 batch마다 다음 체크를 모두 기록한다.

  - 공식 원문 페이지에서 사건번호·법원·선고일을 눈으로 대조.
  - provider record ID와 공식 URL 저장.
  - 원문을 문단별로 나누어 `p001`부터 안정 ID 부여.
  - SHA-256 생성.
  - 판결 결과·형량을 제외한 사실 태그와 중립 요약 작성.
  - 담당자 1차 입력과 별도 2차 검토 날짜를 curation log에 기록.

  각 batch 후 Run: `pnpm db:import-curated && pnpm db:verify-links && pnpm test tests/integration/curated-import.test.ts`

  Expected: 누적 검색 가능 건수가 5씩 증가하며 검증 실패 건은 증가하지 않는다.

- [ ] **Step 4: 공개 판례 기반 합성 검색 사례 20~30개를 만든다**

  사례에는 실명·연락처를 넣지 않고 `queryFacts`, `expectedPrecedentIds`, `derivationSourceUrl`만 둔다. 유죄/무죄 결론을 질문이나 기대값으로 사용하지 않는다. 한 판례에서 표현·매체·관계 중 일부를 바꾼 near/far pair를 포함한다.

- [ ] **Step 5: top-3 품질 게이트를 구현하고 통과시킨다**

  ```ts
  const hitRate = cases.filter((c) => top3(c).some((r) => c.expectedPrecedentIds.includes(r.id))).length / cases.length;
  expect(hitRate).toBeGreaterThanOrEqual(0.9);
  ```

  실패 시 임계값을 낮춰 억지로 통과시키지 않는다. facts tag 오류, paragraph 분할, neutral summary, embedding 입력을 먼저 교정하고, 가중치를 바꾸면 변경 이유와 전후 hit rate를 curation log에 기록한다.

- [ ] **Step 6: 전체 데이터 품질을 검증하고 커밋한다**

  Run: `pnpm test tests/quality/retrieval-quality.test.ts tests/integration/curated-import.test.ts && pnpm db:verify-links`

  Expected: 실제 판례 30~50건, 공식 링크 검증 100%, top-3 hit rate 90% 이상.

  ```bash
  git add data/curated/precedents.json tests/quality docs/data-sources/curation-log.md
  git commit -m "data: curate verified tongmaeeum precedent corpus"
  ```

### Task 13: 법원 판결서 인터넷열람 확장 경계와 수동 검증 경로를 만든다

**Files:**
- Create: `src/lib/precedents/court-judgment-source.ts`
- Create: `src/lib/precedents/verified-manual-source.ts`
- Create: `tests/unit/court-judgment-source.test.ts`
- Create: `docs/data-sources/court-judgment-internet-access.md`

- [ ] **Step 1: 무허가 자동 수집 차단 실패 테스트를 작성한다**

  `CourtJudgmentSource.listCandidates()`와 `fetchRecord()`가 설정과 무관하게 `COURT_SOURCE_NOT_AUTHORIZED`를 던지고 네트워크 fetch를 한 번도 호출하지 않는지 검사한다.

- [ ] **Step 2: 실패를 확인한다**

  Run: `pnpm test tests/unit/court-judgment-source.test.ts`

  Expected: source module이 없어 FAIL.

- [ ] **Step 3: 명시적으로 비활성화된 adapter seam을 구현한다**

  ```ts
  export class CourtJudgmentSource implements PrecedentSourceAdapter {
    readonly provider = "court_judgment" as const;
    async listCandidates(): Promise<never> { throw new Error("COURT_SOURCE_NOT_AUTHORIZED"); }
    async fetchRecord(): Promise<never> { throw new Error("COURT_SOURCE_NOT_AUTHORIZED"); }
  }
  ```

  향후 공식 API·계약·명시적 허가 문서 ID가 코드 리뷰에 첨부된 별도 변경에서만 이 클래스를 교체한다.

- [ ] **Step 4: 합법 취득 문서용 수동 import를 구현한다**

  `VerifiedManualSource`는 관리자 로컬 JSON과 원문 파일만 읽고, 취득 근거 문서 ID, 검토자, 검토일, 법원·사건번호·선고일·원문 URL/열람 식별자, 본문 해시가 없으면 거부한다. 자동 로그인, 결제 자동화, HTML crawling 코드는 포함하지 않는다.

- [ ] **Step 5: 사전 조사 체크리스트를 문서화한다**

  문서에는 이용조건, 건별 수수료, 비실명 처리, 열람 제한, 원문 재저장, 요약 제공, 딥링크, 대량 이용, 삭제·정정 대응을 조사하고 법원/기관 회신을 보관하는 절차를 적는다. 허가 전 상태는 `차단됨`으로 명시한다.

- [ ] **Step 6: 검증하고 커밋한다**

  Run: `pnpm test tests/unit/court-judgment-source.test.ts && pnpm typecheck`

  Expected: 무허가 fetch 호출 0회, 불완전 manual record 거부.

  ```bash
  git add src/lib/precedents/court-judgment-source.ts src/lib/precedents/verified-manual-source.ts tests/unit/court-judgment-source.test.ts docs/data-sources/court-judgment-internet-access.md
  git commit -m "feat: reserve authorized court judgment source boundary"
  ```

### Task 14: 전체 흐름·삭제·환각 방지 E2E와 운영 점검을 완성한다

**Files:**
- Create: `tests/e2e/analysis-flow.spec.ts`
- Create: `tests/e2e/no-match-flow.spec.ts`
- Create: `tests/e2e/privacy-flow.spec.ts`
- Create: `docs/operations/incident-checklist.md`
- Create: `docs/research/prototype-test-script.md`
- Modify: `playwright.config.ts`

- [ ] **Step 1: 실패하는 E2E 시나리오를 작성한다**

  1. 피해자 역할 → 합성 서술 → 합성 캡처 → OCR 수정 → 질문 3개 이하 → 사례 확인 → verified 판례 카드 → 공식 원문 링크.
  2. 피신고인 역할 → 55 미만 → 판례 카드 0개와 coverage 표시.
  3. 저장소 밖 가짜 사건번호를 AI fixture에 섞어도 DOM에 0회.
  4. 결과 응답 뒤 session read가 404이고 임시 파일이 없다.

- [ ] **Step 2: 실패를 확인한다**

  Run: `pnpm test:e2e`

  Expected: 미연결 흐름 또는 selector로 FAIL.

- [ ] **Step 3: 접근성·반응형·인쇄 회귀를 보완한다**

  키보드만으로 역할 선택부터 원문 링크까지 이동 가능하게 하고 모든 form control에 label을 둔다. 390×844와 1440×900 viewport에서 가로 스크롤이 없어야 한다. print media에서 입력 원문과 내비게이션을 숨긴다.

- [ ] **Step 4: 운영 실패 체크리스트를 작성한다**

  오류 코드를 `OCR_FAILED`, `FACTS_INVALID`, `SOURCE_INVALID`, `SUMMARY_UNGROUNDED`, `DELETE_RETRYING`, `LAW_API_UNAVAILABLE`로 고정한다. 로그 허용 필드는 error code, duration bucket, file-size bucket, provider, compared count뿐이다. 원문·OCR·AI prompt·사건 설명이 로그에 들어오면 출시 차단이다.

- [ ] **Step 5: 5~10명 비공개 테스트 스크립트를 작성한다**

  참가자에게 합성 사례만 주고 다음 질문을 같은 순서로 한다.

  1. 화면의 숫자가 무엇을 뜻한다고 이해했는가?
  2. 첫 판례의 닮은 점과 다른 점을 하나씩 말해달라.
  3. 공식 원문을 열어달라.
  4. 이 결과가 고소·유죄 가능성을 말한다고 느낀 문구가 있었는가?

  성공 기준은 유사도/법적 가능성 구분 80%, 닮은·다른 점 설명 80%, 원문 버튼 발견 100%다. 피드백에는 입력 사건 내용이나 캡처를 기록하지 않고 화면·문구·이해도만 기록한다.

- [ ] **Step 6: 최종 검증을 실행한다**

  Run:

  ```bash
  pnpm lint
  pnpm typecheck
  pnpm test
  pnpm build
  pnpm test:e2e
  pnpm db:verify-links
  pnpm privacy:purge
  ```

  Expected: 전부 exit 0, 공식 링크 검증 100%, top-3 품질 90% 이상, 생성 사건번호 0건, 1시간 TTL 테스트 100% PASS.

- [ ] **Step 7: 커밋한다**

  ```bash
  git add tests/e2e playwright.config.ts docs/operations/incident-checklist.md docs/research/prototype-test-script.md
  git commit -m "test: verify private precedent analysis prototype end to end"
  ```

---

## 3. Release Gates

비공개 프로토타입 테스트를 시작하려면 다음을 모두 만족해야 한다.

- [ ] production curated dataset이 30~50건이며 모든 판례가 공식 URL·원문 해시·검증 시각을 가진다.
- [ ] 표시되는 사건번호·법원·날짜·URL의 source가 repository뿐임을 unit test로 증명한다.
- [ ] 모든 요약 문장이 동일 판례 paragraph ID 1개 이상을 가지며 실패 시 summary가 숨겨진다.
- [ ] 고정 합성 사례 top-3 hit rate가 90% 이상이다.
- [ ] 55 미만, source invalid, API 장애에서 판례를 생성하지 않고 coverage 포함 empty state를 보인다.
- [ ] 분석 완료 즉시 삭제와 1시간 purge가 integration/E2E에서 모두 통과한다.
- [ ] 금지 표현 전체 검색 결과가 0건이다: `rg -n "성립 확률|고소 확률|유죄 확률|무죄 가능성|처벌 예상" src tests/e2e`.
- [ ] API/운영 로그에 사용자 원문·OCR·prompt가 남지 않는다.
- [ ] 국가법령정보 공동활용 승인과 출처 표시가 확인되거나, 승인 전에는 curated data만 사용한다.
- [ ] 법원 판결서 인터넷열람 adapter의 live network 호출은 0회다.

## 4. Deferred Until After User Feedback

다음 항목은 첫 5~10명 테스트 결과를 보기 전에는 구현하지 않는다.

- 일반 AI 검색 대비 우월성 벤치마크와 마케팅 문구.
- 신고·고소 절차 안내, 고소장·진술서 생성.
- 유무죄·형량·처벌 예측.
- 회원가입, 사건 이력, 결과 서버 저장.
- 변호사 연결과 의뢰 전환.
- 공개 베타와 검색엔진 노출.
- 허가되지 않은 법원 판결서 자동 수집.

## 5. Verified Primary References

- [Next.js App Router 설치](https://nextjs.org/docs/app/getting-started/installation)
- [Playwright 설치](https://playwright.dev/docs/intro)
- [pgvector](https://github.com/pgvector/pgvector)
- [OpenAI Responses API 이미지 입력](https://platform.openai.com/docs/quickstart/make-your-first-api-request)
- [OpenAI API 데이터 제어](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
- [국가법령정보 공동활용 판례 API](https://open.law.go.kr/LSO/openApi/guideList.do)
- [국가법령정보 공동활용 이용·출처 정책](https://open.law.go.kr/LSO/information/guide.do)
- [공공데이터포털 판례 본문 API](https://www.data.go.kr/data/15057123/openapi.do)
- [법원 판결서 인터넷열람 안내](https://www.scourt.go.kr/portal/information/finalruling/guide/guide_02.jsp)
- [법원 판결서 열람 제한 안내](https://www.scourt.go.kr/portal/information/finalruling/guide/guide_01.jsp)
