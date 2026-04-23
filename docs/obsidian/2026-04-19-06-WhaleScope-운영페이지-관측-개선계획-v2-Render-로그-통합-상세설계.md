---
date: 2026-04-19
sequence: 6
time: "17:00"
project: WhaleScope
repo: /Users/basilry/Projects/02015_reuton_whale
type: operations-observability-plan
version: v2
supersedes: "[[2026-04-19-04-WhaleScope-운영페이지-관측-개선계획-Render-로그-통합]]"
related:
  - "[[2026-04-18-15-WhaleScope-v5-개선계획-Render-단일소스-UI-UX]]"
  - "[[2026-04-18-09-WhaleScope-페이지-정보구조-운영-사용자-분리-보고서]]"
  - "[[2026-04-18-08-WhaleScope-Render-워커-웹서버-배포가이드]]"
  - "[[2026-04-19-05-WhaleScope-UX-개선계획]]"
  - "[[2026-04-19-03-WhaleScope-장애대응-및-개선-이행계획]]"
assignment: Wrtn Technologies Product Engineer 과제 전형
tags:
  - WhaleScope
  - operations
  - observability
  - Render
  - admin
  - v2
  - detailed-design
---

# WhaleScope 운영페이지 관측 개선계획 v2 — Render 로그 통합 상세설계

## 0. 메타 정보 · v1 대비 변경 요약

### 0.1 문서 포지셔닝

이 문서는 `2026-04-19-23-WhaleScope-운영페이지-관측-개선계획-Render-로그-통합.md` (이하 v1, 283줄 / 10,738 bytes, 13개 섹션)을 대체·고도화한다. v1은 "무엇을 왜 해야 하는가"를 정립한 **방향 문서**였고, v2는 "어떻게 구현·검증·운영할 것인가"까지 내려간 **실행 설계 문서**다.

v1은 유지되며, 방향·원칙의 원본 근거로 계속 참조 가능하다. 구현자(엔지니어·QA·운영자)는 v2를 읽고 작업한다.

### 0.2 v1 → v2 주요 확장 포인트

| 영역 | v1 상태 | v2 확장 |
|---|---|---|
| §1 문서 목적 | 3-축 관측 필요성 서술 | v2 스코프·비-스코프 명시, 성공 지표 정의 |
| §2 현재 상태 | "있는 것 / 없는 것" 리스트 | 코드 경로 표기, 운영자 현재 증상 6가지, Blind spot 매트릭스 |
| §3 개선 방향 | 3계층 분리 원칙 | 계층간 교차 판단 규칙, 설계 원칙 10개로 구체화 |
| §4 화면 구조 | 섹션 A/B/C 대상 나열 | 섹션 A/B/C/D 카드별 ASCII wireframe, 정보 우선순위 기준, 에러 표시 패턴 |
| §5 기술 설계 | Source of Truth 분리 설명 | `data flow` 다이어그램, `lib/metrics.ts`와 `lib/render.ts` 책임 분리 계약 |
| §6 데이터 모델 | `service_health` 필드 8개 나열 | DDL-등가 스키마 v2, 마이그레이션 3단계, backfill 전략, `deploy_log` 신규 탭 제안 |
| §7 Render 연동 | API 엔드포인트 링크 | 엔드포인트별 요청/응답 JSON 예시, 에러 taxonomy, 재시도·백오프, Render rate limit 계약 |
| §8 `/admin` 확장 | TypeScript 타입 3개 | Discriminated union 기반 타입 14개, 에러 타입, 상태 전이 타입 |
| §9 캐싱·비용 | 캐시 있어야 한다 서술 | 실제 TTL 매트릭스, $/month 비용 모델, 장기 캐싱 결정 트리 |
| §10 구현 단계 | Phase 1~3 | Phase 1~4 + 각 Phase 수용 기준(acceptance criteria, Given/When/Then) |
| §11 QA 기준 | 기능·운영 QA | 단위/통합/계약/e2e 테스트 매트릭스, 테스트 더블 전략 |
| §12 리스크 | 4개 리스크 + 대응 한 줄 | 10개 리스크 + 영향도·가능성·detect/respond 세부 |
| §13 결론 | 최종 목표 3문항 | 운영자 질문 10개에 대한 `/admin` 최종 응답 매핑 |
| 신규 §14 | — | 상태 기계 (서비스 status 전이도 + 플랫폼×애플리케이션 교차 매트릭스) |
| 신규 §15 | — | 에러/경고 분류 체계 (8개 error class, 표시 템플릿) |
| 신규 §16 | — | 보안·시크릿·감사 정책 (RENDER_API_KEY 수명주기, 감사 로그) |
| 신규 §17 | — | 관측성 - logging/metrics/tracing 표준, `/admin` self-observation |
| 신규 §18 | — | 롤아웃 플랜 (feature flag, 단계별 노출, 롤백 절차) |
| 신규 §19 | — | 런북 - 빈발 장애 5종에 대한 단계별 대응 |
| 신규 §20 | — | 접근성·타임존·i18n 처리 |
| 부록 A | — | Render API 엔드포인트 요약표 (쿼리·응답 필드) |
| 부록 B | — | Sheets `service_health` v2 스키마 헤더·타입 정의 |
| 부록 C | — | 커밋/PR 분할 제안 (4 PR로 분리, 각 PR별 파일·테스트·롤백) |

### 0.3 전제 조건(v2 읽기 전)

- 독자는 v1 전체를 숙지했다.
- 독자는 관련 문서 3개(v5 Render 단일소스, IA 분리 보고서, Render 배포 가이드)의 결론에 동의한다.
- Render 계정에 `whalescope-pipeline`(Cron), `whalescope-listener`(Worker), `whalescope-bot`(Worker) 3개가 존재한다.
- `/admin` 라우트가 이미 살아 있다 (308 redirect 포함 IA 정리 완료).
- Sheets 탭 10종(`transactions`, `signals`, `daily_brief`, `news_feed`, `tg_whale_events`, `broadcast_log`, `brief_cost_ledger`, `system_log`, `service_health`, `channel_health`, `llm_budget_log`)이 모두 존재한다.

### 0.4 변경 불가 / 변경 가능 범위

| 항목 | 결정 상태 | 비고 |
|---|---|---|
| IA: `/` 사용자 홈, `/admin` 운영 | 확정 (v1/IA 보고서) | v2에서 변경하지 않음 |
| Source of Truth: Sheets(원장) + Render API(플랫폼) | 확정 | v2의 근간 |
| Render 서비스 개수: 3개(Cron+Worker×2) | 확정 (배포 가이드) | v2에서 변경하지 않음 |
| `/admin` 노출 범위: 내부 접근 전용 | 확정 | 공개 API로 개방하지 않음 |
| `service_health` 스키마 확장 필드 목록 | v2에서 확정 제안 | §6에서 구체화 |
| Render 로그 표시 범위(건수·시간창·폴링 주기) | v2에서 확정 제안 | §9, §12에서 구체화 |
| 에러 메시지 한/영 병기 여부 | 열린 질문 | §20에서 논의, 기본 한국어 |

---

## 1. 문서 목적

### 1.1 핵심 질문

운영 페이지(`/admin`) 하나를 보고 운영자가 아래 질문 **10개 모두**에 답할 수 있어야 한다. 현재는 3~4개만 답 가능하다.

1. 최근 24시간 동안 실제로 어떤 데이터가 몇 건 쌓였는가?
2. 어떤 탭이 지연·공백 상태인가? 그 지연은 얼마나 오래 지속되었는가?
3. 각 파이프라인 job(`signals`, `news_rss`, `brief` 등)은 마지막으로 언제 성공했는가?
4. 마지막으로 실패한 job은 무엇이고, 실패 사유는 무엇인가?
5. Telethon listener와 Telegram bot은 현재 auth 상태·heartbeat 상태가 정상인가?
6. Render 플랫폼에서 3개 서비스는 각각 live/deploying/suspended/error 중 어느 상태인가?
7. 마지막 배포는 언제 무엇을 배포했고, 그 배포는 성공했는가?
8. 각 서비스의 인스턴스는 몇 개이고, 언제 기동됐는가?
9. 최근 15분~1시간의 서비스별 raw 로그 중 경고/오류는 어떤 게 있는가?
10. 어떤 워커가 죽었을 때, 그 영향으로 어떤 Sheets 탭이 stale하게 되었는가?

### 1.2 스코프 (v2에서 다룬다)

- `/admin`의 **정보 구조 재설계** (섹션 A/B/C/D).
- **`service_health` 스키마 확장** (8개 필드 추가).
- **`apps/dashboard/lib/render.ts`** 신규 모듈 (5개 함수, 에러·캐시 처리 포함).
- **Render API 계약** (요청/응답 JSON 예시, 에러 taxonomy, rate limit 대응).
- **TypeScript 타입 시스템** (discriminated union, 에러 타입, 상태 전이 타입).
- **캐싱 전략** (TTL 매트릭스, 비용 모델).
- **롤아웃·롤백** (feature flag, 단계별 노출).
- **테스트 전략** (단위/통합/계약/e2e).
- **런북** (빈발 장애 5종).

### 1.3 비-스코프 (v2에서 다루지 않는다)

- `/` 사용자 홈 UI/UX 개선 → 별도 문서(`2026-04-19-WhaleScope-UX-개선계획.md`).
- 장애 대응 전반의 글로벌 개선 → `2026-04-19-WhaleScope-장애대응-및-개선-이행계획.md`.
- 자체 Python web service 추가 → 배포 가이드 §5 "선택안" 주제. v2에서는 Cron+Worker×2 구조를 전제한다.
- Render Blueprint(`render.yaml`) 생성·관리 자동화 → 배포 가이드 §6. v2는 Dashboard 수동 생성 또는 기존 blueprint 재사용 전제.
- Telegram bot/listener 내부 로직 변경 → 다른 문서 범위.
- LLM 비용 최적화(MonthlyBudgetGuard 등) → v5 Render 단일소스 문서.

### 1.4 성공 지표

v2 구현 완료 후, 아래 지표로 성공을 측정한다.

| 지표 | 기준값 | 측정 방법 |
|---|---|---|
| `/admin`에서 §1.1 10개 질문 답 가능 비율 | 10 / 10 (100%) | QA 체크리스트 (§21) |
| `/admin` 페이지 로드 p95 (Render API 캐시 hit 시) | < 800ms | Vercel Analytics |
| `/admin` 페이지 로드 p95 (캐시 miss 시) | < 2500ms | Vercel Analytics |
| Render API 월간 호출 수 | < 50,000 | 내부 계측 log (§17) |
| Render API 월간 예상 비용 | $0 (free tier 내) | Render Dashboard |
| 1주일 운영 후 "Render Dashboard를 직접 열어본 횟수" | ≤ 2회 | 운영자 셀프 리포트 |
| 에러 원문(raw exception) UI 노출 사고 | 0건 | 보안 감사 (§16) |

---

## 2. 현재 상태 심층 진단

### 2.1 이미 구현된 것 (근거 파일 경로 포함)

| 영역 | 상태 | 근거 |
|---|---|---|
| Sheets 기반 원장 10개 탭 | 운영 중 | `src/storage/sheets.py`, `scripts/init_sheets.py` |
| `service_health` 탭 (v1 스키마) | 운영 중 | `src/storage/sheets.py` Sheet 정의, `pipeline.run_all` 내 heartbeat 기록 |
| `system_log` 탭 (이벤트 로그) | 운영 중 | `src/storage/sheets.py`, 모든 pipeline·listener·bot에서 기록 |
| `pipeline.run_all` 시간-aware 디스패처 (`*/15 * * * *`) | 운영 중 | `src/pipeline/run_all.py`, v5 문서 참고 |
| `/admin` 페이지 (Sheets 기반 요약) | 운영 중 | `apps/dashboard/app/admin/page.tsx`, `apps/dashboard/lib/metrics.ts` |
| `/insights` → `/` 308 리다이렉트 | 운영 중 | `apps/dashboard/next.config.ts` rewrite/redirect |
| Render 서비스 3개 (cron+worker×2) | 배포 중 | Render Dashboard, `render.yaml`(있다면) 또는 수동 생성 |
| `MonthlyBudgetGuard` (LLM $15/월) | 운영 중 | `src/router/budget.py`, v5 문서 |

### 2.2 아직 없는 것

| 영역 | 현재 상태 | v2 목표 |
|---|---|---|
| `수집 데이터 현황`과 `플랫폼 현황`의 분리된 정보 카드 | 혼재 (Sheets 중심) | 섹션 A/B/C 분리 |
| Render 서비스 live/deploying/error 상태 조회 | `/admin`에서 불가능 | `listRenderServices()` + 카드 |
| 최근 deploy 내역 (시각·상태·커밋) | `/admin`에서 불가능 | `listRenderDeploys()` + 카드 |
| 인스턴스 수·state·startedAt | `/admin`에서 불가능 | `listRenderInstances()` + 카드 |
| 최근 raw Render 로그 20~50줄 | `/admin`에서 불가능 | `listRenderLogs()` + 패널 |
| `service_health` 확장 필드 | 없음 | §6 확장 스키마 |
| 플랫폼↔애플리케이션 교차 상태 판단 | 없음 (수동) | §14 교차 매트릭스 |
| 에러 원문 노출 차단 가드 | 불명확 | §11 에러 taxonomy + §16 감사 |
| Render API 호출 캐싱 | 해당 없음 (아직 호출 안함) | §9 TTL 매트릭스 |

### 2.3 운영자가 현재 겪는 구체 증상 6가지

(v1은 "Render Dashboard를 따로 열어야 한다"만 언급. v2는 실제 증상을 구체화)

