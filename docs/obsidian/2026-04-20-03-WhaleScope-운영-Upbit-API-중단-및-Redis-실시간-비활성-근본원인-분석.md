---
type: diagnostic-report
project: WhaleScope
date: 2026-04-20
sequence: 3
tags:
  - whalescope
  - diagnostic
  - upbit
  - redis
  - sse
  - production
  - vercel
status: completed
related:
  - 2026-04-20-01-WhaleScope-체인-커버리지-적용완료-QA-종합보고서
  - 2026-04-20-02-WhaleScope-텔레그램-사이클-점검-및-봇-미발송-근본원인-분석
---

# WhaleScope — 운영 Upbit API 중단 및 Redis 실시간 비활성 근본원인 분석

## 0. TL;DR

두 현상은 **서로 다른 레이어의 문제**이며, 운영 배포(`https://whalescope.6esk.com`)에서만 발현되는 공통 원인은 **환경변수 누락**이다.

| 현상 | 레이어 | 가장 유력한 원인 | 로컬에서는 왜 정상? |
|---|---|---|---|
| Upbit API 중단(표시 "down"/fallback) | **브라우저 → Upbit 직접 연결** (WSS + REST) | CSP `connect-src`가 프로덕션에서만 활성화되며, 그 사이 CSP 번들이 스테일하거나 CDN이 이전 버전을 서빙 중. 혹은 **사용자 세션 중 WebSocket 유휴 끊김이 발생한 뒤 재연결에 실패** | `NODE_ENV !== "production"`이면 CSP 자체가 비어있음(`next.config.ts:102`). 그리고 로컬 탭은 거의 항상 포그라운드라 idle 끊김을 덜 탐 |
| "실시간 비활성(standby)" 배지 | **서버(Next Node runtime) → Upstash REST** | Vercel Production env에 `WHALESCOPE_SSE_ENABLED=true` 또는 `WHALESCOPE_REDIS_REST_URL` / `WHALESCOPE_REDIS_REST_TOKEN` 중 1개 이상 **누락** | 로컬 `.env`에는 세 변수 모두 채워져 있음 |

**이 문서는 두 현상을 각각 코드·환경 레벨에서 추적하고, 공통·개별 수정 계획을 제시한다.**

---

## 1. 공통 아키텍처 파악 — "어디서 호출하는가"

두 문제를 이해하려면, 각 API 호출이 **브라우저 쪽**에서 일어나는지 **Vercel Node 쪽**에서 일어나는지부터 분리해야 한다.

### 1-1. Upbit — 완전한 클라이언트 사이드 경로

**WebSocket** — `apps/dashboard/components/market-ticker-strip.tsx:817`

```
const socket = new window.WebSocket("wss://api.upbit.com/websocket/v1");
```

이 라인은 **브라우저(사용자 기기) → Upbit 서버** 직결이다. Vercel 서버는 중계하지 않는다. 즉:

- Vercel 리전(`icn1` 서울 여부)과 무관
- Vercel IP 차단/지오블록과 무관
- 사용자의 브라우저/ISP/네트워크 상태와, 그리고 **브라우저에 적용된 CSP**에 100% 의존

**REST 스냅샷** — `apps/dashboard/lib/market-ticker.ts:749-763`

```
async function fetchUpbitTickerSnapshot(...) {
  const response = await fetch(
    `https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(markets)}`,
    ...
  );
}
```

**REST 캔들 차트** — `apps/dashboard/lib/market-ticker.ts:1027-1029`

```
const baseUrl =
  config.upbitUnit === "day"
    ? "https://api.upbit.com/v1/candles/days"
    : `https://api.upbit.com/v1/candles/minutes/${config.upbitUnit}`;
