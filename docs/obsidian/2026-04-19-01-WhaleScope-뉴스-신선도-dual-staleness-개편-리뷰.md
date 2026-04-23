---
type: cowork-session
date: 2026-04-19
sequence: 1
time: "15:00"
status: completed
environment: cowork
tags:
  - cowork-session
  - whalescope
  - dual-staleness
  - multi-perspective-review
  - code-review
  - news-rss
---

# WhaleScope 뉴스 신선도(Dual-Staleness) 개편 — 다관점 리뷰 + 코드 리뷰 종합 보고

## 작업 요약

WhaleScope 대시보드의 뉴스 위젯 "RSS 수집이 N분째 멈춰 있습니다" 경고가 **실제로는 파이프라인이 정상 동작 중이지만 업스트림이 조용해서 뜨던 오탐(誤探)** 문제를 해결했다. 4가지 수정 권고를 함께 반영했다: (1) `lib/news.ts` 경고 카피를 파이프라인 장애 vs 뉴스 사이클 정적을 구분하도록 디스앰비규에이션, (2) `last_seen_at` 컬럼을 `news_feed` 시트에 추가해 중복 해시 히트 시 타임스탬프를 갱신하는 dual-staleness 판정 로직, (3) `POLL_STALE_MINUTES=35`(warn) / `ARTICLE_QUIET_MINUTES=120`(info) 이원 임계값과 `{level, reason, minutes}` 구조화된 staleness 객체를 i18n 키 5개(ko/en)로 분기, (4) `DEFAULT_FEEDS`를 3 → 23 소스로 확장(Top 20 crypto + 3 bonus) + `ThreadPoolExecutor`로 병렬 수집. Python + TypeScript 양측 스키마 parity를 맞추고 self-healing 마이그레이션(`_ensure_news_feed_schema`)으로 기존 시트에도 무중단 적용 가능하게 설계했다.

4개 관점(엔지니어링 / PM·투자자 / UX·디자인 / 스태프 엔지니어 코드리뷰)에서 병렬 평가를 돌린 결과 **평균 6.6/10**. 의도는 맞지만 실행에서 **3건의 블로커(B3 데이터 파손, B4 폴백 레이어링, S3 URL 스킴 검증 부재)**와 **1건의 UX 유출(ops-speak 카피, role="status" 부적절)**이 확인되어 후속 PR로 즉시 반영해야 한다.

## 변경 파일 목록

**Python (수집 파이프라인):**
- `src/storage/schema.py` — `NEWS_FEED_HEADERS`에 `last_seen_at` 추가 (position 11)
- `src/storage/sheets_client.py` — `_column_letter`, `_ensure_news_feed_schema`, `append_news_feed` 재작성(중복 해시 히트 시 `batch_update`로 `last_seen_at` 갱신)
- `src/ingestion/news_rss.py` — `DEFAULT_FEEDS` 3→23, `ThreadPoolExecutor` 병렬화, 튜플 timeout, User-Agent 헤더

**TypeScript (대시보드):**
- `apps/dashboard/lib/schema.ts` — `NewsFeedRow` 인터페이스 + 헤더 튜플에 `last_seen_at`
- `apps/dashboard/lib/news.ts` — 전체 재작성; `NewsStaleness = {level, reason, minutes}`, `getNewsFeedLastPollAt`, `getNewsFeedLastArticleAt`, `decideStaleness` 분리, `tryReadSystemLog()` 폴백
- `apps/dashboard/components/news-widget-client.tsx` — `buildStalenessWarning` switch, `data-level` 속성
- `apps/dashboard/components/news-widget.module.css` — `.warning[data-level="info"]` 색 분기
- `apps/dashboard/lib/i18n/dictionaries/ko.ts` — `warningPipelineStale`, `warningPipelineStaleUnknown`, `warningArticleQuiet`, `warningDerivedStale`, `warningFallback`
- `apps/dashboard/lib/i18n/dictionaries/en.ts` — 동일 5개 영어 키

## 검증 결과

| 단계 | 결과 | 비고 |
|------|------|------|
| Python AST | ✅ PASS | ingestion/storage 모두 파싱 OK |
| `dashboard:typecheck` | ✅ PASS | 타입 오류 0 |
| `dashboard:lint` | ✅ PASS | ESLint 경고 0 |
| `dashboard:build` | ⚠️ TIMEOUT | Exit 143 (SIGTERM, 5분 초과). 로컬 재시도 필요 |
| 신규 테스트 | ❌ 없음 | `decideStaleness` 경계값 테스트 부재(C7 지적 사항) |

