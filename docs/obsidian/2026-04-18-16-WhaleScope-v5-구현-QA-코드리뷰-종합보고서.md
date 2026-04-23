---
type: implementation-report
project: WhaleScope
date: 2026-04-18
sequence: 16
status: completed
tags:
  - whalescope
  - v5
  - render
  - nextjs
  - qa
  - code-review
related:
  - "[[2026-04-18-15-WhaleScope-v5-개선계획-Render-단일소스-UI-UX]]"
---

# WhaleScope v5 구현 / QA / 코드리뷰 종합보고서

## 1. 이번 페이즈에서 실제 반영한 내용

### 1.1 Render 단일 소스 전환
- `src/pipeline/run_all.py`를 추가해 Render cron 단일 진입점으로 정리했다.
- KST 기준 cadence를 코드 안에 명시했다.
  - 15분: `signals`, `curated_balance`
  - 30분: `news_rss`
  - 6시간: `stories`
  - 8시간: `brief`
  - 09:00 KST: `broadcast_daily`
  - 09:15 KST: `channel_health`
  - 화요일 08:00 KST: `weekly_trend`
- `src.main`은 삭제하지 않고 legacy/manual 경로로 유지했다.
- `src/ingestion/news_rss.py`에 `run_news_rss_refresh()` helper를 추가했다.
- `scripts/run_weekly_trend.py`에 `run_weekly_trend()` helper를 추가했다.
- `render.yaml`을 추가해 `whalescope-pipeline` cron service를 IaC 기준으로 관리할 수 있게 했다.

### 1.2 GitHub Actions 정리
- `signals`, `brief`, `stories`, `news_rss`, `curated_balance`, `broadcast_daily`, `channel_health`, `weekly_trend` workflow의 자동 schedule을 제거했다.
- 모두 `workflow_dispatch` 전용 수동 복구 경로로 정리했다.
- legacy `daily_brief.yml`은 삭제했다.

### 1.3 유저홈 UI/UX
- 좌측 사이드바에 `시장 티커` 앵커를 추가했다.
- `/` 페이지에서 시장 티커 섹션 id를 `market-ticker`로 고정했다.
- `MarketDetailChartModal`을 `document.body` portal로 이동시켜 blur/filter 조상에 갇히는 구조 리스크를 제거했다.
- `TelegramConnectModal`도 같은 portal 패턴으로 통일했다.
- Telegram 공개 UX를 채널 전용으로 축소했다.
  - bot CTA 제거
  - bot URL/QR 제거
  - `채널 열기`, `링크 복사`, `QR`, 구독자 수만 유지
- 공개 환경변수는 `NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME` 우선, `NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL` 1회 릴리스 fallback 구조로 정리했다.
- 시장 티커는 모바일 `<=767px`에서 2개만 기본 노출하고 `펼치기/접기` 토글을 추가했다.
- 뉴스 위젯은 서버 fetch를 유지하면서 client presenter로 분리해 모바일 `2개+펼치기`를 추가했다.
- `지능형 분석 작동 방식`은 모바일에서 2x2 grid로 재배치했고 connector는 모바일에서 강제로 숨겼다.

### 1.4 문서/환경변수
- `README.md`, `apps/dashboard/README.md`, `docs/operational-run-verification.md`를 v5 기준으로 갱신했다.
- production pipeline 명령 기준을 `python -m src.pipeline.run_all`로 올리고, `src.main`은 dry-run/legacy/manual 경로로 분리해 설명했다.
- `.env.example`, `apps/dashboard/.env.example`를 채널 전용 공개 env 기준으로 갱신했다.

## 2. QA 결과

### 2.1 Python
- `pytest tests/test_run_all.py tests/test_news_rss.py tests/test_curated_balance_refresh.py tests/test_llm_budget.py tests/test_main.py -q`
- 결과: `28 passed, 1 warning`
- warning: `tests/test_main.py`에서 기존 pydantic warning 1건. 신규 회귀는 아님.

