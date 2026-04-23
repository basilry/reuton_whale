---
type: implementation-report
project: WhaleScope
date: 2026-04-18
sequence: 21
status: completed-partial
tags:
  - whalescope
  - v7
  - implementation
  - qa
  - i18n
related:
  - 2026-04-18-20-WhaleScope-v7-개선계획-데이터풍부화-신호상세-i18n확장
  - 2026-04-18-21-WhaleScope-v7-WorkerC-체크리스트-데이터소스-env-sync
---

# WhaleScope v7 구현 · QA · 종합보고서

## 1. 범위
이번 v7에서는 문서의 전체 항목을 한 번에 닫기보다, 사용자 체감과 운영 재현성에 직접 영향을 주는 축을 우선 반영했다.

1. 브리핑이 시그널 0건일 때도 무의미한 빈 문구로 끝나지 않도록 fallback 경로를 추가했다.
2. 뉴스 RSS cadence와 운영 가시성을 보강했다.
3. 유저홈 시그널 카드의 장식 CTA를 실제 상세 모달로 교체했다.
4. 감시지갑 로더가 `watched_addresses` legacy 소스를 읽도록 확장했다.
5. 루트 `.env`와 dashboard `.env.local` 간 동기화 경로를 추가했다.
6. 유저홈 주요 섹션의 i18n 누수를 줄이고, 고래 스토리 시간을 절대시각으로 통일했다.

## 2. 반영 내역

### 2.1 백엔드 / 파이프라인
- `src/pipeline/brief.py`
  - `signals=0`일 때 즉시 종료하지 않고 최근 60분 `transactions` 기반 fallback 브리핑을 생성하도록 변경했다.
  - fallback 브리핑은 `summary`, `top_transactions`, `total_volume_usd`, `highlights`, `signal_themes`, `note=fallback_tx_based...`를 저장한다.
- `src/enrich/price_resolver.py`
  - CoinGecko → Binance 공개 ticker → in-memory stale cache 순으로 USD 가격을 해석하는 resolver를 추가했다.
- `src/ingestion/news_rss.py`
  - RSS fetch 결과를 `FeedFetchResult`로 수집하고, `feeds_ok`, `feeds_failed`, `items_fetched`, `items_new`, `feed_results` 메타데이터를 남기도록 변경했다.
- `src/pipeline/run_all.py`
  - `news_rss`를 30분 cadence에서 15분 slot cadence로 변경했다.
  - orchestrator heartbeat/details에 job 결과 dict를 더 많이 남기도록 유지했다.

### 2.2 프런트 / 유저홈
- `apps/dashboard/components/signal-section.tsx`
  - 시그널 카드 CTA를 실제 버튼으로 바꾸고 상세 모달 오픈 흐름을 연결했다.
- `apps/dashboard/components/signal-detail-modal.tsx`
  - rule explanation, score, confidence, source, evidence hashes를 보여주는 모달을 추가했다.
- `apps/dashboard/lib/signal-rule-docs.ts`
  - rule별 정적 fallback 해설을 ko/en으로 추가했다.
- `apps/dashboard/app/page.tsx`
  - 브리핑 카드 refresh label, fallback badge, watchlist/stories helper copy를 dictionary 기반으로 정리했다.
  - whale story 렌더는 `formatStoryTimestamp` 기반 절대시각으로 통일했다.
- `apps/dashboard/components/news-widget-client.tsx`
  - 뉴스 rail header/caption/warning/expand copy를 dictionary 기반으로 전환했다.
  - fallback item의 제목/요약/source도 언어별로 바인딩되도록 조정했다.

### 2.3 데이터 계층 / 운영 지원
- `apps/dashboard/lib/curated-wallets.ts`
  - `curated_wallets` 우선, `watched_addresses` legacy fallback, seed/empty 분기, `WHALESCOPE_CURATED_DISABLE_SEED` 스위치를 반영했다.
- `apps/dashboard/lib/metrics.ts`
  - `daily_brief` parser가 `highlights`, `signal_themes`, `note`를 읽도록 확장했다.
  - 최근 signal row를 detail modal이 소비할 수 있는 display shape로 정규화했다.
  - `/admin` operator checks에 `Curated watchlist` source 경로를 추가했다.
- `apps/dashboard/lib/schema.ts`
  - dashboard 측 schema에 `watched_addresses`, 확장된 `daily_brief` headers를 반영했다.
- `scripts/sync-env.mjs`, `package.json`
  - root env에서 dashboard allowlist만 `.env.local`로 내려쓰는 `env:sync`를 추가했다.

## 3. 검증

### 3.1 테스트 / 정적 검증
- `pytest tests/test_brief_fallback.py tests/test_news_rss.py tests/test_run_all.py -q`
  - 결과: `14 passed`
- `npm run dashboard:typecheck`
  - 통과
- `npm run dashboard:lint`
  - 통과
- `npm run dashboard:build`
  - 통과

### 3.2 수동 QA 메모
- `dashboard_lang=en` 기준 HTML 확인에서 TopNavbar, Telegram CTA, 뉴스 rail 주요 문구는 영어로 내려오는 것을 확인했다.
- 다만 `MarketTickerStrip` 내부 상태 문구는 아직 한국어 잔여가 있다.
- 로컬 dev 중 `GOOGLE_CREDENTIALS_JSON` 파싱 오류를 발견했고, env loader와 env sync 쪽의 quoted JSON 처리 로직을 보강했다.

## 4. 잔여 리스크
- `market_mood`는 아직 브리핑 생성 파이프라인의 구조화 결과가 아니라 프런트 휴리스틱이다.
- `MarketTickerStrip`과 관련 helper에는 한국어 문자열이 남아 있어 `en` 모드 완전 전환은 미완료다.
- 저장된 brief summary 본문 자체는 번역하지 않으므로, ko로 생성된 summary는 en 모드에서도 원문 유지다.
- signal detail modal은 현재 들어오는 payload 범위만 표시한다. `related_wallets`, `related_assets`, `narrative_ai` 품질은 백엔드 데이터 확장에 달려 있다.

## 5. 다음 우선순위
1. `market_mood`를 `brief` 파이프라인에서 구조화 데이터로 생성하도록 이관
2. `MarketTickerStrip` 및 관련 formatter/source chip/theme toggle 전체 i18n 정리
3. signal payload에 `related_wallets`, `related_assets`, `narrative_ai`를 더 안정적으로 채우는 backend follow-up
4. 필요 시 `no-literal-string` 규칙 도입으로 user-facing hardcoded string 회귀 방지