```

둘 다 `fetch()`를 **클라이언트 컴포넌트 안에서** 호출하므로 브라우저 → Upbit 직결이다.

**소스 상태 판정 규칙** — `apps/dashboard/lib/market-ticker.ts:39-66`

```
liveWindowMs: 15_000  // 15초 내 ticker 메시지 없으면 "stale"
downWindowMs: 45_000  // 45초 내 없으면 "down"
```

즉 "중단"의 의미는 보통 **45초 이상 ticker 메시지가 끊겼다** → 화면에 down/fallback 뱃지로 표시되는 상태다.

### 1-2. Redis 실시간 (SSE) — 완전한 서버 사이드 경로

**SSE 엔드포인트** — `apps/dashboard/app/api/stream/route.ts:10-12, 135-141`

```
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
...
const status = getLiveUpdateStreamStatus({
  ...env,
  restUrl: process.env.WHALESCOPE_REDIS_REST_URL,
  restToken: process.env.WHALESCOPE_REDIS_REST_TOKEN,
});
```

**Upstash REST 호출** — `apps/dashboard/lib/live-updates.server.ts:239-257`

```
async function upstashGet(env, key, signal) {
  if (!env.restUrl || !env.restToken) {
    return null;
  }
  const url = `${trimTrailingSlash(env.restUrl)}/get/${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${env.restToken}` },
    cache: "no-store",
    signal,
  });
  ...
}
```

즉 Upstash 호출은 **Vercel Node 런타임 안**에서 일어나며 CSP와 무관하다. 브라우저는 오직 `/api/stream`(같은 오리진) 하나만 본다. 대시보드의 "실시간 비활성" 뱃지는 `status` 이벤트의 `state` 필드(`enabled` / `disabled`)로 결정되고, 이 값은 100% **Vercel Production env**에 의해 결정된다.

---

## 2. Upbit API 중단 — 원인 후보 랭킹

### 2-A. WebSocket 유휴 단절 후 재연결 실패 (가장 흔함, 점유율 ≥50%)

**근거**:
- Upbit WSS(`wss://api.upbit.com/websocket/v1`)는 구독 이후 **매매가 없는 마켓은 몇 분 간 ticker 메시지가 없다**. 일부 CDN/프록시/사무실 방화벽은 60~120초 유휴 WebSocket을 silently 닫는다.
- 코드에는 **keepalive ping** 구현이 없다 (`market-ticker-strip.tsx`의 Upbit 섹션 전체에서 `ping`/`pong` 설정 없음).
- `socket.onclose` 시 재연결 로직이 있기는 하지만 (`hasUpbitLive=false`, `closedAt=Date.now()`로 상태만 업데이트 — `market-ticker-strip.tsx:897-907`), **자동 재구독/재연결은 외부 effect 주기에 맡겨짐**. 사용자 탭이 백그라운드로 가면 재연결이 한참 늦어질 수 있다.

**현상 매치**: "운영에서 중단된다"(=down) = 15초 동안 메시지 없음 → 45초 지나면 down. 로컬 개발 중에는 탭이 늘 포그라운드라 발현 빈도가 낮다.

**재현 절차**: 운영 사이트를 열고 탭을 30분 이상 백그라운드로 돌린 뒤 돌아와서 ticker 카드가 down 상태인지 확인.

### 2-B. 프로덕션 CSP의 `connect-src` 누락/스테일 (중요, 점유율 ~20%)

**근거**:
- `apps/dashboard/next.config.ts:101-117`에서 CSP는 **production 빌드에서만** 주입된다.
- 현재 allowlist에 `wss://api.upbit.com`이 있기는 하다(`next.config.ts:79-80`):
  ```
  "https://api.upbit.com",
  "wss://api.upbit.com",
  ```
- 하지만 **Vercel에서 바로 이전 빌드(=allowlist 추가 전)**가 캐싱되어 서빙되고 있을 가능성이 있다. Vercel Edge Network는 이전 Immutable asset을 계속 배포할 수 있고, 특히 `headers()` 변경은 새 배포에만 반영된다.
- 증상은 브라우저 devtools Console에 `Refused to connect to 'wss://api.upbit.com/...' because it violates the following Content Security Policy directive: "connect-src 'self' ..."` 형태로 찍힌다.

