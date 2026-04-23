---
type: implementation-checklist
project: WhaleScope
date: 2026-04-18
sequence: 20
status: completed
tags:
  - whalescope
  - v7
  - worker-c
  - curated-wallets
  - env-sync
  - admin-health
related:
  - 2026-04-18-20-WhaleScope-v7-개선계획-데이터풍부화-신호상세-i18n확장
---

# WhaleScope v7 Worker C 체크리스트

## 범위
- v7 문서 중 Worker C 소유 범위만 처리
- 대상: `curated watchlist legacy fallback`, `root env -> dashboard env sync`, `admin/user home용 source metadata 보강`
- 비대상: `page.tsx` 직접 수정, backend pipeline 수정, signal detail modal, i18n 본문 확장

## 상세 체크리스트

### 1. curated watchlist 로더 정비
- [x] dashboard schema에 `watched_addresses` legacy 탭 스키마 추가
- [x] `curated_wallets` 우선, `watched_addresses` fallback, seed/empty 최종 fallback 순서로 로더 재구성
- [x] seed는 시트가 비어 있을 때만 사용하고, 시트 row가 있으면 seed를 섞지 않도록 수정
- [x] `WHALESCOPE_CURATED_DISABLE_SEED=1`일 때 empty registry가 되도록 반영
- [x] override 로드 시 이전 in-memory override를 clear 후 다시 적용
- [x] legacy row를 `CuratedWalletEntry`로 매핑하는 규칙 추가
- [x] legacy synthetic id는 주소 조각을 포함해 충돌 가능성을 줄이도록 구성

### 2. source metadata 노출
- [x] curated registry source/meta(`curated_wallets`, `watched_addresses`, `seed`, `empty`) 추적 구조 추가
- [x] `loadCuratedWalletEntriesWithMeta()` 추가
- [x] `/admin` operator checks에 `Curated watchlist` 상태 추가
- [x] admin detail에서 현재 source와 row count를 바로 해석할 수 있게 문구 정리
- [ ] user home 전용 시각 배지 추가
  - 이번 Worker C 범위에서는 `page.tsx`를 건드리지 않기 위해 제외

### 3. root env -> dashboard env sync
- [x] `scripts/sync-env.mjs` 신규 추가
- [x] 루트 `.env`, `.env.local` + 현재 shell env를 합쳐 dashboard allowlist만 추출
- [x] 생성 파일을 `apps/dashboard/.env.local`로 고정
- [x] `GOOGLE_*`, Telegram public config, admin health에 필요한 최소 서버 키만 allowlist에 포함
- [x] `WHALESCOPE_CURATED_DISABLE_SEED`도 sync 대상에 포함
- [x] 루트 `package.json`에 `env:sync` 추가
- [x] `dashboard:dev`, `dashboard:build`가 자동으로 `env:sync`를 선행하도록 연결

### 4. 문서 정합화
- [x] 루트 README에 `env:sync` 선행 동작 설명 추가
- [x] dashboard README에 generated `.env.local` 흐름과 dry-run 명령 추가
- [x] dashboard README에 `watched_addresses` legacy fallback / seed disable 동작 반영

## 변경 파일
- `apps/dashboard/lib/schema.ts`
- `apps/dashboard/lib/curated-wallets.ts`
- `apps/dashboard/lib/metrics.ts`
- `scripts/sync-env.mjs`
- `package.json`
- `README.md`
- `apps/dashboard/README.md`

## 검증
- [x] `node scripts/sync-env.mjs --dry-run`
- [x] `npm run env:sync`
- [x] `npm run dashboard:typecheck`
- [x] `npm run dashboard:lint`
- [x] `rm -rf apps/dashboard/.next && npm run dashboard:build`

## 검증 메모
- 첫 build 시 Next page-data 수집 단계에서 `/_not-found`, `/api/signals` 해석 오류가 1회 발생했음
- `.next` 정리 후 동일 명령 재실행 시 build 정상 통과
- 최종 build 산출물에 `/api/signals`, `/_not-found`, `/admin` route가 정상 포함됨

## 가정
- `watched_addresses`는 Python 쪽 표준 헤더(`address, chain, category, label, source, confidence, enabled, added_at, notes`)를 따른다고 가정
- legacy source는 임시 호환 경로이므로 admin check에서는 `warn`으로 표시
- `apps/dashboard/.env.local`은 generated artifact이며 수동 편집 대상이 아님