---

## 개별 관점 평가

### 1) 엔지니어링 관점 — 7.0 / 10

> CTO/시니어 엔지니어 시각. 실현 가능성과 아키텍처 건전성 중심.

**강점 (3)**
1. **Dual-threshold 분리가 올바른 문제 정의.** "파이프라인 장애"와 "뉴스 사이클 정적"은 원인도 대응도 다르므로 `POLL_STALE_MINUTES` vs `ARTICLE_QUIET_MINUTES`를 분리한 것은 교과서적이다.
2. **Self-healing 마이그레이션.** `_ensure_news_feed_schema`가 기존 시트 헤더 접두 일치를 검사하고 필요한 컬럼만 추가하는 방식은 Google Sheets MVP 단계에서 이상적인 무중단 전략.
3. **관심사 분리.** `getNewsFeedLastPollAt` / `getNewsFeedLastArticleAt` / `decideStaleness`로 함수를 쪼개 단위 테스트 가능성 확보(실제 테스트는 안 붙였지만 구조는 준비됨).

**약점 (5)**
1. **쓰기 증폭(Write Amplification).** 15분 폴 1회당 최대 115행(23 feeds × 5 items)을 `batch_update`로 재기록해서 1-bit "살아있다" 정보를 표현. Sheets API 쿼터(분당 60 writes)를 실수 한 번에 갉아먹을 위험. 장기적으로는 `service_health` 시트 단일 하트비트 행으로 분리해야 함.
2. **동시 마이그레이션 레이스.** `_ensure_news_feed_schema`가 읽기 → 비교 → 쓰기 비원자적이라, 2개 워커가 동시에 실행되면 헤더가 이중 확장될 수 있음. 셀프힐 함수에 idempotency guard나 `last_run` 락이 없음.
3. **system_log 폴백 신뢰도.** `tryReadSystemLog()`는 tolerate-fail 전략이지만 news_feed와 system_log 양쪽 다 비어 있으면 "데이터 없음"과 "파이프라인 장애"를 구별 못 함. 외부 관찰자(예: 크론 모니터링) 없이 자기 자신의 로그로만 판정.
4. **관측성 공백.** `decideStaleness` 결과나 last_seen_at 갱신 성공률에 대한 메트릭/로그 없음. 운영 중에 "이 분기가 왜 탔나"를 사후 재구성 불가.
5. **임계값 매직 넘버.** `35`, `120`이 `news.ts` 상수로 하드코딩. 환경변수나 config 시트로 뽑아 튜닝 실험 가능하게 해야 함.

**핵심 개선 제안 Top 3**
1. **service_health 하트비트 분리** (영향도 高, 액션: `news_feed.last_seen_at` append 대신 `service_health` 단일 행 `last_poll_at` 갱신)
2. **임계값 설정화** (영향도 中, 액션: `POLL_STALE_MINUTES`, `ARTICLE_QUIET_MINUTES`를 `process.env` 또는 `config` 시트에서 로드)
3. **`decideStaleness` 단위 테스트 추가** (영향도 中, 액션: 경계값 0/34/35/119/120/121분 + source 4종 × reason 4종 조합 케이스)

---

### 2) PM/투자자 관점 — 6.0 / 10

> 시니어 PM / 투자자 시각. 우선순위 정합성과 ROI.

**강점 (3)**
1. **실제 신뢰 저하 원인 제거.** "경고가 오탐으로 뜨는 현상"은 유저가 대시보드 신뢰도를 의심하게 만드는 1순위 UX 버그. 올바른 우선순위.
2. **23개 피드 확장으로 콘텐츠 갭 축소.** 이전에 3개 소스였다면 slow-news-cycle 리스크가 실재했음. 이제는 "진짜로 뉴스 사이클이 조용한" 케이스만 남음 → article_quiet 경고가 더 드물고 더 믿을 만해짐.
3. **i18n 우선 적용.** 한국어/영어 양쪽에서 동시에 카피를 바꿔 로컬라이제이션 일관성 확보.