**증상 1.** `transactions` 탭에 오늘 00:00 이후 행이 없음. 운영자는 `/admin`에서 "데이터가 stale"까지만 안다. 이게 (a) pipeline cron이 실패한 것인지, (b) 소스 API(Etherscan) 장애인지, (c) Render 플랫폼이 배포 중이라 skip인지 구분할 수 없다.

**증상 2.** `telethon_listener` heartbeat가 5분 이상 없음. `/admin`은 "listener stale"까지만 표시한다. 이게 (a) TELETHON_SESSION_STRING 만료인지, (b) Render worker가 OOM으로 재시작 중인지, (c) Telegram 측 rate limit인지 구분할 수 없다.

**증상 3.** `broadcast_log`에 `skip(no_subscribers)`만 10시간째 누적. 이게 실제 구독자가 0인 건지, bot worker가 `getChatMember` 호출을 실패해서 skip으로 떨어진 건지 확인하려면 Render Dashboard의 bot worker 로그를 직접 열어야 한다.

**증상 4.** 방금 git push한 변경이 Sheets에 반영 안 됨. 운영자는 (a) 배포가 됐는지, (b) 됐다면 언제 됐는지, (c) 배포 후 첫 cron이 돌았는지를 알고 싶다. 현재는 Render Dashboard에서 deploy 탭 열어 확인.

**증상 5.** LLM 비용이 $15 cap 근처인데, 어느 slot(brief/stories)이 비용을 쓰고 있는지 `brief_cost_ledger`를 열어 계산해야 함. `/admin` 요약은 누적 금액만 표시, slot별 분해가 없다.

**증상 6.** `signals`는 정상 적재되지만 `daily_brief`가 비어 있음. brief slot이 guard에 의해 skip된 것인지, provider가 모두 실패해 fallback도 실패한 것인지, 단순 네트워크 실패인지 `/admin`에서 알 수 없다.

### 2.4 Blind Spot 매트릭스

아래 표의 "X"가 현재 `/admin`에서 판정 불가한 항목이다.

| 운영 판단 항목 | Sheets | `service_health` | `system_log` | Render Dashboard | 현재 `/admin` |
|---|---|---|---|---|---|
| 데이터 적재 건수 (24h) | O | — | — | — | O |
| 탭별 최신 ts | O | — | — | — | O |
| job별 마지막 성공/실패 ts | 부분 | 부분(heartbeat만) | O | — | 부분 |
| 실패 원인 요약 | — | 부분(`details`) | O | O (raw log) | X |
| listener auth 상태 | — | `config_required` 등 | O | O | 부분 |
| Render 서비스 live 여부 | — | — | — | O | **X** |
| 최근 deploy 시각/상태 | — | — | — | O | **X** |
| 인스턴스 상태 | — | — | — | O | **X** |
| 최근 15분 raw 로그 | — | — | 부분(앱 로그만) | O (플랫폼+앱) | **X** |
| 플랫폼 down인데 Sheets 정상 상황 식별 | — | — | — | O | **X** |
| 비용 slot별 분해 | `brief_cost_ledger` 세부 | — | — | — | 요약만 |

### 2.5 판정: v2가 해결해야 할 최소 4개 구멍

위 매트릭스에서 "**X**"(굵은 X) 4개가 v2의 **must-fix**이다.

1. Render 서비스 live/deploying/error 표시.
2. 최근 deploy 내역.
3. 인스턴스 상태.
4. 최근 15분~1시간 raw 로그.

나머지 "부분"은 v2에서 §6 스키마 확장과 §5 UI 재구성으로 **nice-to-have**로 커버한다.

---

## 3. 개선 방향

### 3.1 3계층 분리 원칙

v1과 동일하되, 각 계층의 **책임 경계**를 코드 레벨로 못박는다.

#### 계층 1. 수집 데이터 (Data Layer)

- **질문**: "무엇이 쌓였는가?"
- **원천**: Google Sheets 원장 (7 탭: `transactions`, `signals`, `daily_brief`, `news_feed`, `tg_whale_events`, `broadcast_log`, `brief_cost_ledger`).
- **담당 모듈**: `apps/dashboard/lib/metrics.ts` 또는 이를 대체할 `apps/dashboard/lib/data.ts` (Sheets 읽기 전담).
- **캐시**: Next.js `revalidate: 30` 또는 `unstable_cache` TTL 30초.
- **에러 처리**: Sheets 인증 실패 시 해당 카드만 빈 상태, 다른 카드는 영향 없음.

#### 계층 2. 워커 / 파이프라인 (Worker Layer)

- **질문**: "어느 job이 정상으로 돌고 있는가?"
- **원천**: Sheets (`service_health`, `system_log`, `channel_health`).
- **담당 모듈**: `apps/dashboard/lib/health.ts` (`service_health` + `system_log` join, stale 판정).
- **캐시**: `revalidate: 15`.
- **에러 처리**: `service_health` 없으면 "데이터 없음"으로 graceful 표시.

#### 계층 3. 플랫폼 (Platform Layer)

- **질문**: "Render 서비스는 실제로 어떻게 떠 있는가?"
- **원천**: Render REST API.
- **담당 모듈**: `apps/dashboard/lib/render.ts` (신규).
- **캐시**: endpoint별 TTL 매트릭스 (§9).
- **에러 처리**: env 미설정, API 키 만료, 서비스 ID 미존재, rate limit 각각 다른 메시지 (§15 taxonomy).

### 3.2 계층 간 교차 판단 규칙

세 계층을 단순히 나란히 보여주는 것이 아니라, **조합 판정**을 해서 "무엇이 실제 원인인지"를 알려주는 것이 v2의 차별점이다.

아래 3가지 교차 상태는 **자동 판정**되어 섹션 D "상관관계 패널"에 표시된다.

#### 교차 규칙 C1 — "플랫폼 live인데 데이터 stale"

조건: 서비스가 `live` AND `service_health.job`의 last_success_at이 stale 기준 초과.
해석: 플랫폼은 살아있으나 애플리케이션 레벨에서 소스 API 실패·guard skip·로직 오류 중 하나.
표시: `"서비스는 떠 있으나 데이터 처리에 실패. system_log 확인 필요"`.
링크: `system_log` 최근 50줄 패널로 deep-link.

#### 교차 규칙 C2 — "플랫폼 deploying 또는 suspended"

조건: 서비스가 `live`가 아님.
해석: stale의 **정당한 사유**가 있음. 알람을 격하한다.
표시: `"Render 배포 중(약 3분 전 deploy 시작). 데이터 공백은 일시적일 수 있음"`.

#### 교차 규칙 C3 — "플랫폼 live이면서 Sheets도 정상, 그러나 최근 로그에 ERROR 다수"

조건: 서비스 `live` AND last_success 정상 AND 최근 로그에 `level=error` N개 이상.
해석: intermittent 오류, retry로 성공 중. 주의 필요하나 긴급 아님.
표시: `"최근 15분간 error 8건 관찰됨. 샘플 아래 로그 참조"`.

### 3.3 설계 원칙 10개

v1의 원칙 2개(§3.2)를 확장. 이 원칙들은 v2 구현 시 **모든 PR review의 체크리스트**로 사용.

1. **데이터가 있는가 ≠ 서비스가 살아있는가 ≠ 코드가 맞는가**. 세 질문을 같은 카드에 섞지 않는다.
2. **Sheets는 정규화된 운영 이벤트만 적재한다**. Render raw log를 Sheets에 쌓지 않는다.
3. **Render API 응답을 장기 저장하지 않는다**. 읽을 때만 조회, 캐시는 메모리 단기.
4. **에러 원문을 UI에 노출하지 않는다**. 항상 taxonomy 기반 정제 메시지 (§15).
5. **시크릿은 server-only**. `NEXT_PUBLIC_*` 접두사로 내보내지 않는다.
6. **env 미설정은 장애가 아니라 정상 fallback이다**. "설정 필요" 상태로 명시.
7. **시간은 모두 UTC로 저장, KST로 표시한다**. 변환은 UI 경계에서 한 번만.
8. **카드별 독립 실패**. 한 카드가 실패해도 다른 카드는 렌더한다.
9. **사람 언어로 말한다**. "status=4" 대신 "배포 실패: 의존성 설치 오류".
10. **관측 자체도 관측 대상이다**. `/admin`이 Render API를 부르는 것도 계측한다 (§17).

### 3.4 원칙 적용 예시

원칙 9의 예시:

| 내부 상태 | 잘못된 UI 문구 | v2 원칙 준수 문구 |
|---|---|---|
| `status=degraded, error=http_401` | "401 Unauthorized" | "Render API 인증 실패. RENDER_API_KEY 만료 또는 삭제 가능성. 갱신 절차는 런북 §19.2 참고." |
| `status=config_required` | "TELETHON_SESSION_STRING missing" | "Telethon 세션 미설정. Render 환경변수에 TELETHON_SESSION_STRING 등록 필요." |
| `status=down, heartbeat_age=3600s` | "stale 3600s" | "파이프라인이 1시간째 응답 없음. 최근 배포 또는 Render 장애 가능성." |

원칙 6의 예시: Render API 미설정 시 섹션 C를 전체 숨기는 것이 아니라, "**Render 통합이 설정되지 않았습니다. 관리자에게 `RENDER_API_KEY` 등록을 요청하세요**"를 명시적으로 표시.

---

## 4. 목표 화면 구조

### 4.1 정보 아키텍처 트리

```
/admin
├── 헤더 — 서비스명, 환경(prod), 현재 시각(KST), 마지막 데이터 기준 시각
├── 섹션 A. 수집 데이터 현황 (Sheets)
│   ├── 카드 A1. 7-탭 적재 현황 요약 (24h row 증가량)
│   ├── 카드 A2. 탭별 최신 레코드 타임스탬프 테이블
│   └── 카드 A3. 비용/예산 (brief_cost_ledger + llm_budget_log)
├── 섹션 B. 워커 / 파이프라인 상태 (service_health + system_log)
│   ├── 카드 B1. pipeline.run_all 상태 (cron 관측)
│   ├── 카드 B2. pipeline job별 상세 (signals, news_rss, brief, stories, broadcast_*, channel_health)
│   ├── 카드 B3. telethon_listener 상태
│   ├── 카드 B4. telegram bot 상태
│   └── 카드 B5. 최근 실패 이벤트 10건 (system_log where level=error)
├── 섹션 C. Render 플랫폼 상태 (Render API)
│   ├── 카드 C1. 서비스 3개 상태 요약 (live/deploying/suspended/error)
│   ├── 카드 C2. 최근 배포 내역 (서비스별 최근 3건)
│   ├── 카드 C3. 인스턴스 상태 (서비스별 instance list)
│   └── 카드 C4. 최근 Render 로그 패널 (서비스 필터, 최근 15분, 30~50줄)
└── 섹션 D. 상관관계 / 판정 (Cross-layer)
    ├── 카드 D1. 교차 상태 경보 (교차 규칙 C1~C3 결과)
    ├── 카드 D2. "지금 무슨 문제가 있는가" 요약 (사람 언어)
    └── 카드 D3. 런북 링크 (해당 상태에 맞는 §19 런북 deep-link)
```

### 4.2 섹션 A — 수집 데이터 현황

#### 카드 A1. 7-탭 적재 현황 요약

```
┌─ 수집 데이터 요약 (24h) ───────────────────────────────┐
│                                                         │
│  탭              │ 오늘 증가 │ 최근 적재          │ 상태   │
│  transactions    │    1,284 │  2분 전           │ ✅정상 │
│  signals         │       42 │  12분 전          │ ✅정상 │
│  daily_brief     │        1 │  3시간 전         │ ✅정상 │
│  news_feed       │       18 │  8분 전           │ ✅정상 │
│  tg_whale_events │        7 │  45분 전          │ ⚠️지연 │
│  broadcast_log   │        6 │  3시간 전         │ ✅정상 │
│  brief_cost_ledger│       1 │  3시간 전         │ ✅정상 │
│                                                         │
│  ℹ️ 지연 기준: 각 탭 고유 SLA (아래 참고)             │
│     transactions: 15min  signals: 30min                 │
│     daily_brief:  8h     news_feed: 60min              │
│     tg_whale_events: 30min  broadcast_log: 8h          │
└─────────────────────────────────────────────────────────┘
```

**정보 우선순위**: 상태 → 증가량 → 최근 적재. "상태"가 가장 왼쪽이면 색상만으로 이상 탐지 가능.

#### 카드 A2. 탭별 최신 레코드 테이블

각 탭의 최신 1~3개 레코드를 압축 표시. `transactions`면 hash/from/to/value, `signals`면 rule/score/asset, `daily_brief`면 날짜/tokens/cost 요약. "Sheets로 이동" 버튼으로 원장 딥링크.

#### 카드 A3. 비용 / 예산

```
┌─ LLM 비용 (월간) ─────────────────────────────────┐
│                                                    │
│  4월 누적   : $3.42 / $15.00  (22.8%)             │
│  ██████░░░░░░░░░░░░░░░░░░░░░░░░░                  │
│                                                    │
│  Slot 분해                                         │
│    brief   : $2.85  (27 runs)                      │
│    stories : $0.57  (19 runs)                      │
│                                                    │
│  예상 월말 : $8.20 (현재 추세 유지 시)            │
│                                                    │
│  Guard 상태: active (cap=$15, enforce=true)        │
└────────────────────────────────────────────────────┘
```

근거: `brief_cost_ledger` 월간 합계, `llm_budget_log`의 최신 entry.

### 4.3 섹션 B — 워커 / 파이프라인 상태

