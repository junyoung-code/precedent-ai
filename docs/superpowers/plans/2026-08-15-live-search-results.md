# 실제 DB 검색 결과 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 결과 디자인을 유지하면서 프론트엔드가 실제 `/api/search` 결과만 표시하게 한다.

**Architecture:** 브라우저는 같은 주소의 `/api/search`만 호출하고 Vite 개발 서버가 로컬 API `127.0.0.1:8787`로 프록시한다. 응답은 별도 adapter에서 필수 공식 메타데이터를 검증하고 UI 모델로 변환하며, 검증 실패·통신 실패·빈 결과에서는 어떤 판례도 만들어내지 않는다.

**Tech Stack:** React 19, Vite 6, Node test runner, 기존 Node HTTP 검색 API

## Global Constraints

- 유무죄·고소 가능성·처벌 가능성을 표시하지 않는다.
- 사건번호·법원·선고일·공식 URL은 검색 API의 검증된 DB 값만 사용한다.
- 서버가 제공하지 않은 판례 요약은 만들거나 정적 fixture에서 보충하지 않는다.
- 역할 선택은 검색 순위에 영향을 주지 않는다.

---

### Task 1: 검색 응답 adapter

**Files:**
- Create: `prototype/src/lib/search-api.js`
- Create: `prototype/tests/search-client.test.mjs`

**Interfaces:**
- Consumes: `POST /api/search` 응답
- Produces: `searchSimilarPrecedents({query, limit, fetchImpl})`

- [x] 잘못된 공식 URL·필수 메타데이터·응답 형식을 제거하는 테스트를 작성한다.
- [x] `/api/search` 호출과 45/45/10 UI 모델 변환을 구현한다.
- [x] 닮은 점·다른 점은 API의 `matchedFacts`, `differentFacts`만 한국어 label로 변환한다.
- [x] 서버가 보내지 않은 summary는 `null`로 유지한다.

### Task 2: 실제 결과 화면 연결

**Files:**
- Modify: `prototype/src/App.jsx`
- Modify: `prototype/src/styles.css`
- Modify: `prototype/vite.config.js`
- Modify: `prototype/tests/ui-copy.test.mjs`

**Interfaces:**
- Consumes: `searchSimilarPrecedents()`
- Produces: loading, results, empty, error UI

- [x] `rankPrecedents`와 정적 판례 개수를 화면 경로에서 제거한다.
- [x] submit을 async API 호출로 바꾸고 중복 submit을 막는다.
- [x] coverage에 `availableCount`, `comparedCount`, 검색 방식을 표시한다.
- [x] 요약이 없으면 AI 요약 영역 자체를 숨긴다.
- [x] 실패 시 `검색 서버에 연결하지 못했습니다`를 표시하고 재시도를 제공한다.
- [x] 외부 임베딩은 기본 미동의로 두고, 명시 동의된 요청에서만 입력을 전송한다.
- [x] 미동의 검색은 로컬 키워드·사실 태그 검색으로 계속 제공한다.
- [x] 통매음 MVP 검색을 통신매체이용음란 판례 범위로 제한한다.
- [x] Vite `/api` proxy를 `127.0.0.1:8787`에 연결한다.

### Task 3: 검증

- [x] `npm test` 전체 통과
- [x] `npm run build` 통과
- [x] 로컬 브라우저에서 입력 → 검색 → 실제 DB 결과와 공식 원문 링크 확인