**약점 (5)**
1. **ROI 불명확.** 23개 피드 수집을 위해 Sheets 쿼터 + ThreadPoolExecutor 복잡도를 늘렸지만, "뉴스 커버리지가 몇 % 올라가서 DAU/Engagement가 몇 % 증가하는가" KPI가 없음. 그냥 "더 많이 = 더 좋음" 가설.
2. **Ops-speak 카피 유출.** "RSS 수집 파이프라인이 N분째 돌지 않고 있습니다. 크론/서비스 상태를 확인하세요" — 이건 운영자가 볼 메시지이지 일반 유저가 볼 메시지가 아님. 대시보드가 "누구를 대상으로 하는가" 정체성이 흔들림.
3. **스코프 크립.** 원래 버그는 "경고 오탐 1건" 수정이었는데, PR에 피드 확장 + 스키마 마이그 + ThreadPool이 함께 들어와 리뷰/롤백 단위가 거대해짐. 작은 PR 3개로 쪼갰어야 함.
4. **성공 측정 계획 없음.** "이 변경이 성공했다"를 어떻게 판단하는지 PR 설명에 없음. 경고 노출률 before/after? article_quiet 경고의 유저 dismiss 비율?
5. **국제화 대상 확장성.** ko/en만 있고 3번째 언어가 추가될 때 5개 키가 모두 동기 유지되어야 하는 유지보수 부담. 타입 안전성 보강이 아직 안 됨.

**핵심 개선 제안 Top 3**
1. **PR 분할 (영향도 高).** (a) 경고 카피 수정 + dual threshold, (b) last_seen_at 스키마 마이그, (c) 피드 확장. 각각 별도 리뷰/롤백 가능한 단위로.
2. **KPI 선언 (영향도 高).** 이 PR이 달성하는 지표 명시: "article_quiet 경고 노출 시간 X분 → Y분", "뉴스 위젯 체류 시간 Z초 증가 목표".
3. **카피 유저 톤으로 재작성 (영향도 中).** "뉴스 업데이트가 지연되고 있어요" 같이 운영자 맥락을 노출하지 않는 톤으로 — UX/디자인 관점과도 교차.

---

### 3) UX/디자인 관점 — 6.5 / 10

> 시니어 UX 디자이너 시각. 사용자 지각과 인터페이스 품질.

**강점 (3)**
1. **`data-level` 속성으로 의미 계층 분리.** CSS 속성 선택자로 `[data-level="info"]` 색을 뮤티드로 낮춘 접근은 디자인 토큰 체계 위에서 깔끔하게 확장됨.
2. **fallback 문구가 비어 있지 않음.** "데이터가 아직 없습니다"를 빈 상태로 두지 않고 친절한 유도 카피를 제공.
3. **Warning이 중복 노출되지 않음.** staleness가 `undefined`일 때 `<p>` 자체가 렌더되지 않아 DOM 깔끔.

**약점 (5)**
1. **색 단독 의미 전달 = WCAG 위반 리스크.** warn vs info를 색(bad vs muted)으로만 구분. 적록색맹 유저나 고대비 모드에서는 동일하게 보임. 아이콘(⚠️ vs ℹ️ 수준, 단 Lucide SVG 권장) 또는 프리픽스 텍스트 필요.
2. **`role="status"`의 부적절한 사용.** `role="status"`는 polite live region으로, 반복적/상태 업데이트용. 하지만 여기서는 "Warn: 파이프라인이 죽음"은 assertive 수준의 알림일 수 있고, Info: 조용함"은 live region 자체가 불필요(페이지 로드 시 이미 있는 정적 정보). 분기해서 assertive/statusnone 각각 다르게.
3. **Ops-speak 유출.** "크론/서비스 상태를 확인하세요"를 일반 유저가 보게 됨. 유저의 정신 모델에 "크론"이 없음. → "잠시 후 다시 시도해주세요" 또는 상태 표시 없이 내부 알림으로만.
4. **"조용한 상태로 보입니다" 톤 문제.** 사람이 아닌 인터페이스가 주관 판단을 내리는 형태. "현재 뉴스 업데이트가 없습니다" 같은 사실 기술로 축소.
5. **fallback 문구의 4중 redundancy.** `warningFallback`, `sourceCaptionFallback`, `fallbackItemSummary`, `fallbackItemTitle`이 모두 "데이터 없음"의 변형. 정보 위계가 뭉개져 유저가 "이게 같은 얘기인가?" 혼란.

**대체 카피(ko/en)**

