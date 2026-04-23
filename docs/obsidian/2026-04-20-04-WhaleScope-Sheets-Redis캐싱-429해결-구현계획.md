---
type: project-plan
project: WhaleScope
date: 2026-04-20
sequence: 4
time: "15:50"
status: ready-to-implement
tags:
  - whalescope
  - infrastructure
  - redis
  - caching
  - rate-limit
  - google-sheets
---

# WhaleScope Google Sheets → Redis 캐싱 레이어 도입 계획

## 배경

### 문제 정의

Google Sheets API `RATE_LIMIT_EXCEEDED` (HTTP 429)가 프로덕션에서 반복 발생.

```
"quota_metric": "sheets.googleapis.com/read_requests"
"quota_limit": "ReadRequestsPerMinutePerUser"
"quota_limit_value": "60"
"consumer": "projects/353697475315"
```

증상:
- 뉴스 섹션이 비어서 내려옴
- 큐레이션 감시 지갑 상세 모달 빈 데이터
- 고래 스토리 패널 미표시
- `[sheets/readDashboardSnapshotSafe] batchGet failed, falling back per-tab` → per-tab도 전부 429

### 원인 분석

**1차 원인: 대시보드 1회 로드 = 10~15 sheet read 호출**

호출 분포 (대시보드 `/` 로드 기준):
- `readDashboardSnapshotSafe` batchGet 1회 (6 탭 묶음)
- batchGet 실패 시 per-tab fallback 6회
- `news.ts` 내부 `readSheetRows("news_feed" | "system_log" | "daily_brief" | "signals")` 4회
- `curated-wallets.ts` 오버라이드 로드 1회
- `metrics.ts` 개별 `readSheetRows("transactions" | "signals" | "system_log")` 3회

→ 정상 경로(batchGet 성공)에서 8~9회, fallback 경로에서 14~15회.

**2차 원인: in-memory 캐시는 Vercel 서버리스에서 부분적으로만 동작**

방금 `1c9c5ae` 커밋에서 도입한 45초 TTL Map 캐시는 단일 Node.js 프로세스 내에서만 유효. Vercel Function은:
- 리전별 / 동시성별로 인스턴스가 여러 개 스폰
- 콜드 스타트 시 모듈 상태 초기화
- 함수 타임아웃 후 인스턴스 폐기

→ 동시에 10개 인스턴스가 뜨면 최악의 경우 10배 쿼터 소비. 로컬 단일 프로세스 dev에선 0건으로 떨어지지만 프로덕션에선 여전히 한계에 닿을 수 있음.

**3차 원인: Google Cloud 프로젝트 기본 쿼터가 60/분/사용자로 빡빡함**

서비스 어카운트 1개 = 사용자 1개 = 60req/min 버킷. 상향 요청 가능하나 1~2일 소요.

### 기존 자산

`.env` 및 `lib/live-updates.server.ts`에 Upstash Redis REST 연결 이미 구비:

```env
WHALESCOPE_REDIS_REST_URL=https://comic-peacock-102007.upstash.io
WHALESCOPE_REDIS_REST_TOKEN=gQAAAAAAAY53...
```

현재 용도: SSE 실시간 업데이트 이벤트 polling (`lib/live-updates.server.ts:239 upstashGet`).

캐시 저장소로는 미사용 → 재활용 가능.

---

## 목표 및 비목표

### 목표 (In-Scope)

- [ ] Google Sheets 읽기 호출을 Upstash Redis에 캐싱하여 Vercel 서버리스 인스턴스 간 공유
- [ ] 429 에러 근본 해결: 대시보드 트래픽과 무관하게 Sheets API 호출을 안정적 상한으로 묶음
- [ ] 기존 in-memory 캐시는 L1(프로세스 내) 로 유지하여 같은 인스턴스 연속 호출은 Redis 왕복도 생략
- [ ] Redis 장애 시 graceful degradation: 기존 경로(직접 Sheets 호출)로 폴백
- [ ] 쓰기 API (`upsertWatchlistOverride`) 후 해당 탭 캐시 무효화

### 비목표 (Out-of-Scope)

- DB 전환 (Postgres/Supabase) — 별도 장기 과제
- Google Cloud 쿼터 상향 요청 — 사용자가 직접 수행 (별도 태스크)
- 시트 구조 변경 / 컬럼 스키마 개편
- 쓰기 경로 성능 최적화

---

## 설계

### 캐싱 아키텍처 (2-tier)

```
Request
  ↓
L1: in-memory Map (프로세스 내, TTL 45s)
  ↓ miss
L2: Upstash Redis REST (공유, TTL 60s)
  ↓ miss
Origin: Google Sheets API
  ↓ 성공
L2 SET + L1 SET + 반환
```

**L1 (기존, 유지)**
- `Map<SheetTabName, TabCacheEntry>` in `lib/sheets.ts`
- TTL 45초
- 같은 프로세스 내 연속 요청의 Redis 왕복 제거