#### 카드 B1. pipeline.run_all (cron 관측)

```
┌─ pipeline.run_all ──────────────────────────────────────┐
│ 상태: ✅ healthy                                         │
│ 마지막 heartbeat: 2분 전 (2026-04-19 16:58 KST)          │
│ 마지막 성공      : 2분 전                                │
│ 마지막 실패      : —                                     │
│ 최근 7일 성공률 : 96.4% (673/698)                        │
│ 평균 소요        : 42s                                   │
│ 현재 슬롯        : HH=16, MM=45~59 → signals+news_rss   │
│ 다음 슬롯        : 17:00 signals+curated_balance        │
└──────────────────────────────────────────────────────────┘
```

#### 카드 B2. Pipeline job 상세

테이블 형태. 각 row = 1 job. 컬럼: `job`, `status`, `last_success`, `last_fail`, `last_err`, `processed (last_run)`, `lag`, `duration`.

- Row 예시: `signals | ✅ | 12m ago | 6h ago (429 ratelimit) | 14 | 0s | 3.2s`
- Row 예시: `brief   | ⏭ skip | 3h ago | — | — | $0.12 | 8m ago | 14.2s (guard: within cap)`
- Row 예시: `stories | ⚠️ degraded | 14h ago | 2h ago (provider_error) | 0 | 2h lag | 9.1s (last err: anthropic 503)`

컬럼은 §6에서 확장할 `service_health` v2 필드에 직접 대응한다.

#### 카드 B3. telethon_listener

```
┌─ telethon_listener ─────────────────────────────────┐
│ 상태: ✅ healthy                                     │
│ 마지막 heartbeat : 48초 전                            │
│ 세션              : string (expires unknown)          │
│ 채널              : @whale_alert_io                  │
│ 최근 1h 메시지    : 23건 처리                         │
│ 마지막 경고       : —                                │
└──────────────────────────────────────────────────────┘
```

상태가 `config_required`일 때 표시:

```
┌─ telethon_listener ─────────────────────────────────┐
│ 상태: ⚙️ config_required                             │
│ 사유: TELETHON_SESSION_STRING 환경변수 누락           │
│ 조치: Render 대시보드 → whalescope-listener →        │
│       Environment → TELETHON_SESSION_STRING 등록     │
│ 런북: §19.3                                          │
└──────────────────────────────────────────────────────┘
```

#### 카드 B4. telegram bot

구조는 B3와 유사. 추가 필드: "활성 구독자 수" (Sheets `subscribers` 탭 행 수), "최근 1h 명령 처리량".

#### 카드 B5. 최근 실패 이벤트 10건

`system_log` WHERE `level=error` ORDER BY `ts DESC` LIMIT 10.

### 4.4 섹션 C — Render 플랫폼 상태

#### 카드 C1. 서비스 3개 상태

```
┌─ Render 서비스 ─────────────────────────────────────────┐
│                                                          │
│  ● whalescope-pipeline     cron                         │
│    상태: 🟢 live                                        │
│    마지막 deploy: 4h 전 (d-1234abc, ✅ live)            │
│    schedule: */15 * * * * UTC                          │
│                                                          │
│  ● whalescope-listener     worker                       │
│    상태: 🟢 live                                        │
│    마지막 deploy: 1d 전 (d-5678def, ✅ live)            │
│    instances: 1 (running since 22h ago)                │
│                                                          │
│  ● whalescope-bot          worker                       │
│    상태: 🟡 deploying                                   │
│    진행 배포: d-9012ghi (started 3분 전)                │
│    이전 live: d-3456jkl (1d 전)                        │
│                                                          │
│  [Render 대시보드 열기 →]                              │
└──────────────────────────────────────────────────────────┘
```

#### 카드 C2. 최근 배포 내역

서비스별 최근 3건. 시각, deploy id, status, commit message(가능하면), trigger.

#### 카드 C3. 인스턴스 상태

```
┌─ 인스턴스 ─────────────────────────────────────────────┐
│                                                         │
│  whalescope-listener                                    │
│    • i-abc123  running   2026-04-18 19:12 UTC (+22h)   │
│                                                         │
│  whalescope-bot                                         │
│    • i-def456  starting  2026-04-19 07:55 UTC (3m ago) │
│                                                         │
│  whalescope-pipeline (cron)                             │
│    • (최근 실행) i-xyz789  succeeded  16:45 UTC         │
│    • (최근 실행) i-xyz788  succeeded  16:30 UTC         │
└─────────────────────────────────────────────────────────┘
```

#### 카드 C4. 최근 Render 로그 패널

- 상단: 서비스 필터 (3개 체크박스) + 시간창 선택 (15m / 1h / 6h; 기본 15m).
- 본문: 시각 + 서비스명 + level + message의 tail 30~50줄, 최신이 위.
- 인터랙션: 특정 줄 클릭 시 해당 시각 전후 10줄 확장. "전체 보기"는 Render Dashboard deep-link.

```
┌─ 최근 로그 (15m) ──────────────────────────────────────┐
│ [ ✅ pipeline ] [ ✅ listener ] [ ✅ bot ]             │
│ 창: (15m) (1h) (6h)                                    │
│                                                         │
│ 16:58:12  pipeline  info   run_all start slot=signals  │
│ 16:58:14  pipeline  info   fetched 12 txs              │
│ 16:58:17  pipeline  info   wrote 12 rows to sheets     │
│ 16:58:02  listener  info   heartbeat ok                │
│ 16:57:48  bot       warn   429 Too Many Requests       │
│ ...                                                     │
│                                                         │
│ [Render에서 전체 보기 →]                              │
└─────────────────────────────────────────────────────────┘
```

### 4.5 섹션 D — 상관관계 / 판정

#### 카드 D1. 교차 상태 경보

교차 규칙 C1~C3이 발동되면 여기에 표시. 없으면 `"현재 교차 이상 없음"`.

```
┌─ 교차 경보 ────────────────────────────────────────────┐
│ ⚠️ 규칙 C1 발동                                         │
│   플랫폼: whalescope-pipeline live (정상)              │
│   데이터: signals 72분 lag (SLA 30min 초과)             │
│   판정: 플랫폼은 정상이나 애플리케이션 처리 실패        │
│   최근 실패 원인: source_name=etherscan, 429           │
│   권장 조치: ETHERSCAN_API_KEY quota 확인 (런북 §19.1) │
└─────────────────────────────────────────────────────────┘
```

#### 카드 D2. 자연어 요약

전체 상태를 1~3 문장으로.

- 정상: `"모든 서비스 정상. 최근 24시간 오류 0건."`
- 경고: `"tg_whale_events 지연 중. listener는 live지만 Telegram 채널 rate limit 가능성."`
- 장애: `"whalescope-bot 배포 실패(d-9012ghi). 이전 버전 live로 fallback. 원인: build error."`

#### 카드 D3. 런북 링크

현재 상태에 해당하는 §19 런북의 해당 절을 강조 표시.

### 4.6 에러 표시 패턴

`/admin`에서 발생할 수 있는 에러는 크게 4분류(§15 참조). 각 분류의 UI 패턴:

| 분류 | 영향 범위 | UI 패턴 |
|---|---|---|
| Network/transient | 해당 카드만 | 카드 내 "일시적 오류. 잠시 후 자동 재조회" + retry 버튼 |
| Config missing | 해당 카드만 | 카드 내 "설정 필요. 관리자에게 문의" + 설정 가이드 링크 |
| Auth failure | 해당 카드만 (같은 API 쓰는 카드 모두) | 카드 내 "API 인증 실패. RENDER_API_KEY 만료 가능성" |
| Internal error | 해당 카드만 | 카드 내 "내부 오류 발생 — err_id: xxxx". raw 오류 숨김 |

---

## 5. 기술 설계

### 5.1 Source of Truth 분리 계약

v1에서 방향을 정했고, v2는 **모듈 경계와 인터페이스**를 정한다.

#### 데이터 흐름 다이어그램

```
┌─────────────┐       ┌─────────────────────┐
│ Google      │       │ Render              │
│ Sheets      │       │ (Platform)          │
│ (10 tabs)   │       │ - services          │
│             │       │ - instances         │
└──────┬──────┘       │ - deploys           │
       │              │ - logs              │
       │              └──────────┬──────────┘
       │                         │
       ▼                         ▼
┌─────────────────────────────────────┐
│ apps/dashboard/lib/                 │
│ ┌──────────┐ ┌─────────┐ ┌────────┐ │
│ │ data.ts  │ │health.ts│ │render  │ │
│ │ (Sheets  │ │(Sheets  │ │.ts     │ │
│ │  data    │ │ service │ │(Render │ │
│ │  layer)  │ │ _health)│ │ API)   │ │
│ └────┬─────┘ └────┬────┘ └───┬────┘ │
│      └───────────┬──────────┘       │
│                  ▼                  │
│        ┌──────────────────┐         │
│        │ correlate.ts      │         │
│        │ (cross-layer      │         │
│        │  rules C1~C3)     │         │
│        └────────┬──────────┘         │
└─────────────────┼────────────────────┘
                  ▼
     ┌────────────────────────────┐
     │ app/admin/page.tsx         │
     │ + Section A/B/C/D cards    │
     └────────────────────────────┘
```

#### 모듈 책임 계약

| 모듈 | 책임 | 의존 | 금지 |
|---|---|---|---|
| `lib/sheets-client.ts` | Google Sheets 인증·읽기 전담 | `googleapis` | Render API 호출 금지 |
| `lib/data.ts` | Sheets 원장 → 데이터 카드용 DTO | `sheets-client` | Render API 직접 호출 금지 |
| `lib/health.ts` | `service_health` + `system_log` → 워커 상태 DTO | `sheets-client` | Render API 직접 호출 금지 |
| `lib/render.ts` | Render API 호출·파싱·캐시 | `fetch` (Node 내장) | Sheets 호출 금지 |
| `lib/correlate.ts` | data+health+render 결과 합쳐 교차 상태 계산 | 위 3개 | raw API 호출 금지 |
| `app/admin/page.tsx` | 서버 컴포넌트 + 카드 조립 | 위 4개 | 내부 로직 계산 금지 (단순 렌더링) |

#### 왜 `lib/metrics.ts`를 대체하지 않고 분할하는가

현 `lib/metrics.ts`는 Sheets 전반을 담당하며 `/admin`이 혼자 쓴다. v2는 비즈니스 로직을 `data.ts`(데이터 카드)와 `health.ts`(워커 상태)로 분리해 각 카드가 자기 소스만 읽도록 책임을 좁힌다. 기존 `metrics.ts`는 Deprecated 플래그를 달고 `data.ts`/`health.ts`에서 흡수 완료 후 제거한다.

### 5.2 왜 Render 로그를 Sheets에 적재하지 않는가

v1 §5.2 답변을 구체화.

- Render API 로그는 1요청당 최대 100줄, 시간창 최대 30일까지 조회 가능하지만, 서비스당 분당 수십~수백 줄이 나올 수 있다. 월간 적재 시 수백만 줄이 되어 Sheets 한계(셀 1천만, 열 1만 8천 — Google 문서 기준)에 빠르게 근접한다.
- Sheets append는 API quota(사용자당 1분 60req, 프로젝트당 1일 10만)에 걸린다. Render 로그 tail을 Sheets에 실시간 복제하는 건 quota 폭발의 가능성이 크다.
- Render 로그는 플랫폼 retention이 존재(현재 workspace plan 기준 일정 기간). 운영 판단에는 최근 15분~1시간만으로 충분.
- 운영 판단에서 정작 중요한 것은 Sheets에 이미 쌓인 **정규화된 이벤트**(`system_log`의 `error` level, `service_health`의 `last_failure_at`)이다. Render raw log는 그 이벤트의 **보조 재현**이다.

결론: Render 로그는 "읽을 때만 당겨서 보여주는" UI 전용 데이터이고, Sheets와 이중 저장하지 않는다.

### 5.3 네이밍·컨벤션

- 파일: kebab-case (`render.ts`, `service-health.ts`).
- 함수: camelCase (`listRenderServices`, `getServiceHealth`).
- 타입: PascalCase (`AdminRenderService`, `ServiceHealthRow`).
- DTO suffix: `...Row`(Sheets 원 row 매핑), `...Dto`(UI 카드용), `...Rsp`(Render API 원 응답).

---

## 6. 데이터 모델 개선안

### 6.1 `service_health` v1 → v2 스키마 변경

#### 현재 v1 필드

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `ts` | ISO 8601 UTC | 기록 시각 |
| `service` | string | `pipeline`, `telethon_listener`, `telegram_bot` 등 |
| `component` | string | `run_all`, `signals`, `brief` 등 |
| `status` | string | `healthy`, `degraded`, `waiting`, `down`, `config_required` |
| `heartbeat_key` | string | 슬롯 키, 예: `signals@2026-04-19T16:45Z` |
| `details` | string | 메시지 |
| `error` | string | 최근 에러 요약 |

#### v2에서 추가할 필드 8개

| 컬럼 | 타입 | 설명 | nullable |
|---|---|---|---|
| `instance_id` | string | Render instance id (알 수 있는 경우) | ✅ |
| `job_name` | string | 상위 `component`와 구분되는 세부 job (예: `source=etherscan`) | ✅ |
| `last_success_at` | ISO 8601 UTC | 이 row와 같은 (service, component) 조합의 최근 성공 시각 | ✅ |
| `last_failure_at` | ISO 8601 UTC | 같은 조합의 최근 실패 시각 | ✅ |
| `processed_count` | integer | 이 run에서 처리한 레코드 수 | ✅ |
| `lag_seconds` | integer | 예상 실행 시각 대비 지연 (음수면 이상) | ✅ |
| `duration_ms` | integer | 이 run의 실측 소요 ms | ✅ |
| `source_name` | string | 외부 의존 소스 식별 (etherscan, binance, solscan 등) | ✅ |

