# WhaleScope Next.js Dashboard 개발 계획

## 1. 목적

현재 WhaleScope 대시보드는 `streamlit_app.py`로 구현되어 있다. 로컬 운영 확인에는 충분하지만, 최종 제출 및 배포 관점에서는 Vercel에 올릴 수 있는 Next.js 대시보드가 더 적합하다.

이 문서는 Google Sheets를 DB로 유지하면서, 프론트 대시보드를 Next.js App Router 기반으로 재구성하기 위한 개발 계획을 정의한다.

## 2. 전제

- DB는 Google Sheets를 유지한다.
- 정보수집 파이프라인은 Render Cron Job 또는 Render Worker에서 실행한다.
- Telegram Bot과 Telegram channel listener는 Render Background Worker에서 실행한다.
- Vercel은 대시보드 UI와 dashboard API만 담당한다.
- Google service account credential은 브라우저에 절대 노출하지 않는다.
- `NEXT_PUBLIC_` 환경변수에는 공개 가능한 값만 넣는다.

## 3. 현재 구조

```text
Local / Render workers
  python -m src.main
    -> Etherscan / Solscan / CoinGecko / LLM
    -> Google Sheets
    -> Telegram daily brief

  python scripts/run_bot.py
    -> Telegram command polling
    -> Google Sheets subscribers/watchlist

  python scripts/run_listener.py
    -> Telegram public channel listener
    -> Google Sheets tg_whale_events

Local dashboard
  streamlit_app.py
    -> Google Sheets
    -> browser UI
```

## 4. 목표 구조

```text
Render
  Cron Job: python -m src.main
  Worker:   python scripts/run_bot.py
  Worker:   python scripts/run_listener.py

Google Sheets
  transactions
  daily_brief
  signals
  address_activity
  system_log
  analysis_log
  subscribers
  user_interests

Vercel / Next.js
  Server Components
    -> read dashboard data on server

  Route Handlers
    -> /api/dashboard
    -> /api/transactions
    -> /api/signals
    -> /api/system-log
    -> optional /api/pipeline/trigger

  Client Components
    -> filters
    -> charts
    -> tables
    -> refresh controls
```

핵심 원칙은 "Sheets credential을 Next.js server side에만 둔다"는 것이다. Next.js Server Components와 Route Handlers는 서버에서 실행되므로 Sheets 접근 로직과 credential을 client bundle에 포함하지 않을 수 있다.

## 5. 기술 선택

| 항목 | 선택 | 이유 |
|---|---|---|
| Framework | Next.js App Router | Vercel 배포 표준, Server Components 활용 |
| Language | TypeScript | dashboard 데이터 contract 안정성 |
| Runtime | Node.js runtime | `googleapis` 또는 `google-auth-library` 사용 |
| Styling | Tailwind CSS | 빠른 UI 구성과 Vercel 배포 적합성 |
| Chart | Recharts 또는 Tremor/Recharts | 거래량/시그널 통계 표현 |
| Table | TanStack Table 또는 직접 구현 | 필터/정렬 확장성 |
| Data source | Google Sheets | 현 MVP DB 유지 |
| Auth v1 | Dashboard password | 현재 `STREAMLIT_PASSWORD`와 유사한 단순 보호 |
| Auth v2 | Clerk 또는 Vercel 보호 기능 | 장기 운영 시 전환 |

## 6. 저장소 구조 제안

현재 repo는 Python 프로젝트가 root에 있다. Next.js 앱은 충돌을 피하기 위해 `apps/dashboard`에 둔다.

```text
apps/
  dashboard/
    app/
      layout.tsx
      page.tsx
      loading.tsx
      error.tsx
      api/
        dashboard/route.ts
        transactions/route.ts
        signals/route.ts
        system-log/route.ts
    components/
      dashboard-shell.tsx
      metric-card.tsx
      brief-panel.tsx
      transactions-table.tsx
      signals-table.tsx
      system-log-panel.tsx
      run-status-badge.tsx
    lib/
      sheets.ts
      schema.ts
      metrics.ts
      format.ts
      env.ts
    package.json
    next.config.ts
    tsconfig.json
    .env.example
```

이 구조를 쓰면 Python worker와 Next.js dashboard가 같은 repo에 있어도 의존성과 빌드 명령을 분리할 수 있다.

## 7. 환경변수 설계

Vercel dashboard에 필요한 env:

