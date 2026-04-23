---
type: implementation-report
project: WhaleScope
date: 2026-04-20
sequence: 1
status: completed
tags:
  - WhaleScope
  - chain-coverage
  - tg-mirror
  - btc-fallback
  - qa
related:
  - "[[2026-04-19-09-WhaleScope-감시지갑-체인-커버리지-확장-개선안-상세설계]]"
  - "[[2026-04-19-07-WhaleScope-감시지갑-체인편향-분석-ETH-중심-근본원인]]"
---

# WhaleScope 체인 커버리지 적용 완료 / QA 종합보고서

## 1. 요약

이번 반영 범위에서는 체인 커버리지 확장 설계 #26의 실구현 상태를 코드 기준으로 다시 맞췄고, 누락돼 있던 운영 관측과 BTC fallback까지 마감했다.

핵심적으로 완료된 항목은 아래와 같다.

- `ChainCollectorRegistry` 기반 수집 구조 정리와 silent drop guard 적용
- XRP / TRX / BTC / DOGE collector 실구현 반영
- `signals.yaml` per-chain override 및 외부 관측 규칙 반영
- `/admin`에 chain rollout 진단과 TG mirror observability 추가
- whale story UI에서 `외부 관측`, `교차확인`, `부분 관측 · cluster 미적용` 레인 노출 검증
- BTC collector에 `mempool.space` primary, Blockchair secondary fallback 추가
- watched address import validation과 canary runbook 정리

설계 문서 #26의 P0~P4는 현재 MVP 범위 기준으로 구현 완료 상태로 판단한다. 남은 것은 후속 운영 자동화와 Phase 3.5 고도화 성격의 작업이다.

## 2. 이번에 반영된 커밋 묶음

| commit | 범위 | 요약 |
|---|---|---|
| `404cb10` | chain rollout + import validation | `/admin` rollout 진단, watched address import 검증, runbook 정리 |
| `78d524a` | TG mirror observability | `/admin` 외부 관측 집계, whale story observation lane E2E |
| `307c5eb` | BTC fallback | BTC primary/secondary fallback, BTC 테스트/문서 보강 |

## 3. 적용 상세

### 3.1 체인 rollout 진단 / import validation

적용 파일:
- `apps/dashboard/lib/metrics.ts`
- `apps/dashboard/lib/types.ts`
- `apps/dashboard/app/admin/page.tsx`
- `scripts/import_watched_addresses.py`
- `tests/test_import_watched_addresses.py`
- `README.md`
- `docs/operational-run-verification.md`

완료 내용:
- `watched_addresses`의 seed 수, collector flag, partial-view 여부, 최근 이벤트 수를 합쳐 `/admin`에서 rollout mismatch를 바로 읽을 수 있게 했다.
- `scripts/import_watched_addresses.py`에 header 검증, chain canonicalization, duplicate 차단, enabled/confidence validation, dry-run summary를 넣었다.
- 운영 문서에 canary rollout 순서와 contract/live preflight 경로를 정리했다.

### 3.2 TG mirror / external observation lane

적용 파일:
- `src/ingestion/tg_normalizer.py`
- `src/ingestion/telethon_listener.py`
- `src/signals/models.py`
- `src/signals/rules.py`
- `config/signals.yaml`
- `config/tg_channels.yaml`
- `apps/dashboard/lib/whale-stories.ts`
- `apps/dashboard/lib/metrics.ts`
- `apps/dashboard/app/admin/page.tsx`
- `apps/dashboard/tests/e2e/dashboard-whale-story-observation-lane.spec.tsx`

완료 내용:
- TG event를 `observation_source=tg_mirror`로 모델링하고, 외부 채널/신뢰도 정보를 시그널과 스토리 레인에 반영했다.
- `external_only_observation`, `corroborated_move` 흐름이 구분되도록 규칙을 정리했다.
- `/admin`에서 최근 24시간 TG mirror 건수, confidence 분포, 상위 채널, 최신 관측 시각을 확인할 수 있게 했다.
- 사용자 스토리에서 `외부 관측 · Whale Alert`, `채널 신뢰도`, `부분 관측 · cluster 미적용`이 실제로 렌더되는지 E2E로 고정했다.