| 상황 | 현재(ko) | 제안(ko) | 현재(en) | 제안(en) |
|------|---------|---------|---------|---------|
| pipeline_stale | RSS 수집 파이프라인이 {minutes}분째 돌지 않고 있습니다. 크론/서비스 상태를 확인하세요. | 뉴스 업데이트가 {minutes}분째 지연되고 있습니다. | The RSS pipeline has not polled for {minutes} minutes. Check the cron / service health. | News updates have been delayed for {minutes} minutes. |
| article_quiet | 파이프라인은 정상이지만 새 기사가 {minutes}분째 도착하지 않았습니다. 뉴스 사이클이 조용한 상태로 보입니다. | {minutes}분 동안 새 기사가 없었습니다. | The pipeline is running, but no new articles for {minutes} minutes — upstream sources look quiet. | No new articles in the last {minutes} minutes. |

**핵심 개선 제안 Top 3**
1. **색 + 아이콘 병행 (영향도 高).** Lucide `AlertTriangle` (warn) / `Info` (info) SVG를 카피 왼쪽에. 접근성 + 브랜드 일관성 동시 해결.
2. **role 분기 (영향도 中).** warn level은 `role="alert"` 고려, info level은 role 제거.
3. **카피 유저 톤 재작성 (영향도 高).** 위 테이블의 제안 카피로 교체. PM 관점과 교차하는 핵심 이슈.

---

### 4) 코드 리뷰 (스태프 엔지니어 관점)

> 변경 파일별 라인 레벨 정합성 검토. 블로커 / 경고 / 스타일로 분류.

#### 🔴 블로커 (머지 전 반드시 수정)

**B3 — 스키마 마이그레이션 데이터 파손 (`sheets_client.py:1124` 부근, `_ensure_news_feed_schema`)**
- **증상**: 기존 시트 헤더가 `NEWS_FEED_HEADERS`보다 **길 경우**(예: 운영자가 수동으로 12번째 컬럼 추가), 함수가 `headers[:len(NEWS_FEED_HEADERS)]` 비교 없이 "헤더가 다르다 → 11번째를 last_seen_at으로 덮어쓴다"로 분기 → **운영자 커스텀 컬럼이 소리 없이 last_seen_at으로 오버라이트**됨.
- **수정**: `if existing_headers[: len(NEWS_FEED_HEADERS) - 1] != NEWS_FEED_HEADERS[:-1]:` → **접두 일치 검사 후 마지막 한 칸만 확인하고 append**로 재구성. 또는 길이가 길면 abort + 수동 마이그레이션 요구.

**B4 — 폴백 체인 레이어링 오류 (`lib/news.ts`, `getNewsFeedLastPollAt`)**
- **증상**: `Math.max(...lastSeenAts, ...fetchedAts)` 방식으로 두 출처를 평탄하게 합침. 의도는 "last_seen_at이 있으면 그걸, 없으면 fetched_at을 폴백"이어야 하는데, 현재 구현은 "둘 중 최댓값"이라 last_seen_at이 **롤백된 상황**(예: 마이그 실패 후 재시도)에서도 fetched_at이 신선하면 판정이 섞임.
- **수정**: 두 배열을 레이어링 — `if (lastSeenAts.length > 0) return max(lastSeenAts); if (fetchedAts.length > 0) return max(fetchedAts); return tryReadSystemLog();` 순서 명시.

**S3 — RSS `item.url`의 URL 스킴 검증 부재 (news-widget-client.tsx:215 `<a href={item.url}>`)**
- **증상**: 악성 RSS 피드가 `javascript:alert(1)` 또는 `data:text/html,<script>` URL을 제공하면 React가 `href`에 그대로 넣고 클릭 시 XSS.
- **수정**: `item.url`을 사용하기 전에 `new URL(item.url)` 파싱 + `['http:', 'https:'].includes(url.protocol)` 검증. 실패 시 `<a>` 대신 `<article>`로 폴백(이미 fallback 분기 존재, 재활용).

#### 🟡 경고 (머지 가능하나 후속 PR로)

