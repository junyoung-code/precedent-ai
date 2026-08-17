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
npm run tags:backfill
npm run embeddings:backfill
npm run intake:purge
```

`.env.local`에는 승인받은 `LAW_OPEN_DATA_OC`와 `DATABASE_URL`을 넣습니다. 2C 임베딩을 생성할 때만 `OPENAI_API_KEY`를 추가합니다. 이 파일은 Git에 포함되지 않습니다.

사례 입력 세션은 이미지 원본 없이 가려진 텍스트만 최대 1시간 저장합니다. 검색 완료·취소 시 즉시 삭제하며, 플랫폼 스케줄러 또는 cron에서 `npm run intake:purge`를 매시간 이하 간격으로 실행해 중단된 세션도 정리합니다.

## 저장 규칙

- API 상세 응답 원본과 SHA-256 해시를 저장합니다.
- 같은 법원·사건번호·선고일은 하나의 canonical 판례로 병합합니다.
- 서로 다른 공식 레코드 ID는 `precedent_sources`에 모두 보존합니다.
- 수집 직후에는 항상 `searchable=false`, `verified_at=null`입니다.
- API 오류나 잘못된 레코드가 하나라도 발생하면 해당 동기화의 판례 변경을 전부 롤백합니다.
- 검증 명령은 공식 URL, 필수 메타데이터, 원문 해시와 문단을 검사하고 이력을 남깁니다.
- 기술 검증에 성공해도 `source_rights`의 저장·색인·요약·표시 허용이 모두 확인되지 않으면 `searchable=false`를 유지합니다.
- 기술 검증을 통과한 판례는 결정론적 사실 태그를 같은 검증 트랜잭션에서 저장합니다.
- 기존 검증 판례는 `npm run tags:backfill`로 태그를 다시 생성할 수 있습니다.

## 공동활용 권리 검토 기록

공동활용 신청이 승인된 것을 확인한 운영자만 `npm run rights:law -- --confirm-approved`를 실행합니다. 근거는 국가법령정보 공동활용의 [공식 이용안내](https://open.law.go.kr/LSO/information/guide.do)로 기록합니다.

저장·검색 색인·가공 요약·서비스 화면 표시는 허용 상태로 두되, 원문 데이터 자체의 재배포는 별도 허가가 확인되지 않았으므로 차단합니다. 인증값은 권리 레코드나 로그에 저장하지 않습니다.

## 2C 임베딩 생성과 검색

판례 벡터는 사용자 검색 요청과 분리된 운영 명령으로 미리 생성합니다.

```bash
OPENAI_API_KEY=... npm run embeddings:backfill
```

백필은 `searchable=true`이고 검증·공식 링크 확인을 통과한 판례만 처리합니다. 모델명, 판례 원문 해시, 판결 결과 문장을 제외한 임베딩 입력 해시와 생성 시각을 함께 저장하므로 변경되지 않은 판례는 다시 호출하지 않습니다.

사용자 입력의 의미 검색은 기본적으로 꺼져 있습니다. 개인정보 처리 안내와 운영 정책을 확인한 뒤 서버 환경에서 다음 값을 설정해야 활성화됩니다.

```dotenv
EMBEDDING_SEARCH_ENABLED=true
OPENAI_API_KEY=...
EMBEDDING_MODEL=text-embedding-3-small
```

활성화하면 최근 24시간 안에 공식 링크를 다시 확인했고 임베딩이 있는 판례 중 의미 유사도 상위 20건을 비교합니다. 최종 점수는 의미 45%, 중립 사실 태그 45%, 쟁점 태그 10%이며 55점 미만은 반환하지 않습니다. 외부 임베딩 호출이 실패하면 응답의 `scoring.status`를 `fallback_without_embeddings`로 표시하고 2B 검색으로 돌아갑니다.

## 현재 단계

권리 검토 기록과 기술 검증을 모두 통과한 판례만 `searchable=true`가 됩니다. 2B 단계에서는 전달 매체, 표현 형태, 상대방 특정 방식, 도달 여부, 관계, 맥락, 표현 유형, 반복 여부와 쟁점 태그를 저장합니다. 태그에는 유무죄·고소 가능성·처벌 같은 판단 필드가 없습니다.

## 로컬 키워드 검색 API

```bash
npm run api
```

`POST http://127.0.0.1:8787/api/search`에 다음 JSON을 보냅니다.

```json
{ "query": "게임 채팅", "limit": 3 }
```

검색은 외부 API를 호출하지 않고 로컬 PostgreSQL의 `searchable=true` 판례만 비교합니다. 키워드 또는 알려진 사실 태그가 일치하는 후보를 최대 50건 비교한 뒤 최대 5건을 반환합니다. 사건번호·법원·선고일·공식 원문 URL은 검증된 DB 필드를 그대로 사용합니다.

응답에는 다음 구분값이 포함됩니다.

- `availableCount`: 검색 가능한 전체 검증 판례 수
- `comparedCount`: 이번 요청에서 실제 태그 점수를 계산한 후보 수
- `queryFacts`: 사용자 설명에서 추출한 중립 사실 태그
- `tagScore`: 알려진 사실 필드의 일치율
- `issueScore`: 쟁점 태그 Jaccard 점수
- `matchedFacts`, `differentFacts`: 점수 근거가 된 필드
- `retrievalScore`: 임베딩 도입 전의 임시 검색 정렬 점수

임베딩 검색이 비활성화된 경우 `retrievalScore`는 키워드 45%, 사실 태그 45%, 쟁점 태그 10%입니다. 활성화된 2C 검색은 키워드 신호를 의미 유사도로 교체합니다. 어느 점수도 법적 가능성이나 최종 사실관계 유사도를 뜻하지 않습니다.

## 임시 입력 세션 삭제 예약

사용자 사례는 검색이 끝나는 즉시 삭제됩니다. 성공·실패 어느 쪽이든 삭제하며, 취소·새 사례·페이지 이탈에서도 브라우저가 삭제를 요청합니다.

그래도 남는 경우가 있습니다. 삭제 요청이 유실되거나 브라우저가 비정상 종료되면 세션이 만료 시각까지 남습니다. 이때를 위해 `intake_sessions`는 `expires_at = created_at + 1 hour` 제약을 갖고, 정리 명령이 백스톱이 됩니다.

```bash
npm run intake:purge
```

이 명령은 **예약해서 돌려야 합니다.** 수동 실행에만 의존하면 중단된 입력이 쌓입니다. 실행 간격은 1시간 이하로 잡습니다.

윈도우 개발 환경 예시 (30분 간격):

```powershell
$action = New-ScheduledTaskAction -Execute "C:\Program Files\nodejs\npm.cmd" `
  -Argument "run intake:purge" -WorkingDirectory "C:\precedent-ai\prototype"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
  -RepetitionInterval (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName "PrecedentAI-IntakePurge" -Action $action -Trigger $trigger -Force
```

배포 환경에서는 플랫폼의 cron 또는 scheduler를 사용합니다.

정리 명령의 stdout은 `{"deleted": N}`뿐입니다. 세션 내용, 역할, 세션 ID를 출력하지 않으므로 로그에 사례 텍스트가 남지 않습니다. 실패 알림과 재실행 정책은 배포 시점에 정합니다.