### 6.2 DDL-등가 (Sheets 헤더 기반)

Google Sheets에는 엄격 DDL이 없지만, `scripts/init_sheets.py` 레벨에서 헤더 순서·이름을 고정한다.

```
service_health (v2 headers, 15 columns)
+----+----+---------+-----------+----------+---------------+---------+-------+
| ts | service | component | status | heartbeat_key | details | error |
+----+---------+-----------+--------+---------------+---------+-------+
| instance_id | job_name | last_success_at | last_failure_at |
+-------------+----------+-----------------+-----------------+
| processed_count | lag_seconds | duration_ms | source_name |
+-----------------+-------------+-------------+-------------+
```

추가 시 `scripts/init_sheets.py`에 헤더만 확장. 기존 row는 새 컬럼이 빈칸으로 유지된다.

### 6.3 마이그레이션 전략 3단계

#### Step 1. 읽기 하위 호환

- `health.ts`의 `ServiceHealthRow` 타입에서 v2 필드를 모두 optional로 선언.
- v1 row도, v2 row도 모두 파싱 가능.
- v1 row는 확장 필드가 `undefined` → UI는 "—" 표시.

#### Step 2. 쓰기 이중화 (cutover window)

- Python `SheetsClient.append_service_health` 시그니처를 확장. 기본값 `None`으로 v2 필드 받기.
- 기존 call site는 변경 불필요 (암묵적 None 전달).
- 업데이트 대상 call site만 순차 확장. 우선순위:
  1. `pipeline.run_all` 메인 dispatcher
  2. `pipeline.signals`, `pipeline.news_rss`, `pipeline.brief`, `pipeline.stories`
  3. `telethon_listener` heartbeat
  4. `telegram bot` heartbeat
- 각 단계에서 Sheets 스키마는 변경 없음 (이미 Step 1에서 헤더 확장).

#### Step 3. 과거 데이터 backfill (선택, 불필요할 가능성 큼)

- 과거 row에 v2 필드를 소급 채우는 것은 가능하지만 비용 대비 효용 낮음.
- 운영 판단에 필요한 창은 "최근 24h~7d"이고, 그 범위는 Step 2 완료 후 자연히 v2 스키마로 채워진다.
- 결론: backfill 생략.

### 6.4 Write 책임 경계

| 필드 | 기록 시점 | 기록 주체 |
|---|---|---|
| `ts` | 매 heartbeat | 모든 pipeline/listener/bot |
| `service`, `component` | 매 heartbeat | 위와 동일 |
| `status` | 매 heartbeat | 위와 동일 |
| `details`, `error` | 실패 또는 중요 이벤트 | 위와 동일 |
| `instance_id` | 가능할 때(Render env에서 읽기) | 위와 동일 |
| `job_name`, `source_name` | job이 source 의존일 때 | 해당 pipeline만 |
| `last_success_at` | 성공 종료 시 | 해당 pipeline만 |
| `last_failure_at` | 실패 종료 시 | 해당 pipeline만 |
| `processed_count` | 매 run | 해당 pipeline만 |
| `lag_seconds` | 매 run | run_all dispatcher |
| `duration_ms` | 매 run | run_all dispatcher |

### 6.5 신규 탭 제안: `deploy_log` (선택)

Render API의 deploy 조회를 매번 하지 않고 **이벤트 테이블**로 남기면 운영 판단 속도가 빠르다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `ts` | UTC | 기록 시각 |
| `service` | string | Render 서비스명 |
| `deploy_id` | string | `d-xxxx...` |
| `status` | string | `created / build_in_progress / live / failed / canceled` |
| `commit_sha` | string | git 커밋 해시 (Render가 제공) |
| `commit_message` | string | 짧게 trim |
| `trigger` | string | `push / manual / rollback` |
| `duration_ms` | integer | 배포 소요 ms |

쓰기 주체: `lib/render.ts`가 polling으로 변경을 감지해 append 하거나, Render Deploy Hook webhook을 `/api/render-hook`에서 수신 후 append.

v2 범위에서는 **선택 기능**으로 둔다. Phase 4에서 구현.

### 6.6 스키마 변경 롤백 플랜

- v2 컬럼은 모두 append-only. 제거 시 헤더 삭제 → 기존 데이터는 남지만 UI가 읽지 않는다.
- 읽기 측은 v2 필드를 optional로 처리하므로 컬럼 유무에 독립적.
- 즉, **Sheets 헤더 원상 복구만으로 롤백** 완료.

---

## 7. Render 연동 설계 (API 계약 상세)

### 7.1 인증

Render API는 Bearer Token 방식.

```
Authorization: Bearer <RENDER_API_KEY>
Accept: application/json
User-Agent: whalescope-admin/1.0
```

### 7.2 환경 변수

Vercel 대시보드 서버 env 전용:

```env
RENDER_API_KEY=rnd_xxxxxxxxxxxxxxxx
RENDER_OWNER_ID=tea-xxxxxxxxxxxxxxxx
RENDER_SERVICE_ID_PIPELINE=srv-xxxxxxxxxxxxxxxx
RENDER_SERVICE_ID_LISTENER=srv-xxxxxxxxxxxxxxxx
RENDER_SERVICE_ID_BOT=srv-xxxxxxxxxxxxxxxx
```

- `RENDER_OWNER_ID`는 `owner.id` 필터용. team plan은 team id, personal은 user id.
- 각 `RENDER_SERVICE_ID_*`는 서비스별 고정 ID. Render Dashboard URL에서 확인 가능.
- **`NEXT_PUBLIC_*` 접두사 금지**. 브라우저에 유출되면 key 즉시 폐기.

### 7.3 엔드포인트별 요청/응답 예시

#### 7.3.1 List services

요청:
```http
GET https://api.render.com/v1/services?limit=50&ownerId=tea-xxxx
Authorization: Bearer rnd_xxxx
```

기대 응답 (요약):
```json
[
  {
    "cursor": "cursor-1",
    "service": {
      "id": "srv-abc123",
      "name": "whalescope-pipeline",
      "type": "cron_job",
      "slug": "whalescope-pipeline",
      "suspended": "not_suspended",
      "suspenders": [],
      "serviceDetails": {
        "schedule": "*/15 * * * *",
        "lastSuccessfulRunAt": "2026-04-19T07:45:00Z"
      },
      "createdAt": "2026-04-15T10:00:00Z",
      "updatedAt": "2026-04-19T07:30:00Z"
    }
  }
]
```

파싱 규칙:
- `service.type`: `cron_job` → UI 표시 `cron`; `background_worker` → `worker`; `web_service` → `web`; `private_service` → `private`.
- `suspended`: `not_suspended`이면서 최근 deploy가 live이면 `live`로 판정 (deploy 조회 결과와 조합).
- `suspenders`: 비어 있지 않으면 정지 원인 명시 (예: `["manual"]`).

#### 7.3.2 List deploys (서비스별)

요청:
```http
GET https://api.render.com/v1/services/srv-abc123/deploys?limit=3
```

기대 응답 (요약):
```json
[
  {
    "deploy": {
      "id": "dep-1234abc",
      "status": "live",
      "commit": {
        "id": "9a8b7c6d",
        "message": "fix: retry etherscan on 429",
        "createdAt": "2026-04-19T12:00:00Z"
      },
      "trigger": "new_commit",
      "createdAt": "2026-04-19T12:01:00Z",
      "startedAt": "2026-04-19T12:01:30Z",
      "finishedAt": "2026-04-19T12:04:10Z"
    }
  }
]
```

`status` 값: `created / build_in_progress / update_in_progress / live / pre_deploy_in_progress / pre_deploy_failed / build_failed / update_failed / deactivated / canceled`.

UI 매핑:
- `live` → 🟢 live
- `build_in_progress / update_in_progress / pre_deploy_in_progress / created` → 🟡 deploying
- `build_failed / update_failed / pre_deploy_failed` → 🔴 failed
- `canceled / deactivated` → ⚪ inactive

#### 7.3.3 List instances (서비스별)

요청:
```http
GET https://api.render.com/v1/services/srv-abc123/instances
```

기대 응답:
```json
[
  {
    "instance": {
      "id": "i-xyz789",
      "state": "running",
      "startedAt": "2026-04-18T19:12:00Z"
    }
  }
]
```

`state`: `starting / running / stopped / failed`.

cron job의 경우 `instances`는 최근 실행들을 반환. worker는 현재 running 인스턴스 1개를 반환.

#### 7.3.4 List logs

요청:
```http
GET https://api.render.com/v1/logs?ownerId=tea-xxxx&resource=srv-abc123,srv-def456&startTime=2026-04-19T06:45:00Z&endTime=2026-04-19T07:00:00Z&limit=50&direction=backward
```

기대 응답:
```json
{
  "logs": [
    {
      "timestamp": "2026-04-19T06:58:12Z",
      "level": "info",
      "message": "run_all start slot=signals",
      "labels": {
        "serviceId": "srv-abc123",
        "serviceName": "whalescope-pipeline",
        "instanceId": "i-xyz789",
        "type": "app"
      }
    }
  ],
  "nextStartTime": "2026-04-19T06:45:00Z",
  "nextEndTime": "2026-04-19T06:58:11Z",
  "hasMore": true
}
```

#### 7.3.5 Get service (단건)

요청:
```http
GET https://api.render.com/v1/services/srv-abc123
```

응답은 §7.3.1의 한 원소. 단건 조회가 필요할 때만 사용.

### 7.4 에러 응답 taxonomy

Render API 에러는 공식적으로 HTTP status + JSON body를 반환한다. 대응 매트릭스:

| HTTP | 의미 | lib/render.ts 처리 | UI 표시 |
|---|---|---|---|
| 200 | 성공 | 정상 파싱 | — |
| 400 | 잘못된 파라미터 | `ApiError{code:"bad_request"}` throw | "요청 형식 오류. 버그일 수 있음 — err_id" |
| 401 | 인증 실패 | `ApiError{code:"auth_failed"}` | "Render API 인증 실패. RENDER_API_KEY 만료 가능성" |
| 403 | 권한 없음 | `ApiError{code:"forbidden"}` | "권한 없음. API Key 권한 확인 필요" |
| 404 | 리소스 없음 | `ApiError{code:"not_found"}` | "서비스 ID가 잘못되었습니다. RENDER_SERVICE_ID_* 확인" |
| 429 | Rate limit | `ApiError{code:"rate_limited", retryAfterMs}` | "잠시 후 다시 조회" + 자동 재시도 |
| 5xx | 서버 오류 | `ApiError{code:"upstream"}` | "Render 일시적 오류. 잠시 후 재시도" |
| network / timeout | 네트워크 | `ApiError{code:"network"}` | "네트워크 오류. 자동 재시도" |

### 7.5 Rate limit 대응

Render API 문서에 구체 quota가 공개되어 있지 않다. 안전한 가정:
- 단일 IP당 분당 수백 req 미만을 가정.
- 429 시 `Retry-After` 헤더 우선, 없으면 지수 백오프 (1s → 2s → 4s, max 30s, 3회 시도 후 포기).
- `/admin` 1회 로드 시 Render API 호출 수 상한: **10 req 이하** (§9 캐시 전략으로 보장).

### 7.6 타임아웃

- HTTP timeout: 5s (services/instances/deploys), 10s (logs — 응답 크기 큼).
- 전체 `/admin` 서버 렌더 bud: 15s. 초과 시 해당 섹션만 빈 상태로 렌더.

---

## 8. `/admin` 확장 설계 (TypeScript 타입 시스템)

### 8.1 Discriminated union 기반 타입

```ts
// apps/dashboard/lib/render.types.ts

export type ServiceType = 'cron' | 'worker' | 'web' | 'private' | 'unknown';

export type ServiceStatus =
  | { kind: 'live' }
  | { kind: 'deploying'; deployId: string; startedAt: string }
  | { kind: 'failed'; deployId: string; reason: string }
  | { kind: 'suspended'; suspenders: string[] }
  | { kind: 'unknown' };

export type AdminRenderService = {
  id: string;
  name: string;
  type: ServiceType;
  status: ServiceStatus;
  lastDeployAt?: string;       // ISO 8601 UTC
  lastDeployStatus?: DeployStatus;
  lastDeployId?: string;
  schedule?: string;            // cron only
  createdAt?: string;
  updatedAt?: string;
};

export type DeployStatus =
  | 'live'
  | 'deploying'     // created / build_in_progress / update_in_progress / pre_deploy_in_progress
  | 'failed'        // build_failed / update_failed / pre_deploy_failed
  | 'inactive';     // canceled / deactivated

export type AdminRenderDeploy = {
  serviceId: string;
  deployId: string;
  status: DeployStatus;
  rawStatus: string;            // 원본 Render status 값 보존
  commitSha?: string;
  commitMessage?: string;       // UI 80자 trim
  trigger?: 'new_commit' | 'manual' | 'rollback' | 'deploy_hook' | string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
};

export type InstanceState = 'starting' | 'running' | 'stopped' | 'failed' | 'succeeded' | 'unknown';

export type AdminRenderInstance = {
  serviceId: string;
  instanceId: string;
  state: InstanceState;
  startedAt?: string;
  finishedAt?: string;          // cron only
};

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'unknown';

export type AdminRenderLogLine = {
  serviceId: string;
  serviceName: string;
  timestamp: string;            // ISO 8601 UTC
  level: LogLevel;
  message: string;              // 1,000자 trim
  instanceId?: string;
  type?: 'app' | 'build' | 'system';
};

export type RenderFetchResult<T> =
  | { ok: true; data: T; fetchedAt: string; cacheHit: boolean }
  | { ok: false; error: RenderApiError; fetchedAt: string };

export type RenderApiError =
  | { code: 'config_missing'; missingEnv: string[] }
  | { code: 'auth_failed' }
  | { code: 'forbidden' }
  | { code: 'not_found'; resource: string }
  | { code: 'bad_request'; detail: string }
  | { code: 'rate_limited'; retryAfterMs?: number }
  | { code: 'upstream'; httpStatus: number }
  | { code: 'network'; cause: string }
  | { code: 'timeout'; afterMs: number }
  | { code: 'internal'; errId: string };
```