| 변수 | 공개 여부 | 설명 |
|---|---|---|
| `GOOGLE_SHEET_ID` | server-only | Spreadsheet ID |
| `GOOGLE_CREDENTIALS_JSON` | server-only | 서비스 계정 JSON |
| `DASHBOARD_PASSWORD` | server-only | 임시 dashboard 접근 비밀번호 |
| `RENDER_PIPELINE_WEBHOOK_URL` | server-only | 선택. Render job trigger용 |
| `RENDER_PIPELINE_WEBHOOK_SECRET` | server-only | 선택. trigger 인증 |
| `NEXT_PUBLIC_APP_NAME` | public 가능 | 표시용 앱 이름 |

금지:

- `NEXT_PUBLIC_GOOGLE_CREDENTIALS_JSON`
- `NEXT_PUBLIC_TELEGRAM_BOT_TOKEN`
- `NEXT_PUBLIC_GEMINI_API_KEY`
- `NEXT_PUBLIC_GROQ_API_KEY`
- `NEXT_PUBLIC_ANTHROPIC_API_KEY`

## 8. 데이터 API 설계

### 8-1. `GET /api/dashboard`

대시보드 초기 렌더링용 aggregate endpoint.

응답 예시:

```json
{
  "generatedAt": "2026-04-15T08:00:00.000Z",
  "metrics": {
    "transactionCount": 4182,
    "signalCount": 2,
    "dailyBriefCount": 1,
    "latestRunStatus": "completed_with_errors",
    "latestRunErrorCount": 1
  },
  "latestBrief": {
    "date": "2026-04-15",
    "summary": "...",
    "alertCount": 1,
    "totalVolumeUsd": 6555360
  },
  "recentSignals": [],
  "recentTransactions": [],
  "latestRun": {}
}
```

### 8-2. `GET /api/transactions`

쿼리:

- `limit`
- `symbol`
- `chain`
- `from`
- `to`

용도:

- 거래 히스토리 테이블
- token/chain 필터
- 최근 이벤트 목록

### 8-3. `GET /api/signals`

쿼리:

- `limit`
- `rule`
- `severity`
- `source`

용도:

- signal dashboard
- severity/rule별 필터

### 8-4. `GET /api/system-log`

용도:

- 최신 pipeline run 상태
- `completed`, `completed_with_errors`, `completed_empty` 표시
- 운영 장애 원인 확인

### 8-5. `POST /api/pipeline/trigger` 선택

Vercel에서 직접 Python pipeline을 실행하지 않는다. 대신 Render Cron/Worker를 트리거하는 webhook으로 위임한다.

초기 버전에서는 이 endpoint를 만들지 않는 편이 안전하다. 먼저 read-only dashboard를 완성하고, 이후 운영 액션을 붙인다.

## 9. 화면 설계

### 9-1. Overview

표시 항목:

- 최신 run status
- 오늘 거래 수
- 오늘 signal 수
- 최신 daily brief 생성 여부
- Telegram subscriber 수
- CoinGecko/LLM/Sheets error badge

목적:

- 서비스가 "살아 있는지" 즉시 판단

### 9-2. Daily Brief

표시 항목:

- 최신 브리핑 전문
- top transaction/signal cards
- total volume
- alert count
- 생성 시각

목적:

- 과제 평가자가 AI 요약/큐레이션 결과를 바로 확인

### 9-3. Transactions

표시 항목:

- timestamp
- symbol
- amount
- amount_usd
- from/to owner
- chain
- hash

기능:

- symbol filter
- chain filter
- date range
- amount sorting
- CSV download는 v2로 미룬다.

### 9-4. Signals

표시 항목:

- created_at
- rule
- severity
- score
- confidence
- source
- summary
- evidence_tx_hashes

목적:

- LLM 이전의 규칙 기반 판단 근거를 보여준다.

### 9-5. Operations

초기 read-only:

- latest run status
- latest errors
- row counts
- last updated

v2:

- Render pipeline trigger
- trigger history
- lock 상태

## 10. 개발 단계

### Phase 0. 준비

목표:

- Next.js app scaffold
- Vercel 배포 가능한 최소 구조

작업:

1. `apps/dashboard` 생성
2. Next.js App Router + TypeScript + Tailwind 설정
3. `.env.example` 작성
4. Vercel build command 정리
5. root README에 dashboard 실행법 추가

완료 기준:

- `npm run dev`로 빈 dashboard 실행
- `npm run build` 통과

### Phase 1. Google Sheets read layer

목표:

- Next.js 서버에서 Sheets를 읽는 안정적인 adapter 작성

작업:

1. `lib/env.ts`에서 server-only env validation
2. `lib/sheets.ts`에서 Google Sheets client 생성
3. `lib/schema.ts`에 Python Sheets schema와 동일한 타입 정의
4. `transactions`, `daily_brief`, `signals`, `system_log` read 함수 작성
5. row parsing, number/date normalization 작성