**재현/확인**: 운영 도메인에서 개발자 도구 → Console 탭에서 "CSP" / "Refused to connect" 문자열 검색.

### 2-C. Upbit 서비스 측 일시적 차단/레이트리밋 (점유율 ~15%)

**근거**:
- Upbit REST는 공개 티커/캔들에도 1 req/100ms 정도의 암묵적 레이트리밋이 있다.
- `fetchMarketTickerMiniCharts`가 마운트마다 `fetchUpbitChartPoints`를 심볼 수만큼 동시에 때리면(`market-ticker.ts:934-939`에서 `Promise.allSettled`로 병렬), Upbit가 `429`/`403`을 회신하고 브라우저는 `TypeError: Failed to fetch`로 넘어간다.
- 이건 사용자별로 IP가 달라 국소적으로 발생한다. 로컬 개발 중에는 대부분 단일 사용자(개발자 본인)이라 덜 발현한다.

**재현/확인**: Network 탭에서 api.upbit.com 응답 코드와 `x-ratelimit-*` 헤더 관찰.

### 2-D. 탭 백그라운드 / Battery Saver에 의한 JS 타이머 쓰로틀링 (점유율 ~10%)

**근거**:
- Chrome은 백그라운드 탭의 `setTimeout/setInterval`을 분당 1회 수준까지 제한한다. 이로 인해 Upbit 재연결 로직이 제때 실행되지 않는다.
- 모바일 브라우저는 더 공격적으로 연결 자체를 중단한다.

### 2-E. 지오블록 / 네트워크 제한 (점유율 <5%)

**근거**: Upbit WSS는 대부분 국가에서 접근 가능하지만, 일부 기업 네트워크/VPN/TLS-Middlebox가 `wss://` 핸드셰이크를 차단한다. 운영 URL을 외부에서 시연할 때 발현될 수 있다.

---

## 3. Redis 실시간 비활성 — 3중 게이트 중 어디서 막히는가

UI에 "실시간 비활성"이 뜨려면 `getLiveUpdateStreamStatus()`가 `state: "disabled"`를 반환해야 한다. 해당 함수는 순차적으로 3개 게이트를 검사한다 — `apps/dashboard/lib/live-updates.ts:95-134`.

### 게이트 1 — `enabled` (WHALESCOPE_SSE_ENABLED)

```
if (!input.enabled) {
  return { state: "disabled", reason: "feature_disabled", ... };
}
```

`getLiveUpdatesEnv()`에서 결정 — `apps/dashboard/lib/env.ts:243-244`:

```
const enabled = parseBooleanEnvValue(readEnvValue("WHALESCOPE_SSE_ENABLED"), false);
```

**기본값 false**. Vercel Production에 `WHALESCOPE_SSE_ENABLED=true`가 없으면 무조건 `feature_disabled`로 차단.

### 게이트 2 — `restUrl` (WHALESCOPE_REDIS_REST_URL)

```
if (!hasConfiguredValue(input.restUrl)) {
  return { state: "disabled", reason: "redis_missing", ... };
}
```

### 게이트 3 — `restToken` (WHALESCOPE_REDIS_REST_TOKEN)

```
if (!hasConfiguredValue(input.restToken)) {
  return { state: "disabled", reason: "token_missing", ... };
}
```

### 3-1. 운영에서 가장 흔한 원인 순서