### 8.2 `service_health` 파싱 타입

```ts
// apps/dashboard/lib/health.types.ts

export type ServiceHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'waiting'
  | 'down'
  | 'config_required'
  | 'unknown';

export type ServiceHealthRow = {
  ts: string;                   // ISO UTC
  service: string;              // 'pipeline', 'telethon_listener', 'telegram_bot'
  component: string;            // 'run_all', 'signals', 'brief', ...
  status: ServiceHealthStatus;
  heartbeatKey?: string;
  details?: string;
  error?: string;
  // v2 extensions (all optional)
  instanceId?: string;
  jobName?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  processedCount?: number;
  lagSeconds?: number;
  durationMs?: number;
  sourceName?: string;
};

export type ServiceHealthSummary = {
  service: string;
  component: string;
  status: ServiceHealthStatus;
  lastHeartbeatAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  avgDurationMs?: number;       // 최근 N회 평균
  successRate7d?: number;       // 0.0~1.0
  processedCountLastRun?: number;
  sourceName?: string;
  // derived
  isStale: boolean;
  staleReason?: string;
};
```

### 8.3 교차 상태 타입

```ts
// apps/dashboard/lib/correlate.types.ts

export type CrossStateRule = 'C1_platform_live_data_stale'
  | 'C2_platform_deploying_or_suspended'
  | 'C3_platform_live_data_ok_but_errors_in_logs';

export type CrossStateFinding = {
  rule: CrossStateRule;
  severity: 'info' | 'warn' | 'error';
  summary: string;              // 사람 언어 1~2 문장
  affectedService: string;
  affectedComponent?: string;
  evidence: CrossStateEvidence;
  recommendation?: string;      // 런북 링크 포함
  runbookAnchor?: string;       // '#19.1' 등
};

export type CrossStateEvidence = {
  platformStatus: ServiceStatus;
  dataLagSeconds?: number;
  healthStatus?: ServiceHealthStatus;
  recentErrorCount15m?: number;
  recentErrorSamples?: AdminRenderLogLine[];
};

export type AdminPageState = {
  generatedAt: string;
  dataLayer: DataLayerState;
  workerLayer: WorkerLayerState;
  platformLayer: PlatformLayerState;
  crossFindings: CrossStateFinding[];
  errors: AdminPageError[];
};

export type DataLayerState = {
  sheets: Array<{
    tab: string;
    rowsLast24h: number;
    latestRecordAt?: string;
    slaSeconds: number;
    isStale: boolean;
  }>;
  costLedger: CostLedgerDto;
};

export type WorkerLayerState = {
  summaries: ServiceHealthSummary[];
  recentErrors: Array<{
    ts: string;
    service: string;
    component?: string;
    message: string;
  }>;
};

export type PlatformLayerState =
  | { kind: 'ok';
      services: AdminRenderService[];
      deploys: AdminRenderDeploy[];
      instances: AdminRenderInstance[];
      logs: AdminRenderLogLine[];
    }
  | { kind: 'disabled'; reason: 'config_missing'; missingEnv: string[] }
  | { kind: 'error'; error: RenderApiError };

export type AdminPageError = {
  area: 'data' | 'worker' | 'platform' | 'correlate';
  message: string;
  errId?: string;
};

export type CostLedgerDto = {
  monthUsd: number;
  capUsd: number;
  usagePct: number;
  bySlot: Array<{ slot: 'brief' | 'stories' | string; usd: number; runs: number }>;
  projectedEndOfMonthUsd?: number;
  guardActive: boolean;
};
```

### 8.4 `/admin` 서버 컴포넌트 골격

```ts
// apps/dashboard/app/admin/page.tsx
import { getAdminPageState } from '@/lib/admin';

export const revalidate = 15;  // 페이지 전체 기본 재검증 15초

export default async function AdminPage() {
  const state = await getAdminPageState();
  return (
    <main>
      <AdminHeader generatedAt={state.generatedAt} />
      <SectionA data={state.dataLayer} />
      <SectionB worker={state.workerLayer} />
      <SectionC platform={state.platformLayer} />
      <SectionD findings={state.crossFindings} />
      {state.errors.length > 0 && <AdminErrorBanner errors={state.errors} />}
    </main>
  );
}
```

```ts
// apps/dashboard/lib/admin.ts
import { loadDataLayer } from './data';
import { loadWorkerLayer } from './health';
import { loadPlatformLayer } from './render';
import { computeCrossFindings } from './correlate';

export async function getAdminPageState(): Promise<AdminPageState> {
  const generatedAt = new Date().toISOString();

  // 세 계층을 병렬 조회 (서로 독립)
  const [dataRes, workerRes, platformRes] = await Promise.allSettled([
    loadDataLayer(),
    loadWorkerLayer(),
    loadPlatformLayer(),
  ]);

  const errors: AdminPageError[] = [];
  const data = settledOrFallback(dataRes, 'data', errors, emptyDataLayer());
  const worker = settledOrFallback(workerRes, 'worker', errors, emptyWorkerLayer());
  const platform = settledOrFallback(platformRes, 'platform', errors, { kind: 'disabled', reason: 'config_missing', missingEnv: [] });

  const crossFindings = computeCrossFindings(data, worker, platform);

  return { generatedAt, dataLayer: data, workerLayer: worker, platformLayer: platform, crossFindings, errors };
}
```

### 8.5 `lib/render.ts` 구현 스케치

```ts
// apps/dashboard/lib/render.ts
import { unstable_cache } from 'next/cache';

const RENDER_BASE = 'https://api.render.com/v1';

function requireEnv(): { key: string; ownerId: string; serviceIds: Record<'pipeline'|'listener'|'bot', string> } | RenderApiError {
  const key = process.env.RENDER_API_KEY;
  const ownerId = process.env.RENDER_OWNER_ID;
  const pipeline = process.env.RENDER_SERVICE_ID_PIPELINE;
  const listener = process.env.RENDER_SERVICE_ID_LISTENER;
  const bot = process.env.RENDER_SERVICE_ID_BOT;
  const missing: string[] = [];
  if (!key) missing.push('RENDER_API_KEY');
  if (!ownerId) missing.push('RENDER_OWNER_ID');
  if (!pipeline) missing.push('RENDER_SERVICE_ID_PIPELINE');
  if (!listener) missing.push('RENDER_SERVICE_ID_LISTENER');
  if (!bot) missing.push('RENDER_SERVICE_ID_BOT');
  if (missing.length > 0) return { code: 'config_missing', missingEnv: missing };
  return { key: key!, ownerId: ownerId!, serviceIds: { pipeline: pipeline!, listener: listener!, bot: bot! } };
}

async function renderFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const env = requireEnv();
  if ('code' in env) throw env; // RenderApiError
  const controller = new AbortController();
  const timeoutMs = init?.signal ? 10000 : 5000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${RENDER_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${env.key}`,
        Accept: 'application/json',
        'User-Agent': 'whalescope-admin/1.0',
      },
      signal: controller.signal,
    });
    if (res.status === 401) throw { code: 'auth_failed' } satisfies RenderApiError;
    if (res.status === 403) throw { code: 'forbidden' } satisfies RenderApiError;
    if (res.status === 404) throw { code: 'not_found', resource: path } satisfies RenderApiError;
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') || 0) * 1000;
      throw { code: 'rate_limited', retryAfterMs: retryAfter } satisfies RenderApiError;
    }
    if (res.status >= 500) throw { code: 'upstream', httpStatus: res.status } satisfies RenderApiError;
    if (!res.ok) throw { code: 'bad_request', detail: await res.text() } satisfies RenderApiError;
    return (await res.json()) as T;
  } catch (e) {
    if ((e as any)?.code) throw e; // 이미 RenderApiError
    if ((e as any)?.name === 'AbortError') throw { code: 'timeout', afterMs: timeoutMs } satisfies RenderApiError;
    throw { code: 'network', cause: String(e) } satisfies RenderApiError;
  } finally {
    clearTimeout(timer);
  }
}

// --- 캐시된 조회 (unstable_cache) ---

export const listRenderServices = unstable_cache(
  async (): Promise<AdminRenderService[]> => {
    const env = requireEnv();
    if ('code' in env) throw env;
    const raw = await renderFetch<Array<{ service: any }>>(`/services?limit=50&ownerId=${env.ownerId}`);
    return raw.map(({ service }) => mapService(service));
  },
  ['render-services-v1'],
  { revalidate: 60, tags: ['render-services'] }
);

export const listRenderDeploys = unstable_cache(
  async (serviceId: string): Promise<AdminRenderDeploy[]> => {
    const raw = await renderFetch<Array<{ deploy: any }>>(`/services/${serviceId}/deploys?limit=3`);
    return raw.map(({ deploy }) => mapDeploy(serviceId, deploy));
  },
  ['render-deploys-v1'],
  { revalidate: 60, tags: ['render-deploys'] }
);

export const listRenderInstances = unstable_cache(
  async (serviceId: string): Promise<AdminRenderInstance[]> => {
    const raw = await renderFetch<Array<{ instance: any }>>(`/services/${serviceId}/instances`);
    return raw.map(({ instance }) => mapInstance(serviceId, instance));
  },
  ['render-instances-v1'],
  { revalidate: 30, tags: ['render-instances'] }
);

export const listRenderLogs = unstable_cache(
  async (args: { serviceIds: string[]; startTime: string; endTime: string; limit?: number }): Promise<AdminRenderLogLine[]> => {
    const env = requireEnv();
    if ('code' in env) throw env;
    const params = new URLSearchParams({
      ownerId: env.ownerId,
      resource: args.serviceIds.join(','),
      startTime: args.startTime,
      endTime: args.endTime,
      limit: String(args.limit ?? 50),
      direction: 'backward',
    });
    const raw = await renderFetch<{ logs: any[] }>(`/logs?${params}`, { signal: new AbortController().signal });
    return (raw.logs ?? []).map(mapLogLine);
  },
  ['render-logs-v1'],
  { revalidate: 15, tags: ['render-logs'] }
);