완료 기준:

- `/api/dashboard`가 실제 Sheets 데이터를 JSON으로 반환
- credential이 client bundle에 포함되지 않음

### Phase 2. Dashboard UI v1

목표:

- Streamlit 대시보드의 핵심 기능을 Next.js로 이식

작업:

1. Overview metrics
2. Daily brief panel
3. Recent transactions table
4. Signals table
5. System log status panel
6. loading/error UI

완료 기준:

- 실제 운영 실행 후 생성된 `daily_brief`, `transactions`, `signals`가 표시됨
- empty state가 명확함
- 모바일에서 주요 정보 확인 가능

### Phase 3. 필터/차트

목표:

- 운영자가 데이터를 탐색할 수 있게 만든다.

작업:

1. date range filter
2. symbol filter
3. severity/rule filter
4. volume by token chart
5. daily transaction count chart
6. signal severity distribution

완료 기준:

- Streamlit의 기존 통계 기능 이상을 제공
- token이 많아도 초기 UI가 과도하게 무거워지지 않음

### Phase 4. Vercel 배포

목표:

- Vercel에서 dashboard를 안정적으로 배포

작업:

1. Vercel project 연결
2. Root directory를 `apps/dashboard`로 설정
3. env 등록
4. preview deployment 확인
5. production deployment 확인
6. README에 배포 URL과 운영 주의사항 추가

완료 기준:

- Vercel production URL에서 dashboard 접근 가능
- server-only env가 브라우저에 노출되지 않음

### Phase 5. 운영 액션 v2

목표:

- dashboard에서 Render pipeline trigger를 안전하게 실행

작업:

1. Render trigger endpoint 또는 deploy hook 검토
2. `POST /api/pipeline/trigger` 추가
3. secret 검증
4. 중복 실행 lock 확인
5. trigger 결과를 `system_log` 또는 별도 log에 기록

완료 기준:

- 대시보드 버튼으로 Render pipeline 1회 실행 가능
- 중복 클릭 또는 장시간 실행이 제어됨

## 11. 테스트 계획

### Unit

- env validation
- Sheets row parser
- metric aggregation
- formatter

### Integration

- mocked Sheets client로 `/api/dashboard` 테스트
- 빈 시트, 일부 컬럼 누락, 숫자 파싱 실패 케이스
- latest system log parsing

### E2E / Browser

- dashboard loads
- brief visible
- signals table visible
- transactions table visible
- no browser console error

### Manual 운영 검증

1. Render pipeline 또는 local `python -m src.main` 실행
2. Google Sheets row count 증가 확인
3. Vercel dashboard 새로고침
4. latest run status와 brief 표시 확인

## 12. 주요 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| Google Sheets API quota | dashboard read 실패 | cache/revalidate, endpoint별 limit |
| credential 노출 | 보안 사고 | server-only env, `NEXT_PUBLIC_` 금지 |
| token 수 과다 | UI 성능 저하 | 기본 recent view, 필터 lazy 적용 |
| Vercel serverless cold start | 첫 로딩 지연 | aggregate endpoint, 가벼운 Sheets read |
| Render pipeline과 dashboard 상태 불일치 | 운영 혼란 | `system_log` latest run 명확히 표시 |
| Streamlit과 Next.js 병행 기간 | 문서 혼란 | README에 legacy/local dashboard로 명시 |

## 13. 마이그레이션 기준

Streamlit dashboard를 완전히 대체하는 기준:

- Next.js dashboard가 `daily_brief`, `transactions`, `signals`, `system_log`를 모두 표시한다.
- Vercel production URL이 동작한다.
- Google Sheets credential이 client bundle에 노출되지 않는다.
- 운영 실행 후 1분 내 dashboard에서 최신 데이터 확인 가능하다.
- README의 기본 dashboard 실행 경로가 Next.js로 변경된다.

Streamlit은 이후 `legacy local dashboard`로 유지하거나 제거한다.

## 14. 우선 개발 순서

1. `apps/dashboard` scaffold
2. server-only Sheets adapter
3. `/api/dashboard` aggregate endpoint
4. Overview + Daily Brief UI
5. Transactions table
6. Signals table
7. System log panel
8. Vercel deployment
9. README 업데이트
10. Render trigger button 검토

## 15. 참고 문서

- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Next.js Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data)
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers-and-middleware)
- [Next.js Environment Variables](https://nextjs.org/docs/15/app/guides/environment-variables)
