---
date: 2026-04-18
sequence: 13
tags:
  - whalescope
---

# 2026-04-18-13 WhaleScope 유저홈 v4 구현 QA 코드리뷰 종합보고서

## 1. 요약
- v4 범위 중 실제 미구현이던 `뉴스 우측 rail`, `티커 source chips + 상세 차트 modal`, `워크플로 분리`, `LLM 예산 가드`, `Telegram 운영 런북`, `기초 모바일 반응형 정리`를 반영했다.
- 문서와 코드의 불일치도 함께 정리했다. 유저홈 실제 기준 파일은 `apps/dashboard/app/page.tsx`와 `apps/dashboard/app/insights/insights.module.css`이며, 문서상 `page.module.css` 기준은 폐기했다.
- `/` 유저홈과 `/admin` 운영페이지 분리는 유지했고, 이번 페이즈에서는 유저홈 UX와 백엔드 운영 파이프라인 정비에 집중했다.

## 2. 반영 내역

### 2-1. 유저홈 레이아웃 / 뉴스
- `NewsWidget`을 `InsightsSidebar` footer slot에서 분리해 우측 sticky rail로 이동했다.
- 데스크톱은 `좌측 nav + 본문 + 우측 뉴스 rail`, 1024px 미만에서는 `상단 nav + 본문 + 하단 뉴스`로 접히도록 조정했다.
- `NewsWidgetData`에 `lastUpdatedAt`을 추가했고, 위젯 헤더에 KST `YYYY.MM.DD HH:mm:ss` 형식의 마지막 갱신 시각을 노출했다.
- `/api/news`와 `lib/news.ts`는 계속 `news_feed` 우선, 비어 있으면 `daily_brief/signals` 파생 fallback을 유지한다.

### 2-2. 실시간 티커 UX / 차트
- 단일 `Live/REST/Local` pill을 제거하고 `Binance`, `Upbit`, `FX`, `Snapshot` 4개 소스 칩으로 교체했다.
- 칩 상태는 `connecting / live / stale / down`으로 분리했다. 15초 이내는 live, 45초 이상 무응답/오류는 down으로 처리한다.
- 정상 상태 notice flicker를 제거했고, notice는 fallback/error 상황에서만 노출되도록 바꿨다.
- 마지막 갱신 시각은 KST `YYYY.MM.DD HH:mm:ss`로 표시하고, 화면 갱신은 초 단위로만 보이도록 제한했다.
- 카드 레이아웃은 `repeat(auto-fit, minmax(280px, 1fr))`로 조정했고, 모바일 가로 스크롤 의존을 제거했다.
- 인카드 확장 차트를 제거하고 `MarketDetailChartModal`로 승격했다. backdrop click, ESC close, focus restore, 640px 미만 full-screen을 적용했다.
- 문서상 Kraken chip은 실제 데이터 소스가 없으므로 구현하지 않았다.

### 2-3. 파이프라인 / 워크플로 / 예산
- `.github/workflows/daily_brief.yml`은 `workflow_dispatch` 전용 legacy wrapper로 축소했다.
- 신규 워크플로를 추가했다.
  - `signals.yml`
  - `brief.yml`
  - `stories.yml`
  - `news_rss.yml`
  - `curated_balance.yml`
  - `broadcast_daily.yml`
  - `channel_health.yml`
- `src/pipeline/signals.py`는 수집/저장/시그널 생성만 수행한다.
- `src/pipeline/brief.py`는 최근 signals 기반으로 브리프를 생성하고 `llm_budget_log`를 기록한다.
- `src/pipeline/stories.py`는 `per_signal_narration` 라우팅을 이용해 고래 스토리를 생성하고 예산 가드를 적용한다.
- `src/pipeline/broadcast_daily.py`는 최신 브리프를 공개 채널과 구독자 DM에 배포한다.
- `src/pipeline/channel_health.py`는 Telegram `getChat` / `getChatMemberCount` 결과를 저장한다.
- `src/ingestion/curated_balance_refresh.py`는 `curated_wallets`를 읽어 `curated_wallet_balances`를 안전하게 upsert한다.
- `src/router/budget.py`에는 월 `$15` hard cap을 추가했다. 현재 제한 대상은 `brief` / `stories`만이며, `signals`는 계속 실행된다.

### 2-4. Sheets 스키마
- 다음 탭을 추가했다.
  - `llm_budget_log`
  - `curated_wallet_balances`
  - `channel_health`
- `scripts/init_sheets.py`는 별도 수정하지 않았다. `ALL_TABS` / `TAB_HEADERS`를 그대로 읽기 때문에 스키마 상수 변경만으로 새 탭 생성이 자동 반영된다.

### 2-5. Telegram 운영 문서
- `docs/ops/telegram-broadcast-onboarding.md`를 추가했다.
- 내용:
  - 채널 admin 권한 설정
  - `Shadow -> Live` 전환 절차
  - 기본 환경변수
  - 검증 순서
  - 장애 시 롤백 기준

## 3. 검증 결과

### 3-1. Python 검증
- `pytest tests/test_llm_budget.py tests/test_curated_balance_refresh.py tests/test_news_rss.py tests/test_storage_new_tabs.py tests/test_main.py -q`
  - 결과: `52 passed, 1 warning`
  - warning: 기존 Pydantic warning 1건 유지. 이번 변경 실패는 없음.