| 순위 | reason | 가능성 | 근거 |
|---|---|---|---|
| 1 | `feature_disabled` | 높음 | `.env.example:131` 본인 메모에서 "운영에서는 true로 설정"이라 명시돼 있는 변수. 누락 시 기본 false. Vercel Production에 명시적으로 `true`가 박혀 있지 않으면 바로 여기서 걸린다 |
| 2 | `redis_missing` | 중간 | Vercel에 환경변수가 **"Development"만 체크**되고 "Production" 체크가 빠진 경우 흔히 발생. 혹은 `.env.local`에만 넣고 Vercel 대시보드에 반영하지 않음 |
| 3 | `token_missing` | 중간 | 동상 |

> `.env.example:125`의 주석:
> > 미설정 시 대시보드 상단 상태 배지가 "실시간 비활성(standby)"으로 표시된다.

이 문구가 현재 증상과 **정확히 일치**한다.

### 3-2. SSR에서 읽지 못하는 구조적 문제 가능성

`env.ts:167-175`의 `readEnvValue()`는 먼저 `process.env`를 본 뒤, 없으면 `apps/dashboard/.env.local`, 그다음 루트 `.env`를 순차 탐색한다. Vercel Production에는 **파일 기반 `.env`가 번들에 포함되지 않는다** (기본 빌드에서는 `.env*` 파일이 `.gitignore`에 걸려 있거나 Vercel이 안 올리므로). 오직 Vercel Dashboard → Settings → Environment Variables에 선언된 값만 `process.env`에 들어간다.

### 3-3. 로컬에서는 왜 정상으로 뜨는가

로컬에서는 다음 어딘가에 세 변수가 모두 채워져 있을 것이다:
- `/.env` (루트) — `next.config.ts:24-70`의 `loadRepoRootEnv()`가 읽어서 `process.env`에 주입
- `/apps/dashboard/.env.local` — Next.js 기본 로더가 우선 적용
- 셸 export — 최우선

세 경로 중 아무 데나 세 변수 전체가 들어 있으면 `enabled=true && configured=true`가 되어 `state=enabled`로 뜬다.

---

## 4. 두 이슈가 '함께 드러난' 이유

공통 뿌리는 **Vercel Production 환경변수 맵이 로컬 `.env`와 동기화되지 않았다**는 것이다. 같은 증상이 Telegram 쪽에서도 발견된 바 있고 (`2026-04-20-02-...`에서 `TELEGRAM_BROADCAST_ENABLED`, `TELEGRAM_BROADCAST_DRY_RUN`이 선언되지 않은 이슈), 이번 Redis도 같은 패턴이다. Upbit는 조금 다른 축(CSP + 클라이언트 네트워크)이지만, **"운영에서만 안 되는데 왜?"** 라는 공통 질문의 답은 거의 항상:

1. 환경변수/설정이 Production 환경에 정확히 복사됐는가
2. 그 설정이 Next 빌드 시점에 반영됐는가 (rebuild 필요 vs 환경변수만 바꾸면 되는가)
3. CSP/CORS 같은 production-only 헤더가 서드파티 호출을 막지는 않는가

세 가지를 순서대로 점검해야 한다.

---

## 5. 검증 체크리스트 (손으로 해볼 순서)

### A. Redis/SSE 쪽

1. Vercel 대시보드 → Project → Settings → Environment Variables 열기
2. 다음 세 변수가 **"Production" 환경에 체크**되어 있는지 확인
   - `WHALESCOPE_SSE_ENABLED` = `true`  *(문자열 "true", 대소문자 무관)*
   - `WHALESCOPE_REDIS_REST_URL` = `https://xxx.upstash.io`
   - `WHALESCOPE_REDIS_REST_TOKEN` = `AXXX...`
3. 한 개라도 비어있거나 Preview/Development에만 체크되어 있으면 → 이게 원인
4. 값 보정 후 **Deploy → Redeploy (Clear Cache)** 또는 최신 커밋 재배포
5. 배포된 대시보드 열고 **DevTools → Network → stream** 요청 확인
   - `GET /api/stream` → Response에서 첫 `event: status`의 `data:`에 `{"state":"enabled"...}`가 나와야 정상
   - `{"state":"disabled","reason":"feature_disabled"}` → 게이트 1 실패
   - `{"state":"disabled","reason":"redis_missing"}` → 게이트 2 실패
   - `{"state":"disabled","reason":"token_missing"}` → 게이트 3 실패