export async function loadPlatformLayer(): Promise<PlatformLayerState> {
  try {
    const env = requireEnv();
    if ('code' in env) return { kind: 'disabled', reason: 'config_missing', missingEnv: env.missingEnv };
    const services = await listRenderServices();
    const deployArrays = await Promise.all(services.map((s) => listRenderDeploys(s.id).catch(() => [])));
    const instanceArrays = await Promise.all(services.map((s) => listRenderInstances(s.id).catch(() => [])));
    const now = Date.now();
    const logs = await listRenderLogs({
      serviceIds: services.map((s) => s.id),
      startTime: new Date(now - 15 * 60 * 1000).toISOString(),
      endTime: new Date(now).toISOString(),
      limit: 50,
    }).catch(() => []);
    return {
      kind: 'ok',
      services,
      deploys: deployArrays.flat(),
      instances: instanceArrays.flat(),
      logs,
    };
  } catch (e) {
    return { kind: 'error', error: e as RenderApiError };
  }
}
```

매핑 함수 `mapService`, `mapDeploy`, `mapInstance`, `mapLogLine`은 §7.3의 원 응답 JSON을 §8의 타입으로 변환. `rawStatus`를 보존해 감사/디버깅에 쓴다.

---

## 9. 캐싱 및 비용 전략

### 9.1 TTL 매트릭스

| 레이어 | 원천 | 기본 TTL | 근거 | 인터랙티브 재조회 |
|---|---|---|---|---|
| Data: Sheets tab summary | Sheets | 30s | 데이터 적재 slowest tab이 15분 슬롯 | 수동 refresh 허용 |
| Worker: service_health | Sheets | 15s | heartbeat 주기가 15분 미만 노이즈 | 수동 refresh 허용 |
| Platform: services | Render API | 60s | services 목록은 거의 안 바뀜 | 수동 refresh는 30s 쿨다운 |
| Platform: deploys | Render API | 60s | 배포는 수분 단위 이벤트 | 수동 refresh 허용 |
| Platform: instances | Render API | 30s | 인스턴스 state는 분 단위 변화 | 수동 refresh 허용 |
| Platform: logs (15m 창) | Render API | 15s | 최신 로그가 핵심 가치 | 수동 refresh 허용 |

### 9.2 캐시 구현

- Next.js App Router의 `unstable_cache` + `revalidate` 사용 (서버 메모리 캐시).
- tag 기반 invalidation: `revalidateTag('render-logs')` 등.
- 페이지 수준 `export const revalidate = 15` (전체 페이지 최소 재검증).
- CDN 캐시는 `/admin`에 적용하지 않는다 (개인화·서버 렌더).

### 9.3 월간 호출 수 / 비용 모델

#### 가정

- 운영자 1인이 업무 시간(09:00~18:00 KST, 9시간/day) 중 분당 1회 `/admin` 조회 가정 = 540 pageview/day × 20 영업일 = 10,800 pageview/월.
- 각 pageview에서 Render API 호출 수 (캐시 miss 최악 가정):
  - services: 1
  - deploys: 3 services × 1 = 3
  - instances: 3
  - logs: 1
  - 합계: 8
- 그러나 대부분 캐시 hit:
  - services TTL 60s → pageview 대비 hit률 95%
  - deploys TTL 60s → 95%
  - instances TTL 30s → 85%
  - logs TTL 15s → 60%
- 평균 호출 수/pageview: services 0.05 + deploys 0.15 + instances 0.45 + logs 0.40 = **약 1.05/pageview**.
- 월간: 10,800 × 1.05 = **약 11,340 req/월**.

#### Render API 비용

Render API는 워크스페이스 plan에 포함된 일반 관리 API로 분당 수백 req 가정 하에 **추가 비용 없음**. 단 workspace plan 변경 시 재확인 필요.

결론: 월간 $0, 자체 rate limit도 충분히 안전.

#### 비용 경계 조건

다음 조건이 만족되면 추가 최적화 불필요:
- 동시 운영자 3인 이하.
- `/admin` 외 다른 Render API 사용자 없음.
- 로그 시간창이 15m 이하.

위 조건을 벗어나면: TTL 증가(logs 15s → 30s), 로그 건수 감소(50 → 30), 운영자 수동 refresh 쿨다운(3s).

### 9.4 수동 refresh UX

- 카드별 refresh 버튼: 해당 tag만 `revalidateTag` 호출.
- 전체 refresh 버튼: 페이지 상단, 5초 쿨다운 (연타 방지).
- 쿨다운 중 버튼은 disabled + 잔여 시간 카운트다운.

---

## 10. 구현 단계 (Phase 1~4)

v1은 Phase 3까지 제시. v2는 검증·관측·롤아웃까지 포함한 Phase 4를 추가.

### Phase 1. 데이터/워커 계층 정교화 (Sheets 쪽)

**기간 예상**: 1~2일.

**작업**:
1. Python 측 `SheetsClient.append_service_health` 시그니처에 v2 필드 8개 추가 (default=None).
2. `scripts/init_sheets.py`에 헤더 확장 적용.
3. `pipeline.run_all`에서 dispatcher가 `lag_seconds`, `duration_ms` 기록.
4. 각 job(`signals`, `news_rss`, `brief`, `stories`)에서 `processed_count`, `source_name`, `last_success_at`, `last_failure_at` 기록.
5. `telethon_listener`/`telegram_bot`에서 `instance_id`(Render env), `source_name` 기록.
6. Next.js `lib/metrics.ts`를 `lib/data.ts` + `lib/health.ts`로 분할.
7. `/admin` 페이지에 섹션 A/B 분리 적용 (섹션 C는 이 단계에서 placeholder "Render 통합은 Phase 2에서 제공").

**수용 기준** (Given/When/Then):
- GIVEN `/admin`에 접속, WHEN 섹션 B의 pipeline.run_all 카드를 본다, THEN `last_success_at`, `processed_count`, `duration_ms`가 비어있지 않다.
- GIVEN 운영자가 `broadcast_log`에 skip만 쌓인 상태, WHEN 섹션 A의 broadcast_log를 본다, THEN "skip-only" 구분이 명확하다.
- GIVEN signals가 etherscan rate limit으로 실패, WHEN 섹션 B-5 "최근 실패" 카드를 본다, THEN `source_name=etherscan`과 에러 메시지가 보인다.

### Phase 2. Render 플랫폼 계층 추가

**기간 예상**: 2~3일.

**작업**:
1. Render 계정에서 `RENDER_API_KEY` 발급, `OWNER_ID`와 3개 `SERVICE_ID` 확인.
2. Vercel 서버 env에 5개 변수 추가.
3. `apps/dashboard/lib/render.ts` 신규 작성 (§8.5 스케치 기반).
4. `lib/render.types.ts` 신규 작성.
5. `lib/admin.ts`에 `loadPlatformLayer` 추가.
6. `/admin`에 섹션 C(카드 C1~C4) 렌더.
7. env 없을 때 graceful fallback UI.

**수용 기준**:
- GIVEN 전 변수 설정, WHEN `/admin` 접속, THEN 섹션 C에 3개 서비스 상태가 표시된다.
- GIVEN `RENDER_API_KEY`만 빈 문자열, WHEN `/admin` 접속, THEN 섹션 C가 "설정 필요 — RENDER_API_KEY" 안내를 표시하고 섹션 A/B는 정상 렌더한다.
- GIVEN Render API가 500을 반환, WHEN `/admin` 접속, THEN 섹션 C가 "Render 일시적 오류" 표시, 섹션 A/B 정상.
- GIVEN 로그 API가 50건 반환, WHEN 섹션 C-4를 본다, THEN 서비스별 색상 구분 + 시각 표시가 정확하다.

### Phase 3. 교차 판정 및 상관관계 UX

**기간 예상**: 2일.

**작업**:
1. `lib/correlate.ts` 신규 작성 (규칙 C1~C3).
2. `lib/correlate.types.ts`.
3. 섹션 D(D1~D3) 렌더.
4. 각 카드에서 상태가 이상일 때 해당 런북 anchor로 deep link.
5. 사람 언어 요약 (D2) 작성.

**수용 기준**:
- GIVEN pipeline live + signals 72분 lag, WHEN `/admin` 접속, THEN 섹션 D에 C1 findings 표시.
- GIVEN bot 배포 중, WHEN `/admin` 접속, THEN 섹션 D에 C2 "배포 중" 격하 메시지.
- GIVEN 로그에 error 8건 + 모든 heartbeat 정상, WHEN `/admin` 접속, THEN C3 표시.
- GIVEN 모두 정상, WHEN `/admin` 접속, THEN D1이 "현재 교차 이상 없음".

### Phase 4. 관측성·롤아웃·런북·`deploy_log`(선택)

**기간 예상**: 1~2일.

**작업**:
1. `/admin` 자체를 관측 — Render API 호출 수/지연을 `system_log`에 기록 (`lib/render.ts` 내부 계측).
2. Feature flag `NEXT_PUBLIC_ADMIN_V2` 도입 — v1 `/admin`과 v2 `/admin`을 URL query 또는 env로 토글.
3. 롤백 절차 문서화 (§18).
4. 런북 5종 최종화 (§19).
5. (선택) `deploy_log` Sheets 탭 추가 + Render Deploy Hook 수신.

**수용 기준**:
- GIVEN v2 플래그 off, WHEN `/admin` 접속, THEN 기존 v1 UI 그대로 표시.
- GIVEN v2 플래그 on, WHEN `/admin` 접속, THEN v2 UI 표시.
- GIVEN 관측 계측 활성, WHEN Render API 1회 호출, THEN `system_log`에 `event=render_api_call` row 1개 추가.
- GIVEN 런북 §19.1 링크 클릭, WHEN 링크가 Obsidian 노트로 연결, THEN 해당 anchor가 보인다.

---

## 11. QA 기준 (테스트 매트릭스)

### 11.1 단위 테스트 (unit)

대상 모듈: `lib/render.ts`, `lib/health.ts`, `lib/correlate.ts`, `lib/data.ts`.

| 테스트 | 입력 | 기대 |
|---|---|---|
| `mapService` | 실제 Render API 응답 샘플 (cron) | `AdminRenderService.type === 'cron'`, `status.kind === 'live'` |
| `mapService` | suspended=manual | `status.kind === 'suspended'`, `suspenders=['manual']` |
| `mapDeploy` | `status: 'build_failed'` | `status: 'failed'`, `rawStatus: 'build_failed'` 보존 |
| `requireEnv` | 모든 env 설정 | `ok` 케이스 반환 |
| `requireEnv` | RENDER_API_KEY 빈 문자열 | `code: 'config_missing'`, `missingEnv: ['RENDER_API_KEY']` |
| `computeCrossFindings` C1 | platform live + data lag 2h | `C1_platform_live_data_stale` finding 1개 |
| `computeCrossFindings` C2 | platform deploying | `C2_platform_deploying_or_suspended` |
| `computeCrossFindings` none | 모두 정상 | 빈 배열 |
| `parseServiceHealthRow` v1 row | v1 7컬럼만 | v2 필드 undefined |
| `parseServiceHealthRow` v2 row | 15컬럼 | v2 필드 정상 파싱 |

프레임워크: Vitest.

### 11.2 통합 테스트 (integration)

대상: `lib/admin.ts` (`getAdminPageState`).

테스트 더블 전략:
- Sheets: 실제 googleapis 호출을 mocking (nock 또는 msw).
- Render API: msw로 엔드포인트 모킹.
- Scenarios:
  1. 모든 소스 정상 → dataLayer/workerLayer/platformLayer 모두 데이터.
  2. Render env 누락 → platform kind=disabled, 나머지 정상.
  3. Sheets 인증 실패 → data/worker 비어있고 errors 2개 append, platform 정상.
  4. Render API 500 → platform kind=error, 나머지 정상.
  5. Render logs만 timeout → platform.logs 빈 배열, services/deploys/instances 정상.

### 11.3 계약 테스트 (contract)

Render API 응답 스키마가 우리 가정과 일치하는지 주기적으로 검증.

- pact-js 또는 zod 스키마로 `parseService`의 입력 검증.
- CI에서 **실제 Render API 1회 호출 테스트** (전용 read-only key, services/deploys/instances만). 단, dev 파이프라인 외 머지 블록하지 않음(flaky 허용).

### 11.4 E2E 테스트 (선택)

- Playwright로 `/admin` 접속 → 각 섹션이 렌더되는지 smoke.
- Render env를 .env.test에서 오프로 둔 상태로 graceful fallback 확인.

### 11.5 수동 QA 체크리스트 (운영자)

- [ ] 섹션 A/B/C/D가 순서대로 보인다.
- [ ] 헤더 시각이 KST이다.
- [ ] 각 카드의 "상태" 아이콘과 색상이 일관된다 (🟢/🟡/🔴/⚙️/⚠️).
- [ ] Render API 빈 key 시 섹션 C가 "설정 필요" 안내만 표시한다.
- [ ] 에러 원문이 UI에 노출되지 않는다.
- [ ] §1.1 10개 질문 모두에 답할 수 있다.
- [ ] 수동 refresh 5초 쿨다운이 작동한다.
- [ ] 모바일 화면에서 세로 스택으로 읽힌다 (UX 개선계획 §의 responsive 가이드와 일치).

---

## 12. 예상 리스크 (확장)

v1은 4개 리스크. v2는 10개로 확장.

| # | 리스크 | 영향도 | 가능성 | Detect | Respond |
|---|---|---|---|---|---|
| 1 | Render API 호출 rate limit (429) | 중 | 저 | `system_log` event=render_rate_limited | 자동 지수 백오프, TTL 연장 |
| 2 | `RENDER_API_KEY` 유출 | 높 | 저 | 외부 감사 로그 | 즉시 key 폐기, 신규 발급, git history scan |
| 3 | `RENDER_API_KEY` 만료 (주기적 폐기 정책 시) | 중 | 중 | `/admin` 섹션 C가 "인증 실패"로 변함 | 새 key 발급, Vercel env 교체 |
| 4 | Render 로그 retention이 부족해 15m 창에 아무것도 없음 | 저 | 저 | 빈 로그 패널 | 운영자에게 "로그 없음" 표시, Render plan 재확인 |
| 5 | 플랫폼 로그와 앱 로그 시간축 불일치 (UTC vs local) | 저 | 중 | 수동 QA | 모두 UTC 기준 비교, UI는 KST 변환 후 표시 |
| 6 | `/admin` 서버 fetch 지연 증가 (Render API 느림) | 중 | 중 | 페이지 p95 계측 | per-section Promise.allSettled, timeout 5~10s |
| 7 | Sheets API 일간 quota 도달 | 높 | 저 | `system_log` event=sheets_quota | 읽기 캐시 TTL 증가, 일부 카드 임시 숨김 |
| 8 | `service_health` v2 필드가 일부만 채워진 상태에서 UI가 "—"로만 보임 | 저 | 중 | QA | Phase 1에서 모든 call site 확장 완료 |
| 9 | Render API 응답 스키마 breaking change | 중 | 저 | 계약 테스트 실패 | 즉시 `mapXxx` 수정, 구 스키마 fallback 잠시 유지 |
| 10 | `/admin`이 계측 자체로 Render API 호출을 늘려 rate limit에 기여 | 저 | 저 | `system_log`의 `render_api_call` 카운트 | 관측 자체를 샘플링 (1/10) |

---

## 13. 결론 (운영자 질문 → `/admin` 응답 매핑)

§1.1 10개 질문에 대해 v2가 어떻게 답하는지 명시.

| # | 질문 | `/admin` 응답 경로 |
|---|---|---|
| 1 | 최근 24h 실제로 어떤 데이터가 몇 건 쌓였는가? | 섹션 A 카드 A1 |
| 2 | 어떤 탭이 지연·공백 상태인가? 그 지연은 얼마나? | 섹션 A 카드 A1 (지연 색상) + A2 (최신 ts) |
| 3 | 각 파이프라인 job은 마지막으로 언제 성공? | 섹션 B 카드 B2 테이블 `last_success` 열 |
| 4 | 마지막으로 실패한 job과 원인은? | 섹션 B 카드 B5 + B2 `last_err` |
| 5 | listener / bot은 auth·heartbeat 정상? | 섹션 B 카드 B3, B4 |
| 6 | Render 3 서비스 상태는? | 섹션 C 카드 C1 |
| 7 | 마지막 배포는 언제, 성공했는가? | 섹션 C 카드 C2 |
| 8 | 인스턴스는 몇 개, 언제 기동? | 섹션 C 카드 C3 |
| 9 | 최근 15분~1h 경고/오류 raw 로그는? | 섹션 C 카드 C4 |
| 10 | 어떤 워커가 죽으면 어떤 Sheets 탭이 stale? | 섹션 D 카드 D1 (교차 규칙 C1) + D2 요약 |

**최종 기대 상태**: 운영자가 `/admin` 한 페이지만 열고 5분 안에 현재 시스템 상태 전체를 파악한다. Render Dashboard와 Google Sheets를 번갈아 열 필요는 **예외 상황(Phase 1~4 구현 완료 기준 주 1~2회)**에만 발생한다.

---

## 14. 상태 기계 (State Machines)

### 14.1 서비스 `ServiceStatus` 전이도

```
             ┌──────────────┐
      ┌──────│  unknown     │◀───┐
      │      └──────┬───────┘    │
      ▼             ▼            │ (초기 조회 실패)
