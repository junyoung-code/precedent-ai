# 국가법령정보센터 판례 동기화

사용자 검색 요청은 외부 API를 호출하지 않습니다. 이 명령은 운영자가 정기적으로 실행해 판례 원본을 내부 PostgreSQL에 저장하는 용도입니다.

## 로컬 실행

```bash
cp .env.example .env.local
npm run db:up
npm run db:migrate
SYNC_LIMIT=3 npm run sync:law
npm run rights:law -- --confirm-approved
npm run verify:sources
```

`.env.local`에는 승인받은 `LAW_OPEN_DATA_OC`와 `DATABASE_URL`을 넣습니다. 이 파일은 Git에 포함되지 않습니다.

## 저장 규칙

- API 상세 응답 원본과 SHA-256 해시를 저장합니다.
- 같은 법원·사건번호·선고일은 하나의 canonical 판례로 병합합니다.
- 서로 다른 공식 레코드 ID는 `precedent_sources`에 모두 보존합니다.
- 수집 직후에는 항상 `searchable=false`, `verified_at=null`입니다.
- API 오류나 잘못된 레코드가 하나라도 발생하면 해당 동기화의 판례 변경을 전부 롤백합니다.
- 검증 명령은 공식 URL, 필수 메타데이터, 원문 해시와 문단을 검사하고 이력을 남깁니다.
- 기술 검증에 성공해도 `source_rights`의 저장·색인·요약·표시 허용이 모두 확인되지 않으면 `searchable=false`를 유지합니다.

## 공동활용 권리 검토 기록

공동활용 신청이 승인된 것을 확인한 운영자만 `npm run rights:law -- --confirm-approved`를 실행합니다. 근거는 국가법령정보 공동활용의 [공식 이용안내](https://open.law.go.kr/LSO/information/guide.do)로 기록합니다.

저장·검색 색인·가공 요약·서비스 화면 표시는 허용 상태로 두되, 원문 데이터 자체의 재배포는 별도 허가가 확인되지 않았으므로 차단합니다. 인증값은 권리 레코드나 로그에 저장하지 않습니다.

## 현재 다음 단계

권리 검토 기록과 기술 검증을 모두 통과한 판례만 `searchable=true`가 됩니다.

## 로컬 키워드 검색 API

```bash
npm run api
```

`POST http://127.0.0.1:8787/api/search`에 다음 JSON을 보냅니다.

```json
{ "query": "게임 채팅", "limit": 3 }
```

검색은 외부 API를 호출하지 않고 로컬 PostgreSQL의 `searchable=true` 판례만 비교합니다. 결과는 최대 5건이며 사건번호·법원·선고일·공식 원문 URL은 검증된 DB 필드를 그대로 반환합니다. 현재 단계는 키워드 검색 기준선이며, 다음 구현은 사실관계 태그를 추가하는 단계입니다.