- **B5**: `existing[digest]` 딕셔너리가 **중복 해시의 마지막 행만 저장**. 중복이 N개면 나머지 N-1개 `last_seen_at`은 미갱신. `defaultdict(list)`로 전환 후 전부 배치 업데이트.
- **C1**: `decideStaleness`에서 `lastArticleAt`이 `null`일 때 article_quiet 분기를 못 타는데, 이게 의도인지 폴백 리턴인지 주석 없음.
- **C2**: `POLL_STALE_MINUTES=35`는 크론 주기 15분 + 안전 버퍼 2×. 주석으로 derivation 명시 필요.
- **C3**: `tryReadSystemLog`가 실패할 때 silent catch. 적어도 `console.warn`은.
- **C4**: 23개 피드 타임아웃을 단일 튜플로 하드코딩. per-feed override 없음.
- **C5**: ThreadPoolExecutor max_workers를 피드 수와 무관하게 결정. 작은 CI 환경 고려.
- **C6**: `formatDashboardMessage`에 `{minutes}` 치환만 있고 복수형(복수형은 한국어 무시 가능하나 영어 "1 minute" vs "N minutes" 이슈 있음).
- **C7**: **신규 테스트 0건**. 최소 `decideStaleness` 경계값만이라도.

#### 🟢 스타일/디자인 노트

- **D1**: `lib/news.ts`가 350줄 넘음. `decideStaleness`를 `lib/news-staleness.ts`로 분리 가능.
- **D2**: `NewsStaleness` 타입이 export되지만 어디서도 import 안 함 — 실제로 컴포넌트에서 인라인 접근.
- **D3**: CSS `.warning[data-level="info"]` 선택자 특이성(specificity)이 베이스 `.warning`과 동일 → 선언 순서 의존. `&.warning--info` 모디파이어 클래스가 더 안전.
- **D4**: `USER_AGENT` 문자열이 "WhaleScope/0.1" — 1.0 릴리스 전 업데이트 필요.
- **D5**: `_column_letter` 유틸은 `utils/a1.py`로 빼서 재사용 가능.

---

## 종합 점수

| 관점 | 점수 | 한줄 요약 |
|------|------|----------|
| 엔지니어링 | 7.0 / 10 | 구조는 옳으나 쓰기 증폭·관측성·테스트 부재가 숙제 |
| PM/투자자 | 6.0 / 10 | 우선순위는 맞으나 KPI·PR 분할·유저 톤이 부재 |
| UX/디자인 | 6.5 / 10 | 토큰 기반 분기는 좋으나 접근성·카피 유저 톤이 부족 |
| 코드 리뷰 | — | 블로커 3건(B3, B4, S3) 머지 전 수정 필수 |
| **종합** | **6.5 / 10** | 방향은 맞으나 3건 블로커 수정 후 머지. 후속으로 분리 PR 3개 필요 |

---

## 3관점 공통 지적 (즉시 수정)

1. **Ops-speak 카피 유출** — PM + UX 공통. "크론/서비스 상태를 확인하세요"를 유저 톤으로 재작성.
2. **테스트/관측성 부재** — 엔지니어링 + 코드리뷰 공통. `decideStaleness` 단위 테스트 + staleness 분기 로그.
3. **PR 응집도 과잉** — PM + 코드리뷰 공통. 3개 PR로 분할(카피 / 스키마 / 피드 확장).

## 관점별 Top 3 교차 비교

| # | 엔지니어링 | PM/투자자 | UX/디자인 | 코드 리뷰 |
|---|----------|----------|----------|----------|
| 1 | service_health 하트비트 분리 | PR 분할 | 색 + 아이콘 병행 | B3 스키마 데이터 파손 수정 |
| 2 | 임계값 설정화 | KPI 선언 | role 분기 | B4 폴백 레이어링 수정 |
| 3 | `decideStaleness` 단위 테스트 | 카피 유저 톤 | 카피 유저 톤 재작성 | S3 URL 스킴 검증 |

**교차 관찰**: "카피 유저 톤 재작성"은 PM + UX에서 공통, "테스트 추가"는 엔지니어링 + 코드리뷰에서 공통 → **이 2건이 최우선**.

---

## 종합 액션 플랜 (우선순위순)

### 즉시 반영 (후속 PR #1 — 블로커 수정)

1. **B3 스키마 마이그레이션 안전화**: `_ensure_news_feed_schema` 접두 일치 + 길이 초과 시 abort
2. **B4 폴백 레이어링 수정**: `getNewsFeedLastPollAt`을 if/else 계단식으로 명시
3. **S3 URL 스킴 검증**: `item.url`을 `http(s):`로 제한
4. **카피 유저 톤 재작성 (ko/en 5키)**: UX 테이블의 제안 카피 반영
5. **`decideStaleness` 단위 테스트 추가**: 경계값 6케이스 × reason 4종

### 가능하면 반영 (후속 PR #2 — 관측성/접근성)