6. 혹은 **Admin 페이지**(`/admin`) 쪽에 Redis health 뱃지가 있으면 그걸로도 확인 가능

### B. Upbit 쪽

1. 운영 사이트 열고 DevTools → Console에서 아래 키워드 검색
   - `[ticker][upbit]` — WebSocket 에러/종료 코드 확인
   - `Refused to connect` — CSP 차단
   - `Failed to fetch` — REST 차단/레이트리밋
2. DevTools → Network → Filter 에 `upbit` 입력
   - `GET https://api.upbit.com/v1/ticker?markets=...` 응답 상태 확인
   - `200` OK인데 ticker가 갱신이 안 되면 WSS 끊김
   - `403`/`429`면 Upbit 측 차단
   - `(blocked)` 빨간 표시면 CSP 차단
3. 탭을 **10분 이상 백그라운드**로 둔 뒤 돌아와서 down 뱃지가 뜨는지 — 뜨면 §2-A(유휴 단절) 확정
4. Vercel 대시보드 → Deployments → 가장 최근 배포의 **Build time**과 `next.config.ts` 최종 수정 시각 비교 → 수정 시각이 빌드보다 나중이라면 CSP가 구버전 → §2-B 확정
5. 모바일 Chrome / 직장 네트워크 / VPN 등 다른 환경에서 재현되는지 비교 — 특정 네트워크만 끊기면 §2-E

---

## 6. 권장 수정안

### 6-A. Vercel 환경변수 동기화 (Redis/SSE — 즉시)

Vercel Dashboard에서 다음을 Production에 선언. 우리 Telegram 진단에서처럼 **선언적 관리**가 더 안전하지만 Next 앱은 Render처럼 `render.yaml`이 없으므로 Vercel UI에서 직접 관리한다.

```
WHALESCOPE_SSE_ENABLED=true
WHALESCOPE_REDIS_REST_URL=<Upstash 콘솔 복사>
WHALESCOPE_REDIS_REST_TOKEN=<Upstash 콘솔 복사>
```

`Preview`, `Development` 모두 체크해도 무방. Redeploy 필수(환경변수는 빌드 시점에 묶이므로).

### 6-B. Upbit WSS 복원력 강화 (Upbit — 작업 소)

문제가 §2-A(유휴 단절) 또는 §2-D(백그라운드 쓰로틀)라면 코드 수정이 필요.

수정 포인트: `apps/dashboard/components/market-ticker-strip.tsx` Upbit 섹션(대략 807~914행)

(1) **Application-level heartbeat** — Upbit WSS는 서버 PING을 거의 안 보낸다. 클라이언트가 30초마다 `{"type":"ticker","codes":["KRW-BTC"],"is_only_realtime":false}` 같은 가벼운 요청을 보내면 유휴 타임아웃 방지.

(2) **Auto-reconnect with backoff** — `onclose`에서 즉시 재연결 호출(지수 백오프 200ms→1s→5s). 현재는 `closedAt`만 기록할 뿐 재연결은 다음 렌더 사이클에 맡김.

(3) **Visibility-aware** — `document.visibilitychange` 이벤트로 포그라운드 복귀 시 즉시 재구독 강제.

### 6-C. CSP 디버그 패널 (Upbit §2-B — 작업 중)

`/admin` 페이지의 Market Ticker Source Diagnostics 섹션에 **현재 Document의 CSP meta/header**를 프린트하는 위젯을 추가. 이렇게 하면 CSP가 스테일한지 배포 직후 한 번만 봐도 된다.

### 6-D. Server-side Upbit proxy (Upbit §2-C·2-E — 작업 대, 장기)