**L2 (신규)**
- Key: `whalescope:sheet:tab:{tabName}` (예: `whalescope:sheet:tab:transactions`)
- Key: `whalescope:sheet:batch:dashboard` (batchGet 결과)
- Value: JSON 직렬화된 row 배열
- TTL 60초 (L1 보다 조금 길게 — L1 expire 후에도 L2 히트 가능하도록)
- Redis SET 시 `EX 60` 옵션

### 키 설계

| Key | 내용 | TTL |
|-----|------|-----|
| `whalescope:sheet:tab:transactions` | transactions 탭 전체 row | 60s |
| `whalescope:sheet:tab:daily_brief` | daily_brief 탭 전체 row | 60s |
| `whalescope:sheet:tab:signals` | signals 탭 전체 row | 60s |
| `whalescope:sheet:tab:system_log` | system_log 탭 전체 row | 60s |
| `whalescope:sheet:tab:subscribers` | subscribers 탭 전체 row | 60s |
| `whalescope:sheet:tab:tg_whale_events` | tg_whale_events 탭 전체 row | 60s |
| `whalescope:sheet:tab:news_feed` | news_feed 탭 전체 row | 60s |
| `whalescope:sheet:tab:watchlist_overrides` | 오버라이드 탭 | 60s |
| `whalescope:sheet:batch:dashboard` | 6-탭 배치 스냅샷 | 60s |

네임스페이스 `whalescope:sheet:` 접두사로 기존 라이브 업데이트 이벤트 키(`whalescope:live-update:*`)와 충돌 방지.

### 신규 모듈 구조

```
apps/dashboard/lib/
├── sheets.ts                    (기존, L1 캐시 유지, 내부에서 redis-cache 호출)
├── redis-cache.ts               (신규, Upstash REST GET/SET/DEL 래퍼)
└── live-updates.server.ts       (기존, 영향 없음)
```

**`lib/redis-cache.ts` API 설계**

```ts
export async function redisCacheGet<T>(
  key: string,
  signal?: AbortSignal,
): Promise<T | null>

export async function redisCacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
  signal?: AbortSignal,
): Promise<void>

export async function redisCacheDelete(
  key: string,
  signal?: AbortSignal,
): Promise<void>

export function isRedisCacheConfigured(): boolean
```

구현 특징:
- `getLiveUpdatesEnv()`와 같은 env 소스 사용하여 URL/토큰 중복 정의 회피
- Redis 실패 시 조용히 `null` 반환 + `console.warn` (throw 금지 — 원본 데이터 경로 살아야 함)
- 2초 타임아웃 (AbortController) 걸어서 Redis 느릴 때 원본 경로 빨리 폴백
- JSON 직렬화/역직렬화 내장

### 캐시 무효화 시나리오

| 이벤트 | 무효화 키 |
|--------|-----------|
| `upsertWatchlistOverride()` 호출 | `whalescope:sheet:tab:watchlist_overrides` + `whalescope:sheet:batch:dashboard` |
| 대시보드 리버밸리데이트 (수동 트리거) | `whalescope:sheet:*` 전부 (Upstash `SCAN` + `DEL`) |
| 일반 운영 (조회) | 무효화 없이 TTL 만료 대기 |

### 실패 모드 설계

| 실패 | 동작 |
|------|------|
| Redis REST 연결 실패 | L2 스킵, 원본 Sheets 호출 (기존 경로) |
| Redis GET timeout (2s 초과) | L2 스킵 |
| Redis SET 실패 | L1 + 반환은 정상, L2 업데이트만 스킵 (로깅) |
| Sheets 429 | 기존 `1c9c5ae` 커밋의 10분 stale cache 폴백 (L1 한정) → 추가로 L2 stale 폴백도 구현 가능 |
| Redis 데이터 역직렬화 실패 | `null` 리턴하여 미스 처리, 원본 호출 |

---

## 구현 단계

### Phase 1: Redis 캐시 유틸 (30분)

- [ ] `apps/dashboard/lib/redis-cache.ts` 신규 작성
- [ ] `live-updates.server.ts`에서 `getLiveUpdatesEnv` 타입 재사용
- [ ] `redisCacheGet` / `redisCacheSet` / `redisCacheDelete` / `isRedisCacheConfigured` export
- [ ] 2초 타임아웃 + AbortController
- [ ] JSON serialize/parse + 실패 시 null 리턴 로깅

### Phase 2: `readTab` L2 캐시 주입 (30분)

- [ ] `lib/sheets.ts` `readTab` 내부:
  - L1 히트 → 즉시 반환 (현재 동작 유지)
  - L1 미스 → L2(`whalescope:sheet:tab:{tab}`) 확인
  - L2 히트 → L1 set + 반환
  - L2 미스 → Sheets fetch → L1 set + L2 set + 반환
- [ ] `readTabs` (batchGet) 내부:
  - L1 batch 히트 → 반환
  - L1 미스 → L2(`whalescope:sheet:batch:dashboard`) 확인
  - L2 히트 → L1 batch set + 개별 L1 탭 set + 반환
  - L2 미스 → Sheets batchGet → L1/L2 모두 set + 반환

### Phase 3: 쓰기 무효화 (15분)