┌──────────┐ ┌──────────┐       │
│   live   │ │  failed  │       │
└────┬─────┘ └────┬─────┘       │
     │            │             │
     │ (새 deploy)│(fix 배포)   │
     ▼            ▼             │
┌─────────────────────────┐     │
│     deploying           │─────┘
└────┬────────────┬───────┘
     │            │
 (성공)         (실패)
     ▼            ▼
   live        failed

(suspended는 어디서나 들어가고 나올 수 있음)
┌────────────┐
│ suspended  │◀── (manual / billing)
└────────────┘
```

운영 판단 규칙:
- `live` → 녹색.
- `deploying` → 노랑(일시적 허용).
- `failed` → 빨강 (즉시 조치 필요).
- `suspended` → 회색 (의도적 중단 가능).
- `unknown` → 회색 + "조회 실패".

### 14.2 `ServiceHealthStatus` 전이도

```
 ┌────────────┐
 │  unknown   │
 └─────┬──────┘
       │ (첫 heartbeat)
       ▼
 ┌────────────┐
 │  healthy   │◀────┐
 └─────┬──────┘     │
       │            │ (다시 성공)
       │ (에러)     │
       ▼            │
 ┌────────────┐     │
 │  degraded  │─────┘
 └─────┬──────┘
       │ (heartbeat 부재가 stale 기준 초과)
       ▼
 ┌────────────┐
 │   down     │
 └────────────┘