### 2.2 Frontend 정적 검증
- `npm run dashboard:typecheck` → 통과
- `npm run dashboard:lint` → 통과
- `npm run dashboard:build` → 통과
- 참고: Next.js workspace root lockfile warning은 기존 구조 경고이며 빌드 실패는 아님.

### 2.3 Runtime smoke
- `PORT=3012 npm run dashboard:dev` 실행 후 확인
- `GET /` → 200
- `GET /admin` → 200
- `GET /api/news?limit=4` → 200
- 응답 payload에서 `lastUpdatedAt`과 news collapse button 렌더가 확인됐다.

## 3. 코드리뷰 / 다관점 리뷰

### 3.1 잘 반영된 점
- Render 단일 진입점이 생기면서 “진실의 원천”이 GHA와 분리됐다.
- modal portal 전환으로 UI 버그 재발 가능성이 크게 줄었다.
- 뉴스 위젯을 서버 fetch + client interaction으로 분리한 구조는 Next.js App Router 패턴에 맞다.
- Telegram public UX가 채널 중심으로 단순화돼 사용자 혼선이 줄었다.
- README와 운영 검증 문서가 실제 런타임 구조에 더 가까워졌다.

### 3.2 현재 남아 있는 리스크
- `weekly_trend`는 이번 페이즈에서 Render 편입만 했고, 데이터 소스는 여전히 placeholder 성격이 남아 있다. 품질 개선은 다음 페이즈 과제다.
- `render.yaml`을 커밋했다고 기존 Render cron이 자동으로 바뀌는 것은 아니다. 최초 Blueprint 연결 또는 manual sync가 필요하다.
- 시각 QA는 build/smoke 중심으로는 통과했지만, 실제 breakpoint별 육안 검수는 Render/Vercel 프리뷰에서 한 번 더 보는 것이 안전하다.
- `NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL` fallback은 의도적으로 1회 릴리스만 유지한 임시 호환 장치다. 다음 정리 페이즈에서 제거해야 한다.

## 4. Render 인스턴스 전환 방법

### 4.1 적용 순서
1. 현재 변경을 main에 반영한다.
2. Render Dashboard에서 기존 cron service 이름을 확인한다.
3. 이름이 `whalescope-pipeline`과 같다면 그대로 Blueprint에 연결한다.
4. 이름이 다르면 `render.yaml`의 service name을 실제 이름에 맞춘 뒤 sync한다.
5. Render에서 repo 기반 Blueprint를 생성하거나 기존 service에서 Blueprint 관리 대상으로 편입한다.
6. 첫 sync에서 아래 3가지를 확인한다.
   - `type=cron`
   - `schedule=*/15 * * * *`
   - `startCommand=python -m src.pipeline.run_all`
7. sync 후 manual run 1회를 수행한다.
8. Google Sheets에서 아래 탭 증가 여부를 확인한다.
   - `signals`
   - `daily_brief`
   - `news_feed`
   - `curated_wallet_balances`
   - `channel_health`
   - `llm_budget_log`
   - `weekly_trend`
9. Render 로그와 `system_log`를 확인한 뒤, GHA는 수동 dispatch만 사용하는 운영 원칙으로 전환한다.

### 4.2 환경변수 메모
- 기존 Render service를 Blueprint로 편입하면 기존 env 값은 유지된다.
- 새 env key를 추가하는 경우에는 Render 콘솔에서 직접 값을 넣어야 한다.
- `TELEGRAM_BROADCAST_ENABLED`, `TELEGRAM_BROADCAST_DRY_RUN`, `TELEGRAM_BROADCAST_CHAT`는 운영 정책에 맞게 별도 확인이 필요하다.

## 5. 다음 권장 작업
- Vercel/Render 실환경에서 375 / 640 / 1024 / 1280 / 1440 breakpoint 육안 QA를 1회 더 수행한다.
- `weekly_trend` 데이터 입력 경로를 placeholder에서 실제 신호 집계 기반으로 리팩토링한다.
- Telegram 공개 채널 운영이 안정화되면 fallback env(`NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL`)를 제거한다.
- Render Blueprint를 실제 운영 인스턴스와 연결한 뒤, 수동 run 1회 결과를 별도 운영 노트로 남긴다.