- [ ] `upsertWatchlistOverride` 완료 후 L1 + L2 무효화
  - L1: `tabCache.delete('watchlist_overrides')` + `batchCache = null`
  - L2: `redisCacheDelete('whalescope:sheet:tab:watchlist_overrides')` + batch 키도 삭제

### Phase 4: 관측성 / 관리자 가시화 (20분)

- [ ] `getDashboardAuthResult` 레벨까진 불필요
- [ ] `/api/debug/dashboard` 응답에 캐시 히트/미스 카운터 노출 (선택)
- [ ] console 로그: `[redis-cache] hit|miss|error key=...` (debug level)

### Phase 5: 테스트 및 검증 (30분)

- [ ] 로컬 dev에서 동일한 페이지 10회 연속 호출 시 Sheets API 호출 1회만 발생하는지 확인
- [ ] Redis REST URL/Token 없애고 기동 → 기존 경로로 정상 동작하는지 확인 (graceful degrade)
- [ ] `design-check.mjs` 재실행 → 429 console error 0건 확인
- [ ] watchlist 오버라이드 토글 후 감시 리스트 즉시 반영 확인 (캐시 무효화 동작)
- [ ] Vercel 프리뷰 배포 → 429 재현 안 되는지 확인

### Phase 6: 배포 (5분)

- [ ] Git 커밋 메시지: `feat(dashboard): add Upstash Redis L2 cache for Google Sheets reads`
- [ ] main 푸시 → Vercel 자동 배포
- [ ] 배포 후 admin health 엔드포인트로 source_health `connected:true` + 장시간 관찰

---

## 예상 효과

**캐시 적용 전** (현재):
- 대시보드 1회 로드 = 8~15 Sheets read
- 동시 50 유저 / 분당 = 400~750 read/min
- 쿼터 한계(60/min/user) 즉시 돌파

**캐시 적용 후**:
- 60초당 1회 batchGet (= 6탭) + 2~3회 단일 탭 = 최대 9 read/min
- 유저/인스턴스 수와 무관하게 상한 고정
- 예비 마진 51 read/min 확보

---

## 리스크 및 완화

| 리스크 | 가능성 | 영향 | 완화 |
|--------|--------|------|------|
| Redis 비용 증가 | 낮음 | 낮음 | Upstash free tier 1만 req/day 포함. TTL 60s + 50 유저 가정 시 약 7~8만 req/day 초과 가능. Pro plan 고려 |
| Redis 장애 | 낮음 | 중 | graceful degrade 내장, 원본 경로로 폴백 |
| stale 데이터 | 중 | 낮음 | 60초 TTL이라 최악 60초 지연. 라이브 업데이트 SSE는 별도 경로로 즉시 트리거 |
| 캐시 무효화 누락 | 중 | 중 | 쓰기 경로(watchlist override) 1곳만 존재하여 명시적 처리. TTL로도 60초 내 자정 |
| 데이터 직렬화 크기 | 낮음 | 낮음 | 탭별 최대 수백 KB 예상. Upstash REST 요청 크기 제한 1MB 내 |

---

## 롤백 전략

1. 문제 발생 시 `lib/redis-cache.ts`의 `isRedisCacheConfigured()`를 `false` 반환으로 강제
2. 또는 env에서 `WHALESCOPE_REDIS_REST_URL` 삭제/치환
3. 기존 L1 캐시만 동작 → 현재 운영 상태와 동등

코드 롤백: 해당 커밋 `git revert` 1번이면 되는 구조 유지 (단일 피처 커밋).

---

## 완료 기준 (Definition of Done)

- [ ] `design-check.mjs` 전 페이지 console error 0건 (429 부재)
- [ ] Vercel 프로덕션 `/admin/health` 응답 연속 30분 `connected:true` + failure 0건
- [ ] Google Cloud 콘솔 Sheets API 사용량 그래프에서 분당 호출 < 15 확인
- [ ] Redis REST 환경변수 제거 시 dev 기동 정상 + 데이터 로딩 정상
- [ ] watchlist override 토글 시 1초 내 감시 리스트 반영

---

## 관련 파일

- 구현: `apps/dashboard/lib/sheets.ts`, `apps/dashboard/lib/redis-cache.ts` (신규)
- 참조: `apps/dashboard/lib/live-updates.server.ts` (Upstash REST 호출 패턴)
- 환경: `apps/dashboard/.env:127-128`
- 테스트: `scripts/design-check.mjs`
- 직전 관련 커밋: `1c9c5ae` (L1 캐시 추가), `434f14b` (timezone hydration 수정)

---

## 결정 로그

- **2026-04-20**: DB 전환 대신 Redis 캐싱 선택. 이유:
  - Redis 이미 연결 완료 (추가 인프라 비용 0)
  - 과제(데모) 스코프 대비 DB 설계/싱크/마이그레이션 오버엔지니어링
  - Sheets를 ops team CMS로 계속 활용 가능 (편집 UX 유지)
  - 로그인 유저나 쓰기 트래픽 증가 시점에 DB 재검토