(config_required는 초기에만 진입, 설정 후 healthy로 이동)
(waiting은 cron slot 밖일 때)
```

### 14.3 플랫폼 × 애플리케이션 교차 매트릭스

12개 조합. v2 `/admin`이 자동 판정.

| 플랫폼 | 앱(health) | 해석 | 권장 조치 |
|---|---|---|---|
| live | healthy | 정상 | — |
| live | degraded | 앱 레벨 일시 오류 (retry 중) | system_log 확인 |
| live | down | 앱이 장시간 응답 없음 (스케줄 문제·로직 오류) | 로그 상세, 필요 시 수동 trigger |
| live | config_required | env 누락 (Session string 등) | 설정 등록 |
| deploying | any | 배포 중 → 데이터 일시 공백 허용 | 대기 (3~5분) |
| failed | any | 배포 실패 → 이전 버전 계속 실행 중이면 정상, 아니면 장애 | 로그 확인, 롤백 |
| suspended | any | 의도적 정지 | 재개 필요 여부 확인 |
| unknown | any | Render API 조회 실패 | API key/네트워크 확인 |

---

## 15. 에러 / 경고 분류 체계

### 15.1 Error class 8종

| class | 의미 | 예시 | 사용자 노출 메시지 템플릿 |
|---|---|---|---|
| `E_CONFIG_MISSING` | env 미설정 | `RENDER_API_KEY` 빈 문자열 | `"설정이 완료되지 않았습니다. {missingEnv} 등록이 필요합니다."` |
| `E_AUTH_FAILED` | 인증 실패 | 401 | `"API 인증 실패. {provider} 키 만료 가능성."` |
| `E_FORBIDDEN` | 권한 없음 | 403 | `"접근 권한이 없습니다. 관리자에게 문의."` |
| `E_NOT_FOUND` | 리소스 없음 | 404 | `"요청한 리소스를 찾을 수 없습니다. 설정 값 확인."` |
| `E_RATE_LIMITED` | 쿨다운 중 | 429 | `"잠시 후 다시 조회합니다 ({retryAfter}s)."` |
| `E_UPSTREAM` | 외부 서비스 오류 | 5xx | `"{provider} 일시적 오류입니다. 잠시 후 자동 재시도."` |
| `E_NETWORK` | 네트워크 | DNS/timeout | `"네트워크 오류. 자동 재조회 중."` |
| `E_INTERNAL` | 내부 버그 | 파싱 실패 등 | `"내부 오류가 발생했습니다. err_id: {errId}"` |

### 15.2 `errId` 생성 규약

- `E_INTERNAL` 시 `errId = crypto.randomUUID().slice(0, 8)` 8자리.
- 서버 로그에 full stack + errId를 남김 (운영자가 지원팀 문의 시 이 id만 제공).

### 15.3 원문 노출 금지 목록

다음 문자열은 **절대** UI에 나가지 않는다:
- `Bearer rnd_...`
- `AIza...` (Google creds)
- 파일 경로 (`/home/...`, `/app/...`)
- 스택트레이스
- SQL-like 쿼리
- Sheets range 문자열 (`Sheet1!A2:Z100`)

빌드 타임에 린트 규칙 또는 런타임 sanitizer에서 필터.

### 15.4 error 경계 (React)

각 카드를 `<ErrorBoundary>` 경계에 넣는다. 경계 fallback은 **`E_INTERNAL` 템플릿**.

---

## 16. 보안 · 시크릿 · 감사

### 16.1 시크릿 수명주기

| 키 | 발급처 | 저장소 | 회전 주기 | 폐기 조건 |
|---|---|---|---|---|
| `RENDER_API_KEY` | Render Account Settings → API Keys | Vercel env (prod only) | 90일 권장 | 유출 감지, 퇴사자 삭제 |
| `GOOGLE_CREDENTIALS_JSON` | GCP Service Account | Vercel env + Render env | 180일 | 서비스 계정 폐기 시 |
| `RENDER_SERVICE_ID_*` | Render Service URL | Vercel env | 서비스 재생성 시만 | — |

### 16.2 접근 제어

- `/admin` 자체의 접근 제어는 이 문서의 스코프 밖(기존 `DASHBOARD_PASSWORD` 등 사용).
- Render API는 **read-only key** 사용 (Render가 지원하는 범위 내). write 권한은 불필요.
- 서비스 ID는 비공개로 유지 (공개 github에 커밋하지 않음). `.env.example`에 placeholder.

### 16.3 감사 로그

`/admin`이 호출하는 Render API 각 요청을 **앱 레벨 감사 로그**(`system_log`)에 기록.

```
service=dashboard_admin
component=render_fetch
event=render_api_call
details={"path":"/services","httpStatus":200,"durationMs":234,"cacheHit":false}
```

감사 로그에는 **응답 본문을 기록하지 않는다** (PII/secret 누수 방지).

### 16.4 위협 모델 (간이)

| 위협 | 완화 |
|---|---|
| Render API key 노출 | server-only env, `.env` gitignore, secret scanning |
| `/admin`에 외부 사용자 접근 | Vercel basic auth / IP 제한 / SSO (외부 레이어) |
| XSS로 로그 메시지 스크립트 실행 | React 기본 escape + DOMPurify(사용 안함이 원칙) |
| 내부자가 Render write API 호출 | read-only key 사용, write endpoint 접근 불가 |

---

## 17. 관측성 (Observability)

### 17.1 `/admin` self-observation

`/admin`은 자기 자신의 Render API 호출·에러·지연을 관측한다.

구현 위치: `lib/render.ts` `renderFetch` 함수 내부에서 finally 블록에 `system_log` append.

기록 필드:
- `ts` (UTC)
- `service=dashboard_admin`
- `component=render_fetch`
- `event` ∈ {`render_api_call`, `render_api_error`, `render_cache_hit`}
- `details` JSON: `{"path","httpStatus","durationMs","errorCode"}`

단, 고빈도 방지를 위해 **샘플링 1/10** 적용.

### 17.2 메트릭 (향후)

Phase 4 이후, 필요 시:
- `/api/admin-health` 엔드포인트 (Prometheus format) — Render API 호출 수, 지연 p50/p95, 에러 수.
- 또는 Vercel Analytics의 custom events.

### 17.3 Tracing

- 현재 trace 인프라 없음. `errId` 수준의 correlation만 사용.
- 향후 Sentry 연동 옵션.

### 17.4 대시보드 개편 효과 계측

구현 완료 후, 아래 값을 측정해 §1.4 성공 지표와 비교:

- 주간 `/admin` pageview.
- 주간 "Render Dashboard 직접 접속 수" (운영자 셀프 보고).
- 주간 Render API 호출 수.
- 주간 평균 응답 지연.

---

## 18. 롤아웃 · 롤백

### 18.1 Feature flag

env: `NEXT_PUBLIC_ADMIN_V2` (값: `"1"`이면 v2, 아니면 v1).

page.tsx 분기:
```ts
const useV2 = process.env.NEXT_PUBLIC_ADMIN_V2 === '1';
return useV2 ? <AdminV2 ... /> : <AdminV1 ... />;
```

Query string으로 수동 override:
- `/admin?v=2` → 강제 v2
- `/admin?v=1` → 강제 v1

### 18.2 단계별 노출 전략

| 단계 | 기간 | 범위 | 기준 |
|---|---|---|---|
| S0 | 내부 dev | Vercel preview URL | Phase 1~3 완료 |
| S1 | staging prod | flag on in staging env | S0 24h 무장애 |
| S2 | prod 50% | flag로 운영자 반만 노출 (Vercel rollout %) | S1 48h 무장애 |
| S3 | prod 100% | flag on in prod | S2 1주 무장애 |
| S4 | v1 제거 | `AdminV1` 컴포넌트 및 `metrics.ts` 제거 | S3 2주 무장애 |

### 18.3 롤백 절차

| 문제 유형 | 롤백 | 확인 |
|---|---|---|
| v2 UI 버그 | `NEXT_PUBLIC_ADMIN_V2=0` Vercel env 업데이트 | `/admin`이 v1으로 즉시 돌아감 |
| Render API 장애로 섹션 C 전체 에러 | 기본값 `v2` 유지, 섹션 C만 graceful fallback (코드 레벨) | 개별 카드 실패만 |
| service_health v2 필드가 pipeline에서 잘못 기록 | Python 코드 revert + 재배포 | 헤더는 유지 (읽기 optional이므로 하위 호환) |
| RENDER_API_KEY 유출 | Render에서 즉시 폐기, 신규 발급, Vercel env 교체 | 5분 내 `/admin` 섹션 C 정상화 |

### 18.4 변경 로그 (배포 시 CHANGELOG)

각 PR에서 `docs/CHANGELOG.md`에 한 줄 기록:
```
2026-04-21 [admin-v2] phase 2: Render platform layer (services/deploys/instances/logs)
```

---

## 19. 런북 (빈발 장애 5종)

### 19.1 `signals` job이 429 rate limit로 실패

**증상**: 섹션 B-2에서 `signals` 상태 `degraded`, last_err에 `etherscan 429`.

**확인**:
1. 섹션 D-1에 교차 규칙 C1 표시?
2. 섹션 C-4 pipeline 로그에 `429 Too Many Requests` 다수?

**조치**:
1. Etherscan dashboard에서 quota 확인.
2. quota 초과면 `src.ingestion.etherscan`의 분당 호출 수 축소 (코드).
3. 일시 초과면 다음 slot에서 자동 복구.
4. 복구 후 섹션 B-2 `success_rate_7d`가 90% 이상인지 확인.

### 19.2 `RENDER_API_KEY` 만료

**증상**: 섹션 C 전체가 "API 인증 실패. RENDER_API_KEY 만료 가능성" 표시.

**조치**:
1. Render Account Settings → API Keys → 만료된 키 확인.
2. 새 키 발급 (read-only 권장).
3. Vercel project → Settings → Environment Variables → `RENDER_API_KEY` 값 교체.
4. Vercel redeploy (env 변경은 자동 트리거).
5. 5분 내 섹션 C 복구 확인.

### 19.3 `telethon_listener`가 `config_required`

**증상**: 섹션 B-3 카드 상태 `⚙️ config_required`, 사유 "TELETHON_SESSION_STRING 누락".

**조치**:
1. 로컬에서 Telethon login script 실행 (배포 가이드 §2.3).
2. 출력된 session string을 Render → whalescope-listener → Environment에 등록.
3. Render가 자동 재기동.
4. 1~2분 후 섹션 B-3가 `healthy`로 바뀌는지 확인.

### 19.4 `whalescope-bot` deploy failed

**증상**: 섹션 C-1 bot 상태 `🔴 failed`, 이전 버전은 계속 live.

**조치**:
1. 섹션 C-2에서 실패한 deploy id 확인.
2. 섹션 C-4에서 build 로그(type=build)로 필터.
3. 원인 파악 (대개 dependency 문제).
4. 수정 → push → 새 deploy 자동 트리거.
5. 긴급 시 Render Dashboard → Rollback 버튼.

### 19.5 모든 Sheets 탭이 stale

**증상**: 섹션 A 전체가 🔴, 섹션 B 전체 `down`, 섹션 C는 정상.

**조치**:
1. Google Sheets 권한 확인 (서비스 계정이 편집 가능?).
2. `GOOGLE_CREDENTIALS_JSON`이 Vercel/Render env에 정상 입력?
3. Render pipeline 최근 로그(섹션 C-4 filter=pipeline)에 `PermissionDenied` 있는지?
4. Sheets API quota 도달 여부 확인.
5. 해결 후 pipeline 수동 trigger로 빠르게 복구.

---

## 20. 접근성 · 타임존 · i18n

### 20.1 접근성 (WCAG 2.1 AA 최소)

- 상태 아이콘은 색 + 기호 + 라벨 3중화 (색맹 대응). 예: `🟢 live` / `🟡 deploying` / `🔴 failed`.
- 모든 카드는 `role="region"` + `aria-label`.
- 테이블은 `<table>` + `<th scope=...>`.
- 수동 refresh 버튼은 `aria-live="polite"` 영역으로 결과 전달.
- 키보드: Tab 순서 섹션 A → B → C → D, 각 카드 내 refresh 버튼이 접근 가능.

### 20.2 타임존

- 내부 저장/계산: UTC.
- UI 표시: KST (운영자 전원 한국 기준).
- 상대 시간: "2분 전", "3시간 전" (한국어, `date-fns`의 `ko` locale).
- Tooltip으로 절대 시각 노출 (예: "2026-04-19 16:58 KST / 07:58 UTC").

### 20.3 i18n

- v2는 **한국어만** 지원.
- 영어 확장은 별도 이슈. 단, 코드 구조는 `lib/i18n.ts` 추상 가능한 상태로 둔다.

---

## 20A. 2026-04-19 구현 상태 체크리스트

상태 기준 시점은 **2026-04-19 현재 main 작업 트리 + 로컬 QA 결과**다. 이 섹션은 "설계상 목표"가 아니라 **실제로 코드와 검증으로 확인된 상태**만 체크한다.

### 20A.1 완료된 구현

- [x] `service_health`를 v2 15열(`instance_id`, `job_name`, `last_success_at`, `last_failure_at`, `processed_count`, `lag_seconds`, `duration_ms`, `source_name` 포함) 기준으로 확장했다.
- [x] 기존 시트가 이미 생성되어 있어도 `scripts/init_sheets.py`가 헤더를 확장하도록 보강했다.
- [x] `pipeline`, `listener`, `bot` heartbeat 기록 경로에 확장 필드를 실제로 채우도록 Python 파이프라인을 반영했다.
- [x] `apps/dashboard/lib/render.ts`를 추가해 Render 서비스 / deploy / instance / log 조회 레이어를 만들었다.
- [x] Render 환경변수 파싱(`RENDER_API_KEY`, `RENDER_OWNER_ID`, `RENDER_SERVICE_ID_*`)과 운영 관측 타입/스키마를 대시보드에 추가했다.
- [x] `/admin`을 Section A/B/C/D 구조로 재편하고 운영 관측 전용 renderer를 추가했다.
- [x] Section A에 원장 탭 요약, 최신 스냅샷, 비용·발송 관측 카드가 들어갔다.
- [x] Section B에 서비스 카드, 런타임 체크, 환경/연결 체크, 최근 실패·경고 로그 패널이 들어갔다.
- [x] Section B에 `Job 상세 테이블`을 추가해 pipeline, listener, bot, SSE, source health를 한 표에서 비교할 수 있게 했다.
- [x] Section C가 `adminObservability.render`를 우선 읽어 3개 서비스, 최근 deploy, 인스턴스, 최근 Render 로그를 실제 데이터로 렌더하도록 연결됐다.
- [x] 상태 표기를 `/admin` 전반에서 `색 + dot + icon + 텍스트` 조합으로 통일했다.
- [x] Render 관련 에러 문구는 raw upstream detail 대신 운영자용 요약 문구로 정제했다.
- [x] Section D에 교차 판단과 운영 메모 요약이 들어갔다.
- [x] Render 미연결 또는 env 누락 시 Section C만 placeholder/fallback으로 떨어지도록 분리했다.
- [x] QA 중 발견된 회귀 3건(고래 스토리 모달 axe 대비비율, live updates 상태칩 title 오표시, 추가 color-contrast 회귀)을 수정했다.

### 20A.2 검증까지 완료된 항목

- [x] `pytest -q` 통과 (`389 passed, 6 warnings`).
- [x] `npm run dashboard:typecheck` 통과.
- [x] `npm run dashboard:lint` 통과.
- [x] `npm run dashboard:build` 통과.
- [x] `npm run dashboard:e2e` 통과 (`18 passed`).

### 20A.3 부분 완료 / 아직 닫히지 않은 항목

- [ ] "에러 원문 UI 노출 0건"은 Render 경로 기준으로는 raw upstream detail을 숨기도록 정제했지만, `/admin` 전체 경로를 대상으로 한 별도 감사 체크리스트/점검 기록까지 완료되진 않았다.

### 20A.4 아직 미구현 / 후속 작업 필요

- [ ] `deploy_log` 탭과 deploy hook 기반 적재는 이번 반영 범위에 포함되지 않았다.
- [ ] Render API 호출량 / 비용 / 캐시 hit·miss 기반 p95 측정치는 아직 수집하지 않았다.
- [ ] `lib/render.ts` 80% 이상 coverage 측정과 최신 Render 응답 fixture 3종 contract test는 아직 없다.
- [ ] 롤백 절차 dry-run, S0→S4 단계 롤아웃, CHANGELOG 누적 운영은 아직 수행하지 않았다.
- [ ] §1.1의 운영자 질문 10개를 `/admin`만으로 100% 답할 수 있는지에 대한 최종 운영 검증은 아직 남아 있다.


## 21. 수용 기준 집계 (Acceptance Criteria)

아래 체크리스트가 전부 PASS여야 v2 DONE. 2026-04-19 기준 상태를 반영해 체크를 갱신한다.

### 21.1 기능 수용

- [x] `/admin` 페이지 4개 섹션 (A/B/C/D) 순서대로 렌더.
- [x] 섹션 A: 7개 탭 요약 + A3 비용 카드.
- [x] 섹션 B: pipeline.run_all + job 상세 테이블 + listener + bot + 최근 실패 10건.
- [x] 섹션 C: 3개 서비스 + 최근 deploy + 인스턴스 + 로그 패널.
- [x] 섹션 D: 교차 findings (또는 "이상 없음").
- [x] 상태 색상 3중화 (색/기호/텍스트).
- [x] Render env 누락 시 섹션 C만 graceful fallback.
- [ ] 에러 원문 UI 노출 0건 (감사 통과).

주석: 기능 구현과 로컬 QA 기준으로 Section B/C와 상태 3중화는 닫혔다. 다만 "에러 원문 UI 노출 0건"은 코드 정제는 반영됐지만 별도 감사 체크리스트까지 끝난 상태는 아니다.

### 21.2 성능 수용

- [ ] 캐시 hit 시 p95 < 800ms.
- [ ] 캐시 miss 시 p95 < 2500ms.
- [ ] Render API 월간 호출 < 50,000.

주석: 관련 계측 설계는 문서에 있으나, 실제 수집/리포트는 아직 시작하지 않았다.

### 21.3 테스트 수용

- [ ] Unit test coverage `lib/render.ts` ≥ 80%.
- [ ] Integration test 5 scenarios pass.
- [ ] Contract test fixtures 3개 최신 Render 응답 반영.

주석: 현재는 `pytest -q`, `dashboard:typecheck`, `dashboard:lint`, `dashboard:build`, `dashboard:e2e`까지 통과했다. 하지만 이 문단이 요구하는 coverage/contract 기준은 별도 미완료다.

### 21.4 운영 수용

- [x] 런북 §19 5종 문서화 완료.
- [ ] 롤백 절차 §18.3 검증 (dry-run).
- [ ] §1.4 성공 지표 10개 질문에 답 가능 확인.

주석: 운영 문서화는 끝났지만, 실제 운영 dry-run과 "10개 질문 100% 답변 가능" 검증은 아직 남아 있다.

### 21.5 롤아웃 수용

- [ ] S0 → S1 → S2 → S3 단계별 flag 전환.
- [ ] CHANGELOG 각 배포마다 기록.
- [ ] S4 (v1 제거) 완료 후 `lib/metrics.ts` deprecated.

---

## 22. 열린 질문 (Open Questions)

구현 전 의사결정 필요.

| # | 질문 | 기본안 | 결정 주체 | Due |
|---|---|---|---|---|
| 1 | Render read-only key 방식이 Render plan에서 지원되는가? | write key로 대체, write endpoint 사용 금지 코드 가드 | 확인 필요 | Phase 2 착수 전 |
| 2 | `deploy_log` 탭 (§6.5)을 v2에 포함할지? | 선택(Phase 4) | 제품 오너 | Phase 3 종료 시 |
| 3 | 섹션 A-3 비용 카드에 `llm_budget_log` 월별 추이 그래프 포함? | 숫자 요약만 (그래프 없음) | UX 검토 | Phase 1 |
| 4 | 섹션 C-4 로그 패널의 기본 시간창(15m vs 1h)? | 15m 기본 | 운영자 1인 피드백 | S0 기간 |
| 5 | 수동 refresh 전체/카드별 혼용? | 전체 + 카드별 둘 다 | 운영자 피드백 | S1 |
| 6 | 영어 i18n 지원은 v3로 미룸 확정? | 확정 | 기본 확정 | — |
| 7 | `system_log`에 `render_api_call` 기록 샘플링 비율 (1/10 vs 1/5)? | 1/10 | 관측 부하 검토 | Phase 4 |
| 8 | `/admin`에 private link / SSO 추가는 별도 문서? | 별도 문서 | 보안 검토 | — |

---

## 부록 A — Render API 엔드포인트 요약표

| 기능 | Method | Path | 주요 쿼리 | 주요 응답 필드 |
|---|---|---|---|---|
| List services | GET | `/v1/services` | `limit`, `ownerId` | `service.id/name/type/suspended/serviceDetails` |
| Get service | GET | `/v1/services/:id` | — | `service.*` 단건 |
| List deploys | GET | `/v1/services/:id/deploys` | `limit` | `deploy.id/status/commit/trigger/createdAt` |
| List instances | GET | `/v1/services/:id/instances` | — | `instance.id/state/startedAt` |
| List logs | GET | `/v1/logs` | `ownerId`, `resource`, `startTime`, `endTime`, `limit`, `direction` | `logs[]/nextStartTime/hasMore` |

레퍼런스: https://api-docs.render.com/reference

---

## 부록 B — Sheets `service_health` v2 스키마 (헤더)

```
순서 | 헤더명              | 예시 값
----+--------------------+-------------------------------
1   | ts                 | 2026-04-19T07:58:12Z
2   | service            | pipeline
3   | component          | signals
4   | status             | healthy
5   | heartbeat_key      | signals@2026-04-19T07:45Z
6   | details            | wrote 12 rows
7   | error              |
8   | instance_id        | i-xyz789
9   | job_name           | source=etherscan
10  | last_success_at    | 2026-04-19T07:58:15Z
11  | last_failure_at    | 2026-04-19T01:30:02Z
12  | processed_count    | 12
13  | lag_seconds        | 3
14  | duration_ms        | 3241
15  | source_name        | etherscan
```

---

## 부록 C — 커밋 / PR 분할 제안

| PR | 목적 | 주요 파일 | 테스트 | 롤백 |
|---|---|---|---|---|
| PR#1 | Sheets v2 스키마 + Python 측 heartbeat 확장 | `scripts/init_sheets.py`, `src/storage/sheets.py`, `src/pipeline/*.py` | pytest: heartbeat 필드 검증 | 헤더 원복 |
| PR#2 | `lib/data.ts` + `lib/health.ts` 분할 및 섹션 A/B UI | `apps/dashboard/lib/data.ts`, `health.ts`, `app/admin/*` | vitest unit + integration | 이전 `lib/metrics.ts` 유지 |
| PR#3 | `lib/render.ts` + 타입 + 섹션 C UI | `apps/dashboard/lib/render.ts`, `render.types.ts`, 섹션 C 컴포넌트 | vitest unit + msw integration | `NEXT_PUBLIC_ADMIN_V2=0` |
| PR#4 | `lib/correlate.ts` + 섹션 D + 런북 링크 | `lib/correlate.ts`, `correlate.types.ts`, 섹션 D | vitest unit (C1~C3) | flag off |
| PR#5 (선택) | 관측성 계측 + `deploy_log` + Deploy hook | `lib/render.ts`(계측), `api/render-hook/route.ts` | integration | 계측 코드 제거 |

각 PR은 독립적으로 머지 가능 (v1 경로 유지). PR#3 이후 PR#4는 의존.

---

## 참고 / 관련 문서

- 상위 계획: [[2026-04-18-15-WhaleScope-v5-개선계획-Render-단일소스-UI-UX]]
- IA 결정: [[2026-04-18-09-WhaleScope-페이지-정보구조-운영-사용자-분리-보고서]]
- 배포 기반: [[2026-04-18-08-WhaleScope-Render-워커-웹서버-배포가이드]]
- 동일 날짜 UX 축: [[2026-04-19-05-WhaleScope-UX-개선계획]]
- 동일 날짜 장애 대응: [[2026-04-19-03-WhaleScope-장애대응-및-개선-이행계획]]
- v1 (이 문서의 전신): [[2026-04-19-04-WhaleScope-운영페이지-관측-개선계획-Render-로그-통합]]
- Render API 문서: https://api-docs.render.com/reference
