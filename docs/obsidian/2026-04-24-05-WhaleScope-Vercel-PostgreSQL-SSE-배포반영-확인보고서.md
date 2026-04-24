---
type: verification-report
date: 2026-04-24
seq: "05"
status: verified-with-follow-up-patch
tags:
  - WhaleScope
  - vercel
  - postgresql
  - sse
  - deployment-verification
related:
  - 2026-04-24-04-WhaleScope-PostgreSQL전환-개선계획-RenderCron유지.md
  - 2026-04-24-03-WhaleScope-Sheets-10M복구-검증리포트.md
---

# WhaleScope Vercel PostgreSQL/SSE 배포 반영 확인 보고서

## 1. 확인 대상

- 배포 주소: https://whalescope.6esk.com
- 확인 시각: 2026-04-24 13:04~13:05 KST
- 직전 수정 커밋: `b3ed907 fix: include pg in vercel bundle`
- 확인 목적:
  - Vercel 런타임에서 `pg` 패키지 누락 오류가 사라졌는지 확인
  - `/api/stream` SSE가 60초 Vercel timeout 전에 정상 종료되는지 확인
  - 운영 대시보드가 PostgreSQL backend를 실제로 읽는지 확인

## 2. 원격 URL 확인 결과

| 경로 | HTTP | 확인 결과 |
|---|---:|---|
| `/` | 200 | 사용자 홈 SSR 응답 정상 |
| `/admin` | 200 | 운영 대시보드 SSR 응답 정상 |
| `/api/news` | 200 | `source: news_feed`, `lastUpdatedAt: 2026-04-24T04:00:36.877Z` 반환 |
| `/api/dashboard` | 200 | `source: postgres` 반환 |
| `/api/admin/health` | 200 | `source: postgres`, `opsSummary.status: healthy` 반환 |
| `/api/stream` | 200 | `content-type: text/event-stream`, `status.state: enabled`, heartbeat 수신 |

## 3. 핵심 증빙

### 3.1 PostgreSQL backend 반영

`/api/dashboard` 응답에서 다음을 확인했다.

```json
{
  "source": "postgres",
  "adminObservability": {
    "liveUpdates": {
      "enabled": true,
      "configured": true,
      "state": "enabled"
    }
  }
}
```

이는 Vercel 서버 함수가 `apps/dashboard/lib/postgres.ts`의 `pg` 기반 PostgreSQL read path를 실제로 실행했다는 의미다. 기존 오류였던 `Cannot find package 'pg'`가 발생했다면 `/api/dashboard`는 정상 JSON을 반환하지 못한다.

### 3.2 News feed 반영

`/api/news` 응답에서 `news_feed` 우선 경로가 정상 동작했다.

```json
{
  "source": "news_feed",
  "lastUpdatedAt": "2026-04-24T04:00:36.877Z",
  "lastArticleAt": "2026-04-24T04:00:08.000Z"
}
```

### 3.3 SSE timeout 회피 반영

`/api/stream`은 200으로 열리고 heartbeat를 세 번 이상 보낸 뒤, 50초 지점에서 다음 프레임을 반환하고 종료했다.

```text
: closing-before-platform-timeout
retry: 5000
```

따라서 Vercel의 60초 runtime timeout으로 강제 종료되는 기존 경로는 해소됐다. 브라우저 `EventSource`는 `retry: 5000` 기준으로 자동 재연결한다.

## 4. 확인 중 발견한 정합성 이슈

운영 API는 `source: postgres`를 반환하지만, `sourceHealth.label`과 일부 README 문구가 기존 `Live Sheets` 중심으로 남아 있었다.

영향:

- 런타임 동작은 PostgreSQL로 정상 반영됨.
- 운영자 화면/문서에서는 데이터 원천을 Google Sheets로 오해할 수 있음.

후속 조치:

- `apps/dashboard/lib/metrics.ts`의 source health label/description을 backend-aware로 수정했다.
- README와 dashboard README를 PostgreSQL primary / Sheets legacy mirror 기준으로 업데이트했다.

## 5. QA 명령

로컬에서 다음 검증을 통과했다.

```bash
npm run dashboard:typecheck
npm run dashboard:lint
npm run dashboard:build
```

추가로 build trace에서 `node_modules/pg/**`가 포함되는 것을 확인했다. 이는 Vercel serverless bundle에 `pg`가 포함될 수 있음을 의미한다.

## 6. 최종 판정

- `pg` 누락 오류 수정: 반영 확인.
- PostgreSQL dashboard read path: 반영 확인.
- `/api/news` Postgres 기반 news feed read path: 반영 확인.
- `/api/stream` Vercel timeout 회피: 반영 확인.
- 남은 작업: 후속 라벨/문서 정합성 패치가 Vercel에 배포된 뒤 `/api/admin/health.sourceHealth.label`이 `Live Postgres`로 바뀌는지 재확인한다.