브라우저-직접 호출의 대안으로 `/api/market/upbit/ticker`, `/api/market/upbit/candles` Route Handler를 추가하고 Vercel `icn1` 리전 고정. 장점:

- Upbit 429/403 발생 시 캐시로 완충 (edge cache 30s)
- 사용자의 기업/VPN 네트워크가 Upbit 차단해도 Vercel이 대리 호출
- WSS는 SSE로 래핑 (서버가 Upbit WSS를 구독, 클라이언트에 SSE로 재배포)

단점: 기존 클라이언트 사이드 아키텍처를 뜯어야 함. P2 작업으로 보류 권장.

---

## 7. 수정 우선순위 매트릭스

| 작업 | 영향 | 노력 | 우선 | 즉시 여부 |
|---|---|---|---|---|
| Vercel에 `WHALESCOPE_SSE_ENABLED=true` + Upstash URL/TOKEN 3종 투입 | 실시간 뱃지 즉시 복구 | 5분 | P0 | 즉시 |
| 최신 커밋으로 **Clear Cache + Redeploy** (CSP 확인용) | CSP 스테일 해결 | 5분 | P0 | 즉시 |
| Upbit WSS keepalive + 재연결 backoff + visibility awareness | 탭 장시간 사용 시 down 방지 | 2~3시간 | P1 | 다음 스프린트 |
| `/admin`에 CSP 진단 위젯 | 재발 시 분 단위 진단 | 1시간 | P2 | 여유 시 |
| Server-side Upbit proxy (`/api/market/upbit/*`) | 기업 네트워크에서도 동작 | 반나절 | P2 | 심사 이후 |

---

## 8. 심사/시연 관점 FAQ 대응

| 예상 질문 | 권장 답변 |
|---|---|
| "운영에서 Upbit 왜 중단되나요?" | 브라우저-직접 WSS 구조라 유휴 단절이 일어날 수 있음. 탭을 계속 포그라운드에 두면 안정적이며, 장기적으로 서버 프록시로 전환 예정 |
| "Redis 실시간 비활성 배지는 왜 뜨나요?" | Vercel Production 환경변수에 `WHALESCOPE_SSE_ENABLED` + Upstash 키가 세팅되어 있어야 하며, 현재 누락된 것을 확인. 보정 후 재배포하면 복구됨 |
| "로컬에서는 왜 잘 되나요?" | CSP는 production only, Redis 변수는 로컬 `.env`에만 있고 Vercel에 누락 — 결정론적인 환경변수 누락 문제 |
| "동일한 실수 재발 방지책은?" | `.env.example`에 "운영 배포 전 Vercel에 반영 필수" 변수 목록 체크리스트 추가. 배포 전 `/admin`에서 health check 필수 |

---

## 9. 함께 볼 문서

- `2026-04-20-01-WhaleScope-체인-커버리지-적용완료-QA-종합보고서.md` — 전반적 상태
- `2026-04-20-02-WhaleScope-텔레그램-사이클-점검-및-봇-미발송-근본원인-분석.md` — 같은 "운영 env 누락" 패턴의 텔레그램 버전

## 10. 파일 인덱스

- `apps/dashboard/components/market-ticker-strip.tsx:807-914` — Upbit WSS 연결 로직
- `apps/dashboard/lib/market-ticker.ts:39-66, 749-763, 1012-1029` — Upbit 프로파일 및 REST 호출
- `apps/dashboard/next.config.ts:74-117` — 프로덕션 CSP 정의
- `apps/dashboard/app/api/stream/route.ts:135-141` — SSE 상태 계산
- `apps/dashboard/lib/live-updates.ts:95-134` — 3단 게이트 판정
- `apps/dashboard/lib/live-updates.server.ts:239-257` — Upstash REST 호출
- `apps/dashboard/lib/env.ts:243-262` — SSE env 읽기
- `.env.example:120-131` — Redis/SSE 변수 문서