- `python -m py_compile src/main.py src/router/budget.py src/ingestion/curated_balance_refresh.py src/pipeline/__init__.py src/pipeline/common.py src/pipeline/signals.py src/pipeline/brief.py src/pipeline/stories.py src/pipeline/broadcast_daily.py src/pipeline/channel_health.py src/storage/schema.py src/storage/sheets_client.py scripts/init_sheets.py`
  - 결과: 통과

### 3-2. Frontend 검증
- `npm run dashboard:typecheck`
  - 통과
- `npm run dashboard:lint`
  - 통과
- `npm run dashboard:build`
  - 통과
- build 시 Next.js workspace root / 다중 lockfile warning은 남아 있다.
  - 기능 실패는 아니지만 추후 `outputFileTracingRoot` 또는 lockfile 정리가 필요하다.

### 3-3. 런타임 스모크
- 로컬 `next dev` 기준 `http://127.0.0.1:3003`
- 확인 결과
  - `GET /` -> `200`
  - `GET /admin` -> `200`
  - `GET /api/news?limit=2` -> `200`
- `/api/news` 응답에 `lastUpdatedAt`이 포함되는 것도 확인했다.

## 4. 다관점 리뷰

### 4-1. Product 관점
- 유저홈 정보 구조가 전보다 명확해졌다. 뉴스가 독립 rail로 빠지면서 브리핑/티커/뉴스의 역할이 겹치지 않는다.
- 티커 칩과 마지막 갱신 시각이 들어가면서 사용자가 “현재 값이 실시간인지, 스냅샷인지, 끊긴 상태인지”를 해석할 수 있게 됐다.
- Telegram 연결 UX는 그대로 유지하면서 운영 절차를 문서로 분리해, 제품 UX와 운영 설정이 섞이지 않게 정리했다.

### 4-2. Frontend 관점
- modal 패턴은 기존 Telegram modal과 일관성을 맞췄고, focus restore/ESC close까지 포함해 접근성 기본선을 맞췄다.
- 1024px 기준 뉴스 rail 접힘, 640px 기준 chart modal full-screen 등 브레이크포인트가 이전보다 명확해졌다.
- 다만 실제 브라우저에서 `375 / 640 / 1024 / 1280 / 1440` 전수 시각 검증은 이번 세션에서 수행하지 못했다. 현재는 build + HTTP smoke까지만 확인된 상태다.

### 4-3. Backend / Ops 관점
- 기존 단일 daily workflow를 잡 단위로 쪼개면서 장애 격리와 신선도 제어가 가능해졌다.
- `llm_budget_log`와 `$15` cap이 들어가 LLM 비용이 완전히 무제한으로 새어나가는 상태는 해소됐다.
- `channel_health`와 `broadcast_log`를 함께 보면 Telegram 배포 체인의 상태를 분리해서 볼 수 있다.

### 4-4. Code Review 관점
- 현재 반영분 기준으로 빌드/타입/테스트를 막는 치명적 결함은 발견되지 않았다.
- `git diff --check`도 통과해 공백/patch artifact는 없다.
- 다만 아래는 잔여 리스크로 본다.

## 5. 잔여 리스크 / 미반영 항목
- `curated_balance_refresh.py`는 현재 `curated_wallets.approx_balance`를 `curated_wallet_balances`에 캐시하는 최소 구현이다.
  - 실제 onchain RPC/API 기반 실시간 잔고 조회는 아직 아니다.
- `broadcast_daily.py`는 `KST 09:00` 윈도우 외에는 기본적으로 skip한다.
  - 수동 실행은 `--force` 또는 GitHub `workflow_dispatch` 경로를 전제로 한다.
- `channel_health`는 저장까지만 구현했고, `/admin` 운영 UI 카드로 아직 연결하지 않았다.
- `daily_brief.yml` legacy wrapper는 남아 있다.
  - 예약 실행에는 쓰이지 않지만 수동 실행 시 기존 all-in-one `src.main` 경로가 그대로 돈다.
- 뉴스/티커/모달의 브레이크포인트는 코드상 정리됐지만, 실 브라우저 스크린샷 기반 모바일 QA는 추가로 필요하다.

## 6. 다음 액션 제안
1. `curated_balance_refresh.py`를 실제 체인별 RPC/API 조회로 교체한다.
2. `/admin`에 `channel_health`와 `llm_budget_log` 요약을 붙여 운영 가시성을 올린다.
3. 375/640/1024/1280/1440 브레이크포인트의 실제 브라우저 시각 QA를 별도 세션에서 수행한다.
4. Next.js 다중 lockfile warning을 정리한다.
5. Render / GitHub Actions / Vercel 환경변수 세트를 다시 맞춰 `Shadow -> Live` 전환 리허설을 한 번 더 수행한다.

## 7. 결론
- 이번 v4 반영은 “화면 UX 개선”과 “운영 파이프라인 분리”를 함께 끝낸 페이즈다.
- 유저홈은 더 읽기 쉬워졌고, 백엔드는 더 자주 돌 수 있게 정리됐다.
- 다만 `curated balance 실데이터화`, `실브라우저 모바일 QA`, `운영 UI 연동`은 다음 단계에서 마무리해야 한다.