### 3.3 BTC collector fallback

적용 파일:
- `src/ingestion/bitcoin.py`
- `tests/test_bitcoin_collector.py`
- `README.md`
- `docs/operational-run-verification.md`

완료 내용:
- BTC collector가 mempool primary에서 실패하면 Blockchair dashboard payload를 secondary로 읽도록 변경했다.
- fallback payload도 UTXO 기준으로 정규화되도록 Bitcoin 쪽에 Blockchair normalizer 경로를 추가했다.
- primary와 fallback이 모두 실패하면 전체 파이프라인을 죽이지 않고 빈 결과로 degrade 하도록 정리했다.
- 운영 문서에는 BTC가 `mempool.space primary + Blockchair secondary`라는 현재 구현 상태를 반영했다.

## 4. QA / 검증 결과

### 4.1 백엔드 / 파이프라인

- `pytest -q tests/test_import_watched_addresses.py`
  - 결과: `5 passed`
- `pytest -q tests/test_bitcoin_collector.py`
  - 결과: `5 passed`
- `pytest -q tests/test_chain_registry.py tests/test_pipeline_common_collect.py`
  - 결과: `6 passed`

### 4.2 대시보드 / 운영 관측

- `npm run dashboard:typecheck`
  - 결과: 통과
- `npm run dashboard:lint`
  - 결과: 통과
- `npm run dashboard:build`
  - 결과: 통과
- `npm run dashboard:e2e -- tests/e2e/dashboard-whale-story-observation-lane.spec.tsx`
  - 결과: `2 passed`

검증 메모:
- `dashboard:typecheck`는 `.next/types`를 읽기 때문에 build와 병렬로 돌리면 흔들릴 수 있다. 이후 검증은 build 후 직렬 실행 기준으로 맞췄다.
- 운영 화면의 TG mirror observability와 whale story observation lane은 코드/테스트 모두 존재하는 상태다.

## 5. 문서 체크리스트 정합화 결과

설계 문서 #26의 기존 체크박스는 실제 코드보다 뒤처져 있었다.

정정 내용:
- Phase 1은 이미 구현 완료로 변경
- Phase 2b TRX collector는 구현 완료로 변경
- Phase 3 BTC collector는 구현 완료로 변경
- Phase 4 DOGE + per-chain signal rules는 구현 완료로 변경
- 운영 가시성과 import validation은 별도 완료 항목으로 추가

즉, 설계 #26은 이제 “미구현 설계”보다는 “구현 완료 + 후속 과제 관리 문서”에 가까운 상태가 됐다.

## 6. 남은 후속 과제

현재 남은 것은 구현 누락보다는 운영 자동화와 고도화다.

- `chain_contract.yml`을 manual-only에서 주간 자동 스케줄로 승격할지 결정하고 연결
- Phase 3.5로 정의된 UTXO cluster 확장과 seed 주소 확대
- BTC/DOGE partial-view 운영 데이터를 누적한 뒤 cluster 고도화 우선순위 재판단

## 7. 현재 상태 판단

WhaleScope의 감시지갑 체인 커버리지는 이제 ETH/SOL 편향을 구조적으로 해소하는 최소 제품 수준에는 도달했다.

정리하면:
- 수집기 레벨: XRP / TRX / BTC / DOGE까지 확장 완료
- 시그널 레벨: per-chain rule과 TG mirror 레인 반영 완료
- 운영 레벨: `/admin`에서 rollout mismatch와 TG mirror 생존 여부 확인 가능
- 안정성 레벨: BTC는 primary 실패 시 fallback 경로 확보
- 문서 레벨: canary / preflight / partial-view 해석 가이드 정리 완료

남은 작업은 기능 미구현보다 운영 자동화와 UTXO 고도화 트랙으로 분류하는 것이 맞다.

## 8. 비고

현재 로컬 working tree에는 `apps/dashboard/.env.example` 삭제가 남아 있었지만, 이번 체인 커버리지 반영과는 무관한 사용자 변경으로 판단해 커밋 범위에 포함하지 않았다.
