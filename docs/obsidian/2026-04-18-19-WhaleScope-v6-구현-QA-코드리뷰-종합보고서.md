---
type: implementation-report
project: WhaleScope
date: 2026-04-18
sequence: 19
status: completed
tags:
  - whalescope
  - v6
  - implementation
  - qa
  - code-review
related:
  - 2026-04-18-18-WhaleScope-v6-개선계획-데이터파이프라인-UX-인프라모니터링
---

# WhaleScope v6 구현 / QA / 코드리뷰 종합보고서

## 1. 구현 범위 요약

이번 세션에서는 v6 계획 문서의 핵심 범위를 실제 코드에 반영했다.

### 1.1 P0 데이터 파이프라인
- `src/pipeline/run_all.py`
  - `minute % 15` 기반 strict gate 제거
  - KST 기준 15분 슬롯 floor 방식으로 dispatch slot 계산
  - `signals`, `curated_balance`는 모든 슬롯에서 due
  - `news_rss`, `stories`, `brief`, `broadcast_daily`, `channel_health`, `weekly_trend`는 계획 문서 스케줄대로 slot 기준 계산
- `src/storage/sheets_client.py`
  - `system_log` window 조회 기반 duplicate guard 추가
- duplicate guard
  - 같은 slot 내 terminal status가 이미 있으면 동일 job 재실행 skip
  - `run_all` summary에 `skipped_jobs` 포함
- heartbeat/운영 관측
  - `src/observability/service_health.py` 추가
  - `signals`, `brief`, `stories`, `broadcast_daily`, `channel_health`, `run_all`, `telethon_listener` 경로에서 `service_health` 기록 연동

### 1.2 운영 상태 모델 / admin 개선
- `/admin`을 5개 서비스 카드 기준으로 확장
  - Pipeline
  - Listener
  - Bot
  - Dashboard
  - Data source
- `apps/dashboard/lib/metrics.ts`
  - `sourceHealth`
  - `serviceHealth`
  - `operatorChecks`
  - `opsSummary`
  추가
- `service_health`, `channel_health`는 optional raw Sheets read로 읽도록 처리해 탭이 없어도 degrade 없이 동작
- `/api/admin/health` 추가

### 1.3 유저 홈 UX / 다국어 / 상태 가시화
- 라이트 모드 기본값 강제
  - 저장된 테마가 없으면 항상 `light`
- dashboard language selector
  - `ko/en` 2개만 유지
  - `ja` 제거
- 최소 dictionary 기반 i18n 뼈대 추가
  - navbar
  - language selector
  - Telegram modal
  - 유저 홈 주요 헤딩/사이드바/푸터 일부
- 유저 홈 상태 반영
  - `sourceHealth`, `opsSummary`를 루트 페이지에 반영
  - stale/fallback/config 상태를 connection chip과 risk 영역에 노출
- 뉴스 rail
  - `lastUpdatedAt` 유지
  - stale warning 노출
- 고래 스토리
  - `generatedAt` 필드 추가
  - 카드 하단에 생성 상대시각 분리 표시

## 2. 서브에이전트 병렬 트랙

### 트랙 A: 백엔드 스케줄/heartbeat
- `run_all` slot-snap
- duplicate guard
- `service_health` write path
- Telethon / pipeline heartbeat 연결

### 트랙 B: i18n/테마/Telegram UX
- light default theme
- `ko/en` selector
- dashboard i18n infrastructure
- Telegram modal copy/accessibility/public channel config 정리

### 트랙 C: 운영 상태 모델/admin
- 5-card health model
- `sourceHealth/serviceHealth/operatorChecks/opsSummary`
- `/api/admin/health`
- `/admin` 체크리스트 확장

메인 에이전트는 유저 홈 통합, 스토리 생성시각, stale warning, 최종 QA와 통합 검증을 담당했다.

## 3. QA 결과

### 3.1 Python
- `pytest tests/test_run_all.py tests/test_news_rss.py tests/test_curated_balance_refresh.py tests/test_llm_budget.py tests/test_main.py -q`
- 결과: `30 passed, 1 warning`

### 3.2 Frontend
- `npm run dashboard:typecheck`
- 결과: 통과
- `npm run dashboard:lint`
- 결과: 통과
- `npm run dashboard:build`
- 결과: 통과

### 3.3 Build 산출 확인
- Next build 결과에 아래 라우트가 정상 생성됨
  - `/`
  - `/admin`
  - `/api/admin/health`
  - `/api/news`
  - `/api/language`

### 3.4 로컬 응답 확인
- dev server 재기동 후 `/` 응답 확인
- dev server 재기동 후 `/admin` 응답 확인
- dev 서버에서는 신규 API 라우트 hot-pickup 타이밍 이슈가 있었으나, production build 산출물에는 `/api/admin/health`가 정상 포함됨

## 4. 코드리뷰 관점 메모

### 좋았던 점
- v5까지의 분리 구조(`/`, `/admin`, Render single cron)는 유지하면서 v6를 올렸기 때문에 회귀 범위가 제한적이었다.
- `service_health`를 optional read로 처리한 방식은 운영 탭이 아직 비어 있는 초기 상태에서도 UI를 깨지 않게 만들어서 안전하다.
- `run_all`의 slot-snap + duplicate guard 조합은 Render jitter 문제에 직접 대응하는 가장 실용적인 수정이다.

### 주의가 필요한 점
- `/api/admin/health`는 build 기준으로는 정상이지만, dev HMR에서 신규 route pickup이 즉시 반영되지 않는 케이스가 있었다. 운영 반영은 dev가 아니라 build artifact 기준으로 판단해야 한다.
- operator env check는 Next 런타임에서 dynamic `process.env[name]` 접근이 흔들릴 수 있어 explicit key 접근으로 보정했다. 이후 env 체크 로직 확장 시에도 같은 원칙을 유지해야 한다.
- 유저 홈 본문 번역은 shared chrome 수준을 넘어 일부 헤딩/푸터까지 확장했지만, 카드 본문 전체 다국어화까지는 아직 아니다.

## 5. 미반영 / 잔여 항목

### 우선순위 높음
- `/admin`와 유저 홈에서 `service_health` 데이터를 더 직접적으로 활용하는 heartbeat freshness 시각화 강화
- bot 전용 상시 worker heartbeat 추가
- dev 환경에서 `/api/admin/health` route pickup 재현 조건 정리

### 우선순위 중간
- 유저 홈 본문 전체 번역 범위 확장
- `news_feed` direct source가 실제 채워졌을 때의 stale/empty QA 추가
- operatorChecks를 env 직접 체크보다 service-config state 중심으로 더 정교화

## 6. 결론

v6 문서의 핵심 목표였던 아래 항목은 이번 세션 기준 반영 완료로 판단한다.

- Render cron jitter 대응
- slot duplicate guard
- `service_health` 저장 경로 확보
- `/admin` 5카드 상태 모델 구축
- `sourceHealth` 기반 유저 홈 상태 가시화
- 라이트 기본 테마
- `ko/en` 언어 셀렉터 및 i18n 뼈대
- Telegram public UX 정리
- 뉴스 stale warning
- 고래 스토리 생성시각 분리

남은 범위는 운영 심화와 번역 확장, bot 상시 heartbeat 정교화다. 즉, v6는 “기초 운영 안정화 + 상태 가시화” 단계까지는 도달했고, 다음 페이즈는 실제 운영 편의성과 데이터 풍부화 쪽으로 넘어갈 수 있는 상태다.