6. **임계값 env화**: `POLL_STALE_MINUTES`, `ARTICLE_QUIET_MINUTES`를 `.env`로
7. **Lucide 아이콘 병행**: warn `AlertTriangle`, info `Info`
8. **`role` 분기**: warn은 `alert`, info는 role 제거
9. **관측성 로그**: `decideStaleness` 분기 결과를 서버 로그로
10. **B5 중복 해시 전수 갱신**: `defaultdict(list)` 전환

### 장기 검토 (아키텍처 PR)

11. **`service_health` 시트 분리**: `news_feed.last_seen_at` 쓰기 증폭 제거, 단일 하트비트 행으로
12. **KPI 계측**: "article_quiet 경고 노출 시간", "뉴스 위젯 체류 시간" 수집
13. **`lib/news.ts` 모듈 분리**: `lib/news-staleness.ts`로 decideStaleness 이전

---

## 심사위원/의사결정자 예상 질문

| 질문 | 권장 대응 |
|------|----------|
| "경고가 오탐이었다는 걸 어떻게 확인했나?" | 기존 `warningNewsFeedStale`가 15분 크론 + 뉴스 조용 시간이 겹치면 항상 뜨던 사례를 로그로 재현. dual threshold 도입 후 pipeline_stale은 35분, article_quiet는 120분으로 분리. |
| "왜 피드를 23개까지 늘렸나? ROI는?" | 정답 없음 — KPI 선언이 빠진 스코프 크립. 후속 PR로 분리하고 "뉴스 위젯 체류 시간 / 유저 클릭률" 지표 설정 예정이라고 답변. |
| "Sheets API 쿼터 한계는?" | 분당 60 writes. 23피드×5items = 115행을 15분당 1회 배치. 현재는 여유 있으나 피드 확장 시 `service_health` 분리 필요(장기 PR). |
| "스키마 마이그는 되돌릴 수 있나?" | 현재 `_ensure_news_feed_schema`는 forward-only. B3 수정 후에는 길이 초과 시 abort + 수동 마이그 가이드. 롤백 스크립트 별도 제공 고려. |
| "보안 리스크는 없는가?" | S3(URL 스킴 검증 부재)가 XSS 경로. 후속 PR #1에서 수정. RSS 피드 23개는 모두 공신력 있는 소스만 선정. |

---

## 복원 컨텍스트

> 다음 세션에서 이 노트를 읽으면 아래 내용만으로 후속 PR을 바로 시작할 수 있어야 한다.

**현재 상태**: `apps/dashboard/` + `src/` 양측 변경 완료. typecheck/lint/AST PASS, build는 timeout(환경 이슈로 추정, 로컬 재시도 필요). 머지 전 블로커 3건(B3/B4/S3) 수정이 강제.

**바로 시작할 후속 PR #1 작업 리스트**:
1. `src/storage/sheets_client.py` `_ensure_news_feed_schema` 함수에서 `existing_headers`가 `NEWS_FEED_HEADERS`보다 길 경우 abort 또는 접두만 비교하도록 재작성
2. `apps/dashboard/lib/news.ts` `getNewsFeedLastPollAt`를 if/else 계단식으로 재구성 (last_seen_at → fetched_at → system_log 순서 명시)
3. `apps/dashboard/components/news-widget-client.tsx` 215번 줄 근처 `<a href={item.url}>` 앞에 `isSafeUrl(item.url)` 가드 추가, 유틸 함수는 `lib/url.ts`에 신설
4. ko/en 5개 키를 UX 테이블의 제안 카피로 교체 (`warningPipelineStale`, `warningPipelineStaleUnknown`, `warningArticleQuiet`)
5. `apps/dashboard/lib/news.test.ts` 신규 생성, `decideStaleness` 경계값 6케이스 + source 4종 × reason 4종

**PR 분할 플랜** (후속):
- PR #2: env화 + Lucide 아이콘 + role 분기 + B5
- PR #3 (장기): `service_health` 시트 분리, `lib/news-staleness.ts` 추출

**참고 파일 경로**:
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/apps/dashboard/lib/news.ts`
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/apps/dashboard/components/news-widget-client.tsx`
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/apps/dashboard/components/news-widget.module.css`
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/apps/dashboard/lib/i18n/dictionaries/{ko,en}.ts`
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/src/storage/sheets_client.py`
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/src/storage/schema.py`
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/src/ingestion/news_rss.py`
