# WhaleScope — One Pager

> 고래 온체인 움직임을 AI가 한국어로 해설하여, 일반 투자자가 하루에 확인해야 할 핵심 이벤트만 선별해 전달하는 큐레이션 서비스.

- **선택 도메인**: C. AI 요약/큐레이션 서비스
- **문서 목적**: Wrtn Technologies Product Engineer 과제 전형 제출 문서
- **배포 URL**: [https://whalescope.6esk.com](https://whalescope.6esk.com) · 공개 채널 [@whalescope_alertz](https://t.me/whalescope_alertz)
- **관련 문서**: [README.md](README.md) · [docs/one-pager.md](docs/one-pager.md) (요약본) · [docs/03_Architecture_WhaleScope.md](docs/) (초기 설계) · [docs/changelog.md](docs/changelog.md)
- **면책 고지**: 본 서비스는 투자 자문 서비스가 아닙니다. 모든 브리핑은 정보 제공 목적이며, 투자 판단과 그에 따른 책임은 사용자에게 있습니다.

---

## 1. 도메인 선택 근거

### 1-1. 세 도메인의 비교 평가

제시된 세 도메인을 먼저 PE 관점에서 체계적으로 비교하였습니다.

| 도메인 | AI가 제공하는 실질 가치 | 차별화 난이도 | 7일 내 유의미한 MVP 가능성 | 주요 리스크 |
|---|---|---|---|---|
| A. 사주/운세 | 해석 자연어 생성 | 매우 높음 — 유사 서비스가 다수 존재 | 높음 | 기존 시장 포화로 기획의 차별점 확보가 어려움 |
| B. 이미지 생성 | 모델 선택 및 프롬프트 엔지니어링 | 중간 — 모델 API 래핑이 중심 | 중간 | 단기간 단독 수행으로 UX 완성도에 역량이 집중되어, AI 활용 판단력을 드러내기 어려움 |
| **C. 요약/큐레이션** | **원시 데이터를 이해 가능한 맥락으로 변환** | **중상 — 하위 도메인 선택에 의해 결정됨** | 하위 도메인을 명확히 좁힐 경우 높음 | 하위 도메인을 좁히지 않으면 범용 요약 수준에 머무를 위험 |

비교 결과 **C 도메인**을 선택하였으며, 이때 "요약할 가치가 있으나 기존 서비스가 충분히 해결하지 못한 하위 도메인"을 명확히 정의하는 것을 선결 과제로 삼았습니다.

### 1-2. 크립토 온체인 고래 도메인을 선택한 이유

다음 네 가지 조건을 동시에 만족하는 하위 도메인을 탐색한 결과 크립토 온체인 고래 움직임 영역을 선택하였습니다.

1. **데이터의 공개성과 해석의 폐쇄성이 공존함** — 블록체인은 모든 트랜잭션이 공개되어 있으나, 이를 해석하기 위해서는 지갑 라벨링, 맥락 파악, 패턴 해석 등 전문성이 요구됩니다. 정보 비대칭을 해소하는 즉시 가치 창출이 가능합니다.
2. **AI가 해결에 적합한 문제 구조** — 대량 이벤트 스트림에서 유의미한 패턴을 추출하고 이를 자연어로 설명하는 작업은 LLM의 강점에 부합합니다.
3. **타겟의 구체성과 활성도** — 한국 2030 직장인 투자자층은 일일 거래량 규모, 소통 채널, 페인 포인트가 반복적으로 관찰 가능한 집단입니다.
4. **Wrtn의 미션과의 정렬성** — "Bring AGI Close to People" 미션은 전문가 영역의 정보를 일반 사용자가 소화 가능한 형태로 전환하는 작업과 본질적으로 동일한 방향성을 가집니다.

### 1-3. 타 도메인을 선택하지 않은 근거

A 도메인은 국내 시장에서 유사 서비스가 다수 존재하며, Wrtn 내부에도 관련 기능이 이미 제공되고 있어 단기간 내 차별화가 구조적으로 어렵습니다. B 도메인은 7일간 단독 수행 시 모델 API 래핑과 UX 폴리싱에 역량이 집중되는 구조로, 제품 판단력보다는 구현 숙련도를 드러내는 결과물에 가까워질 가능성이 높습니다. 제품 판단 역량의 측정이라는 과제 취지를 고려할 때 C 도메인이 가장 적합하다고 판단하였습니다.

---

## 2. 타겟과 미해결 문제

### 2-1. 타겟 페르소나

다음은 시장 관찰과 공개 커뮤니티 활동 패턴을 기반으로 합성한 대표 페르소나입니다.

| 항목 | 내용 |
|---|---|
| 인구통계 | 30대 초반 직장인, 수도권 거주, IT/사무직 종사 |
| 투자 경력 | 크립토 투자 3~5년, 보유 자산 1,500만~3,000만 원 수준 |
| 포트폴리오 | BTC 비중 30~50%, ETH 비중 20~35%, 기타 알트코인 분산 |
| 정보 소비 시간 | 출퇴근 및 점심 시간대 합산 약 40~60분/일 |
| 사용 채널 | 국내 거래소 애플리케이션, Telegram, 커뮤니티(디시인사이드 등), 트위터 |
| 관찰 가능한 행동 | Whale Alert 등 실시간 채널을 구독하였다가 정보 과부하로 차단하는 패턴이 반복 관찰됨 |
| 지불 의사 | 월 1만 원 이하 수준에서 유료 정보 서비스를 고려 |
| 언어 역량 | 영어 일반 독해는 가능하나, 금융·온체인 전문 용어가 포함된 영문 대시보드는 진입 장벽으로 작용 |

### 2-2. 기존 서비스 갭 분석

| 서비스 | 강점 | 타겟 페르소나 관점의 한계 |
|---|---|---|
| Whale Alert | 실시간성, 20개 이상 체인 지원, 무료 제공 | 원시 트랜잭션 알림에 해설이 동반되지 않아, "왜 중요한지"를 판단하기 위해 추가 리서치가 필요함 |
| Arkham Intelligence | AI 기반 지갑 라벨링, 엔티티 식별 | 영어 전용 UI, 대시보드 복잡도 및 학습 비용이 높음 |
| Nansen | 스마트 머니 추적, 수익률 분석 | 월 구독료 $150 이상으로, 일반 투자자의 지불 의사와 괴리 |
| 국내 서비스(코인업, 코인니스 등) | 한국어 지원, 실시간 알림 | 알림 중심 설계로 맥락 해설이 결여되어 있으며, 알림 피로도가 높음 |
| CryptoQuant | 거래소 플로우 지표, 한국어 블로그 콘텐츠 제공 | 대시보드 기반 서비스로 일일 확인용으로 사용하기 위해서는 높은 학습 비용이 요구됨 |

### 2-3. 미해결 문제의 정리

기존 서비스는 "무슨 일이 일어났는가"에 대한 정보는 충분히 제공하나, "왜 중요한가" 및 "오늘 사용자가 우선적으로 확인해야 할 이벤트는 무엇인가"에 대한 해석과 선별이 부재합니다. 이로부터 다음 네 가지 미해결 문제를 도출하였습니다.

1. **해석의 부재** — 원시 트랜잭션이 실행 가능한 맥락으로 번역되지 않음.
2. **정보 과부하** — 일일 수백 건의 알림 중 우선순위가 높은 이벤트를 선별할 수단이 부재함.
3. **언어 장벽** — 고품질 분석 도구가 영어 전용이며, 한국어 해설 서비스가 제한적임.
4. **비용 장벽** — 전문가용 도구의 가격이 개인 투자자의 지불 의사를 크게 상회함.

이 네 가지 문제는 핵심 가치 제안의 네 가지 축과 1:1로 대응합니다.

---

## 3. 핵심 기능과 근거

### 3-1. 탐지 계층과 해설 계층의 분리

WhaleScope의 핵심 아키텍처적 결정은 탐지(Detection)와 해설(Explanation) 계층의 분리입니다.

- **탐지 계층은 규칙 기반으로 구성**하였습니다. `SignalEngine`이 8개의 규칙을 적용하여 원시 이벤트에서 시그널을 선별합니다.
  - `cex_outflow_spike`, `cex_inflow_spike`, `cold_to_hot_transfer`, `smart_money_accumulation`, `token_whale_concentration_shift`, `tg_cex_inflow_burst`, `corroborated_move`, `weekly_net_accumulation`
- **해설 계층은 LLM 기반으로 구성**하였습니다. 탐지된 시그널과 주변 맥락을 입력받아 한국어 브리핑을 생성합니다.

**분리의 근거**: LLM에 "원시 트랜잭션 중 중요한 것을 판단하라"는 과업을 직접 위임할 경우 환각과 결과의 비일관성이 증가합니다. 탐지는 결정론적(재현 가능, 테스트 가능)이어야 하며, 해설만 확률적(자연스러움, 맥락 적합성)으로 처리하는 것이 적절하다고 판단하였습니다. 관련 구현은 `src/signals/rules.py`(규칙 8종) 및 `src/llm/router.py`(Anthropic/Gemini/Groq 3-provider 라우터)에 위치합니다.

### 3-2. 한국어 브리핑과 Telegram 우선 전달 채널

- 일일 대표 브리핑을 생성하여 Telegram 채널 또는 개별 DM으로 발송합니다.
- 타겟 페르소나의 일일 정보 소비 패턴(출퇴근 시간대 집중)에 부합하는 단일 진입점으로 채널을 좁혔습니다.
- 별도 애플리케이션 설치, 회원 가입, 구독 결제 단계를 MVP 단계에서는 제거하였습니다.

**근거**: 별도 웹사이트 또는 애플리케이션 방문을 요구할 경우 기존 행동 관성을 극복해야 하는 추가 허들이 발생합니다. Telegram은 타겟 사용자의 기존 사용 채널이며, 국내 크립토 커뮤니티의 주요 소통 채널로 이미 자리잡고 있습니다.

### 3-3. 관심 기준 개인화

- Telegram bot의 `/watchlist` 명령을 통해 관심 토큰을 등록할 수 있습니다.
- 동일한 고래 이벤트라도 사용자의 관심 축에 따라 브리핑 우선순위와 포함 여부가 달리 적용됩니다.
- `weekly_net_accumulation` 규칙은 4주 rolling baseline을 기준으로 "평소 대비 특이 수준"을 산출하여 맥락 정보에 반영합니다.

**근거**: 큐레이션의 본질은 일괄 발송이 아니라 사용자 단위의 필터링입니다. 모든 구독자에게 동일한 5건을 전달하는 방식은 큐레이션으로 기능하지 않는다고 판단하였습니다.

### 3-4. 이중 데이터 수집 레이어

- **1차 수집(직접 관측)**: Etherscan 및 Solscan API를 통한 온체인 이벤트 직접 수집.
- **2차 수집(교차 관측)**: 공개 Telegram 채널 `@whale_alert_io` 수신을 `tg_whale_events`에 저장.
- **상호 검증 규칙**: `corroborated_move` 규칙은 온체인 이벤트와 외부 관측 이벤트가 3분 창, 금액 5% 오차 범위 내에서 매칭될 경우 severity를 1단계 상향합니다.

**근거**: 단일 데이터 소스는 외부 API 장애, rate limit, 체인 확장 지연 등에 의해 가용성이 저하될 수 있습니다. 두 레이어의 상호 보완 구조는 시스템 가용성과 시그널 신뢰도를 동시에 개선합니다. 관련 구현은 `src/main.py::_tg_direction` 및 `src/signals/rules.py::corroborated_move`에 위치합니다.

### 3-5. 스코프 통제 항목과 제외 근거

MVP 단계에서 구현하지 않은 항목과 그 근거는 다음과 같습니다.

| 제외 항목 | 제외 근거 |
|---|---|
| 실시간 웹훅 알림 시스템 | 타겟 페르소나의 핵심 페인 포인트는 실시간성이 아니라 맥락 해석입니다. 일일 1~2회 브리핑으로 충분하며, 실시간 알림은 정보 과부하 문제를 오히려 재생산할 가능성이 높습니다. |
| 멀티유저 회원 가입 및 결제 시스템 | MVP에서 검증해야 할 가설은 "브리핑의 일일 열람 지속성"이며 결제 전환이 아닙니다. 회원/결제 레이어는 핵심 가설 검증 이후 단계에서 도입합니다. |
| 모바일 네이티브 애플리케이션 | Telegram 우선 전략과 상충합니다. 네이티브 앱은 DAU가 0에서 시작하나 Telegram은 기존 사용 관성에 기대어 초기 마찰을 최소화할 수 있습니다. |
| 자체 블록체인 노드 운영 | 비용 및 구축 시간 대비 효용이 낮습니다. 공개 API(Etherscan, Solscan)로 MVP 요구사항이 충분히 충족됩니다. |
| UTXO cluster 기반 BTC/DOGE 보유량 정밀 추적 | Phase 3.5 고도화 과제로 명시적으로 이관하였습니다. 현재는 대표 주소 seed 기준 partial view로 시작하며, 운영 데이터 누적 이후 우선순위를 재판단합니다. |

초기 제출 시 Phase 2로 이관했던 **BTC/XRP/DOGE/TRX 수집기**는 2026-04-20 사이클에서 구현 완료 상태로 전환되었습니다. `ChainCollectorRegistry` + feature flag 구조로 XRP / TRX / BTC (mempool.space primary + Blockchair secondary fallback) / DOGE collector를 추가했고, `/admin`에 rollout mismatch 진단과 TG mirror observability lane을 붙였습니다. 상세 QA는 Obsidian `Projects/02015-WhaleScope/2026-04-20-01-WhaleScope-체인-커버리지-적용완료-QA-종합보고서.md`에 정리되어 있습니다.

### 3-6. 실제 운영 산출물 샘플

실제 파이프라인이 생성한 한국어 브리핑 샘플은 [`docs/sample_briefs/`](./docs/sample_briefs/)에 모아 두었습니다. 심사 관점에서 "오늘자 브리핑 하나 보여달라"는 질문에 즉시 응답 가능하도록 구성했습니다.

- 명명 규칙: `YYYYMMDD_HHMM_{full|incremental}.md`
- 각 파일 하단에 생성 시각, LLM provider, 입력 fingerprint, 비용(USD), 시그널 건수 등 메타데이터 포함.
- 재현 방법과 법적 경계(공개 데이터만 사용, 본문 전문 인용 금지 등)는 [`docs/sample_briefs/README.md`](./docs/sample_briefs/README.md)에 기재.

운영자 주기(주 1회) 수동 갱신을 기본으로 하며 자동화는 Phase 3에서 cron + PR 자동 생성으로 이관 예정입니다.

---

## 4. 성공 지표

### 4-1. 북극성 지표 (Primary Metric)

**일일 브리핑 열람률 (Daily Brief Open Rate)**

- **정의**: 발송된 브리핑 중 실제로 열람된 비율.
- **목표 수준**: 60% 이상 (일반 뉴스레터 평균 20~30% 대비 약 2배 수준).
- **측정 방법**: Telegram message view count를 발송 구독자 수로 나누어 산정.

**지표 선정 근거**: 큐레이션 서비스의 성패는 "매일 열람하고 싶은 콘텐츠인가"로 결정됩니다. 본 지표가 목표 수준에 미달할 경우 하위 지표의 개선은 구조적으로 제약됩니다.

### 4-2. 선행 지표 (Leading Indicators)

| 지표 | 정의 | 2주 목표 | 의미 |
|---|---|---|---|
| Brief → Watchlist 전환율 | 브리핑 수신 후 `/watchlist`로 관심 토큰을 등록한 사용자 비율 | 20% 이상 | 개인화 기능의 인지된 가치 |
| 브리핑 내 링크 CTR | 브리핑 내 상세 링크 클릭률 | 15% 이상 | 맥락 해설에 대한 실질 수요 |
| LLM 해설 피드백 긍정률 | "도움됨/안됨" 선택 중 긍정 비율 | 70% 이상 | AI 해설의 품질 수준 |

### 4-3. 후행 지표 (Lagging Indicators)

| 지표 | 정의 | 1~2개월 목표 |
|---|---|---|
| D7 Retention | 가입 7일 후 브리핑 열람 유지 비율 | 40% 이상 |
| D30 Retention | 가입 30일 후 브리핑 열람 유지 비율 | 20% 이상 |
| 월간 평균 Watchlist 등록 수 | 사용자당 관심 토큰 등록 수 | 3개 이상 |
| 브리핑 공유율 | 외부 채널/개인으로 공유된 비율 | 5% 이상 |

### 4-4. 실패 판단 기준 (Kill Criteria)

다음 조건이 2주간 회복되지 않을 경우 제품 방향 자체의 재검토가 필요합니다.

- Brief Open Rate가 30% 미만으로 유지될 경우: 큐레이션 품질 또는 발송 타이밍의 구조적 문제로 판단.
- Watchlist 등록률이 10% 미만으로 유지될 경우: 개인화 온보딩 UX의 결함으로 판단.
- LLM 해설 부정 피드백 비율이 30%를 초과할 경우: 해설 프롬프트 설계의 재작업이 필요.

### 4-5. 의도적 비추적 지표

**일일 발송 알림 수량**은 의도적으로 추적하지 않는 지표로 설정하였습니다. 이 지표를 성과로 관리할 경우 타겟 페르소나의 핵심 페인 포인트(정보 과부하)를 재생산할 유인이 발생합니다. 추적하지 않음으로써 "많이 발송하려는 유혹"을 구조적으로 차단하였습니다.

### 4-6. 실측 스냅샷

KPI 정의와 목표를 뒷받침하는 실측 값은 `docs/metrics/` 폴더의 주 1회 스냅샷으로 관리합니다. 텔레그램 구독자 수·채널 메타는 `scripts/snapshot_telegram_metrics.py`로 갱신하며, 갱신 절차와 컬럼 정의는 [`docs/metrics/README.md`](./docs/metrics/README.md)를 참조합니다.

| 지표 | 최신 값 | 출처 |
|------|---:|------|
| 텔레그램 구독자 | _스냅샷 갱신 대기_ (`scripts/snapshot_telegram_metrics.py` 실행 필요) | `docs/metrics/tg_snapshot_*.md` |
| 최근 7일 발송 건수 | _시트 집계 대기_ | Google Sheets `broadcast_log` |
| 브리핑 비용 (Mar 2026, 추정) | $9.12 | `brief_cost_ledger` 시트 — Sonnet 추정 모델 기준. 실제 운영은 현재 Gemini 2.5 Flash + Groq Llama 3.3 70B 주력으로, Anthropic key 미활성 상태이므로 실측 체감 비용은 더 낮음 |
| brief 생성 p50 | Day 10 폴리싱 이후 재측정 필요 | `service_heartbeat.duration_ms` |

본 표는 **자동 갱신되지 않습니다**. 현재는 운영자가 주 1회 스크립트를 수동 실행 후 커밋하며, 자동화(cron + PR 자동 생성)는 Phase 3에서 이관 예정입니다.

---

## 5. 과제 수행 과정 기록

과제 원문은 "결과물뿐 아니라 과정에서의 고민과 선택이 평가 기준"임을 명시하고 있습니다. 본 섹션은 7일간 주요 의사결정 시점과 근거를 시간 순으로 정리하며, 제출 이후 이터레이션(Day 8~)은 별도 묶음으로 구분하여 평가 관점에서 스코프 경계가 드러나도록 했습니다.

> ✅ **7일 제출본 MVP 경계 (Day 1~7)** — 아래 Day 1 ~ Day 7은 과제 스코프 내에서 완료된 작업으로, 이 범위만으로도 도메인 C (AI 요약) 요구사항이 충족됩니다. 제출 이후 확장 작업은 Day 7 이후 구분선 아래 별도 섹션에서 제시합니다.

### Day 1 — 문제 정의 및 도메인 선택

- 세 도메인의 기회 및 리스크를 비교 평가하여 C 도메인 선정.
- 공개 커뮤니티 관찰 및 시장 조사를 기반으로 타겟 페르소나 초안을 작성.
- 초기 One Pager 초안 작성 (`docs/02_OnePager_WhaleScope.md`).

### Day 2 — 아키텍처 결정

- 유료 API(Whale Alert) 의존 방식과 직접 수집 방식을 비교하여 후자를 채택. 근거: 외부 의존성 감소, 비용 절감, 체인 확장성 확보.
- **탐지 계층과 해설 계층의 분리 원칙** 확립. 이 원칙은 이후 모든 설계 결정의 상위 제약 조건으로 기능.
- 초기 아키텍처 문서 작성 (`docs/03_Architecture_WhaleScope.md`).

### Day 3~5 — 구현 스프린트

- `SignalEngine`의 8개 규칙 및 `LLMRouter`의 3-provider fallback 구현.
- Telegram bot 및 listener 구현.
- MVP 저장소로 Google Sheets 채택. 근거: 운영진의 직접 편집 가능성 및 스키마 마이그레이션 비용 최소화.
- 계약·단위·통합 테스트를 본격적으로 축적하기 시작 (이후 사이클에서 누적 402건까지 확장).

### Day 6 — 운영 레이어 구성

- Render cron 및 2개 worker, Vercel 대시보드로 구성된 3-tier 배포 구조 확정.
- 대시보드를 사용자용(`/`)과 운영자용(`/admin`)으로 분리. 근거: 두 사용자군의 정보 요구가 구조적으로 상이함.

### Day 7 — 자체 감사 및 후속 설계

- 수집 파이프라인 재검토 과정에서 데이터 편향을 확인. `watched_addresses.csv` 81개 항목 중 78개가 Ethereum 계열로 집중되어 있으며, Ethereum 외 체인은 파이프라인 분기 누락으로 인해 silent drop 상태였음.
- 단순히 CSV에 주소를 추가하는 방식은 파이프라인의 2분기 dispatch 구조상 효과가 없음을 확인. 근본 원인이 데이터가 아닌 아키텍처에 있음을 식별.
- 후속 개선안을 `ChainCollector` ABC와 Registry 패턴 기반으로 재설계하는 상세 문서 작성 (Obsidian 볼트: `2026-04-19-26-WhaleScope-감시지갑-체인-커버리지-확장-개선안-상세설계.md`).
- 해당 개선안은 MVP 스코프 외이나, 제품의 한계를 명시적으로 드러내고 구조적 해결 경로를 함께 제출하는 것이 평가 문서로서 적합하다고 판단.

---

> 🟢 **제출 이후 이터레이션 (Day 8~, 별도 평가 맥락)** — 아래는 7일 과제 스코프 외 확장 작업입니다. 제품 지속 개선 의지와 운영 사이클 관리 능력을 보여주기 위한 부록 성격으로 포함했으며, 7일 MVP 평가의 일부는 아닙니다.

### Day 8 — v6 개선 사이클 (2026-04-19)

과제 제출 이후 운영 사이클에서 실측된 문제를 기반으로 v6 개선을 수행. 6개 커밋이 `origin/main`에 반영되었으며, 402건의 pytest 및 dashboard typecheck/lint/build가 모두 통과한 상태에서 마감되었다.

- **Service Health v2**: heartbeat 스키마에 `instance_id`, `job_name`, `processed_count`, `lag_seconds`, `duration_ms`, `source_name` 등을 추가하여 9개 job의 개별 생존/처리량을 단일 시트에서 관측 가능하게 함.
- **Render observability 대시보드**: `/admin`에 Render REST 기반 서비스/배포/인스턴스/로그 패널 통합. pipeline / bot / listener 3개 worker의 상태를 운영자가 단일 화면에서 판단 가능.
- **Batch A UX 폴리싱**: 큐레이션 watchlist pill 정렬, whale story 카드 높이 정규화, live updates standby 상태 분리. 공포탐욕 mood strip을 hero 위 full-width 레이아웃으로 승격.
- **하이브리드 브리핑 (B.2)**: KST 09/15/21 slot은 full brief, 그 외 slot은 이전 brief 기반 incremental brief로 분기. RSS top N + curated watchlist를 full slot에만 주입. **Sonnet 기준 추정 월 비용이 약 $21 → $9 수준으로 감소**하는 설계. 다만 현 운영은 Anthropic key 미활성 상태로 Gemini 2.5 Flash + Groq Llama 3.3 70B를 주력으로 사용 중이며, 실측 비용은 위 추정치보다 낮음.
- **Suspense 경계 (B.3)**: `/admin` 비동기 데이터 로딩에 Suspense 경계를 명시화하여 React DevTools v6.x 경고를 구조적으로 해소.

### Day 9 — 체인 커버리지 확장 및 운영 진단 (2026-04-20)

Day 7에서 후속 과제로 분리했던 체인 커버리지 구조적 확장을 구현 완료하고, 운영 중 발견된 3건의 근본 원인을 분석하였다.

- **체인 커버리지**: `ChainCollectorRegistry` 기반으로 silent drop guard를 구조화하고, XRP (XRPSCAN-compatible), TRX (TronGrid native + TRC20), BTC (mempool.space primary + Blockchair secondary fallback), DOGE (Blockchair) collector를 feature flag 기반으로 추가. BTC/DOGE는 UTXO 특성상 대표 주소 seed 기준 partial view로 시작하며 UI에 `부분 관측 · cluster 미적용` 배지를 노출.
- **TG mirror observability**: 공개 Telegram 채널 수신 이벤트를 `observation_source=tg_mirror`로 모델링하여 `external_only_observation` / `corroborated_move` 두 흐름으로 signal 규칙과 whale story UI에 반영. `/admin`에서 최근 24h 건수, 신뢰도 분포, 상위 채널, 최신 관측 시각을 확인 가능.
- **Watched-address import validation**: header 검증, chain canonicalization, duplicate 차단, enabled/confidence validation, dry-run summary를 `scripts/import_watched_addresses.py`에 추가하고, canary rollout 순서를 운영 runbook에 정리.
- **운영 진단 3건**:
  - **프로덕션 Upbit API 중단**: WebSocket idle disconnect 시 keepalive ping/reconnect backoff 부재가 주원인으로 식별. CSP `connect-src` allowlist가 production에서만 강제되는 구조도 함께 문서화.
  - **프로덕션 Redis 실시간 비활성**: Vercel Production 스코프에 `WHALESCOPE_SSE_ENABLED` / REST URL / REST TOKEN 3-gate 변수가 누락되어 있었음 (Preview 스코프에만 등록). 로컬은 `.env`를 직접 읽기 때문에 라이브로 동작.
  - **Telegram bot 미발송**: `render.yaml`에 `TELEGRAM_BROADCAST_ENABLED` / `TELEGRAM_BROADCAST_DRY_RUN`이 명시 선언되지 않아 코드 기본값(disabled + dry_run)이 유지. 파이프라인은 정상 실행되지만 실제 발송은 없이 `broadcast_log`에 skip 상태만 누적됨.
  - 세 건 모두 Obsidian `Projects/02015-WhaleScope/`에 별도 노트로 정리하고 대응 가이드를 README 트러블슈팅 섹션과 운영 runbook에 반영.

### Day 10 — 대시보드 성능·안정화 사이클 (2026-04-20 후반 ~ 2026-04-21)

Day 9에서 드러난 "구조는 완성되었으나 사용자 경험 계층(로딩 체감, 모바일 접근성, API 쿼터)"의 품질 격차를 목표로 한 폴리싱 사이클이다. 기능 추가가 아니라 **이미 구현된 값의 안정성**을 올리는 작업에 자원을 집중하였다.

- **Google Sheets 429 근본 해결**: Vercel 다인스턴스 환경에서 Google Sheets API 분당 60 read 쿼터를 구조적으로 초과하던 문제를 **2-tier 캐시**(L1: 프로세스 로컬 `Map` 45s TTL / L2: Upstash Redis REST `whalescope:sheet:*` 60s TTL)로 해결. Redis 장애 시 graceful degrade로 Sheets 원본을 직접 호출하며 서비스 가용성을 유지. `upsertWatchlistOverride` 같은 쓰기 경로에서는 L1/L2를 동시에 명시적 무효화. 동일 Upstash 인스턴스가 SSE event stream도 겸하기 때문에 추가 인프라 없이 공유 캐시 레이어를 확보 (commits `1c9c5ae` L1, `47483de` L2).
- **로딩 성능 개선 사이클 Phase A~F**: Suspense + `await` 병렬화, 모달 `next/dynamic` lazy load, recharts pie → 순수 SVG 치환, `optimizePackageImports`, tier-based TTL, Vercel `icn1` region 고정, Speed Insights 활성화. 결과: **홈 페이지 `/` size 193 → 86.1 kB (-55%)**, **First Load JS 312 → 206 kB (-34%)**, `/admin`은 회귀 없음.
- **운영 안정화 패치 묶음**: (1) CORS 차단되는 Upbit/Bitflyer 소스를 위한 서버 proxy (`/api/proxy/upbit/[...path]`, `/api/proxy/bitflyer/[...path]`; `s-maxage=5, stale-while-revalidate=10`), (2) Dashboard 서버 컴포넌트 전체의 per-tab try/catch isolation으로 단일 시트 탭 실패가 500으로 전파되지 않도록 차단, (3) 138k 트랜잭션 레벨에서 발생하던 `arr.push(...spread)` call stack overflow를 chunked append로 교체, (4) SSR/CSR 하이드레이션 불일치를 `Intl.DateTimeFormat(..., { timeZone: 'Asia/Seoul' })`로 고정, (5) stream `maxDuration` 300s → 60s로 단축하고 transaction snapshot을 최근 200건 + aggregate-only로 슬림화.
- **모바일 접근성·레이아웃 패스**: WCAG 2.5.5 기준 44×44 CSS px 터치 타깃을 차트 chip / 지갑 pill / 모달 닫기 / preview 및 motion anchor에 적용. `/admin` grid overflow를 `min-width: 0` + explicit `minmax(0, 1fr)` 가드로 일괄 정리. 393 px 뷰포트에서 실사용자 hit area 검증.
- **브리핑 축약 반영**: 사용자 홈 상단 brief 슬롯을 축약 포맷으로 교체해 above-the-fold 정보 밀도를 높이되, 상세 브리핑은 모달로 lazy-load 하여 홈 TTI에 영향을 주지 않도록 구성 (Obsidian `2026-04-20-18-WhaleScope-브리핑축약-로딩성능-반영보고서.md`).
- **Wrtn 과제 브랜딩 / 과제 맥락 노출**: 네비게이션 바에 "Wrtn PE Assignment" 칩, 푸터에 과제 맥락 배지를 추가하여 심사 관점에서의 제출물 식별성을 보강 (commit `39dbb0e`).
- **진단 엔드포인트 정비**: `/api/debug/dashboard?mode=env` / `?mode=redisPing`을 `DASHBOARD_DIAG_TOKEN` 게이트로 노출. Vercel Production에서 L2 캐시 연결 이슈를 1분 안에 구분할 수 있게 하여 Day 9에서 발견한 "3-gate 환경 변수 누락" 유형의 재발 감시에 활용.

### Day 11 — PostgreSQL 전환 및 Telegram 채널 중심 운영 정리 (2026-04-24)

Google Sheets 10M cell 한도와 읽기 쿼터가 운영 안정성의 상한으로 확인되어, 데이터 원천을 **Render PostgreSQL primary**로 전환하였다. Google Sheets는 legacy/mirror 확인 경로로 축소하고, Vercel 대시보드와 Render worker는 `DASHBOARD_DATA_BACKEND=postgres`, `DATABASE_URL` 기준으로 동작하도록 정리하였다.

- **저장소 전환**: `transactions`, `signals`, `daily_brief`, `system_log`, `broadcast_log`, `service_health` 등 운영 핵심 원장을 PostgreSQL에서 읽고 쓰도록 확장. Sheets는 과제 초기 MVP의 빠른 운영 검증 수단으로 남기되, 장기 운영 원천에서는 제외.
- **마이그레이션 경로**: `scripts.init_postgres`, `scripts.migrate_sheets_to_postgres`, dashboard Postgres read client를 추가하여 기존 Sheets 데이터의 이관과 신규 적재를 분리. 로컬/Render 모두 동일한 `DATABASE_URL` 환경변수로 검증 가능.
- **Telegram bot conflict 진단**: `getUpdates`를 사용하는 bot worker가 둘 이상 떠 있을 때 `telegram.error.Conflict`가 발생하는 구조를 확인. 개인 DM bot은 단일 인스턴스만 polling하고, 공개 채널 알림은 pipeline의 broadcast 단계에서 `sendMessage`만 수행하는 채널 중심 구조로 정리.
- **Vercel 배포 보정**: `pg` 패키지 누락, `/api/stream` serverless timeout, Postgres read fallback 등의 배포 이슈를 점검하고, `/about`과 운영 문서에 PostgreSQL primary 전환 사실을 반영.

### Day 12 — 운영 수집 복구와 유저홈 품질 점검 (2026-04-27)

Render cron은 살아 있었지만 `/admin` 수집 데이터가 stale로 보이는 장애를 분석하였다. 원인은 scheduler 중단이 아니라 **PostgreSQL read helper가 모든 테이블에 `id` 컬럼이 있다고 가정한 버그**였다. `watched_addresses`와 `subscribers`는 각각 `address`, `chat_id`를 키로 사용하므로 조회가 실패했고, 그 결과 signal pipeline이 감시 주소를 읽지 못해 `completed_empty`로 종료되었다.

- **운영탭 장애 분석 및 복구**: `_select_rows()`에 table별 tie-breaker를 도입하고, `list_watched_addresses()`는 `address`, `list_subscribers()`는 `chat_id` 기준으로 정렬하도록 수정. production PostgreSQL에 감시 주소 92개를 seed하고 manual run으로 transaction freshness 회복을 확인.
- **상태 표시의 의미 분리**: `/admin`은 이제 scheduler 생존 여부와 domain ingestion freshness를 분리해서 해석한다. `signals` 테이블이 오래되어도 "신규 rule threshold 충족 이벤트가 없어서 미기록"일 수 있으므로, 파이프라인 실행 성공 여부와 시그널 발생 여부를 같은 빨간 상태로 섞지 않는 방향으로 보정하였다.
- **유저홈 점검**: 최신 브리핑은 LLM signal brief가 아니라 fallback transaction brief였고, 60분 거래 200건 중 USD 환산 가능 건수가 0인 상황이 있었다. 이를 사용자에게 숨기지 않고 "USD 환산 대기", "이전 감지 사례", "fallback 기반 브리핑"처럼 데이터 품질을 명시하는 방향으로 개선하였다.
- **브리핑 파서 품질 개선**: highlights가 Python list 문자열로 저장되어 쉼표 기준 분해가 깨지던 문제를 JSON array 우선 저장/파싱으로 보정하고, `parseBriefNote`가 `transactions`, `priced`, `unpriced`, `signals`, `fallbackMode`를 구조적으로 노출하도록 정리하였다.
- **남은 과제 명시**: Telegram listener의 실제 수신 채널 환경변수 정리, `unsupported_chains` 로그의 fatal/error 분리, top transaction 카드의 사람 언어화, whale stories stale/archive 배지, unknown token 가격 보강은 후속 개선 항목으로 분리하였다.

### 가설 수정 기록

- **초기 가설**: 유료 Whale Alert API 사용이 데이터 품질 확보에 필수적.
  - **수정**: 공개 채널 수신과 Etherscan 직접 수집의 조합이 동등하거나 우수한 품질을 더 낮은 비용과 짧은 구축 시간으로 제공함을 확인. 이후 전체 스택에서 유료 데이터 API 의존을 제거.
- **초기 가설**: 사용자 UI는 Streamlit으로 구축하는 것이 단기 효율성 측면에서 최적.
  - **수정**: 타겟 페르소나(일반 투자자)가 접근하는 "제품"으로서의 완성도가 Streamlit으로는 충분히 전달되지 않는다고 재평가. Next.js로 전환하고, Streamlit 구현은 로컬 진단 용도로만 유지.
- **유지된 가설**: 탐지 계층과 해설 계층의 분리. 테스트 용이성, 결과 재현성, 비용 측면에서 일관되게 긍정적인 결과를 산출.

---

## 6. AI 도구 활용 방식

### 6-1. 개발 단계 AI 활용

| 도구 | 활용 범위 | 구체적 활용 방식 |
|---|---|---|
| Codex (OpenAI) | 병렬 개발, QA, 운영 문서 보강 | 최근 개선 사이클에서 병렬 서브태스크 실행, 회귀 수정, 빌드/테스트 검증, README·운영 runbook·Obsidian 보고서 정리를 담당. 사용자는 우선순위와 제품 판단을 제공하고, Codex는 구현과 검증 실행을 맡는 분업 구조로 활용. |
| Claude Code (Opus) | 코드 생성, 리뷰, 리팩터링 | `.claude/` 디렉토리에 프로젝트 컨벤션 및 에이전트 설정을 유지. 구현의 상당 부분이 Claude Code와의 페어 프로그래밍으로 진행됨. 설계 판단은 사람이 수행하고, 구현 편집은 AI가 수행하는 분업 원칙을 적용. |
| Cursor | 인라인 수정, 자동완성 | 작은 diff, 리팩터링, 임포트 정리 등 저수준 편집에 활용. |
| Claude (Obsidian 연동) | 기획 및 아키텍처 문서 초안 작성 | `docs/` 및 Obsidian 볼트의 기획 문서 작성에 활용. |

### 6-2. 런타임 AI 활용 (제품 내부 구조)

`src/llm/router.py`의 `LLMRouter`는 3개 provider를 task별 preferred/fallback 매트릭스로 라우팅합니다. 라우팅 매트릭스는 `config/llm_routing.yaml`에 외부 설정으로 선언되어 있고, 6개 task(`per_signal_narration`, `daily_brief`, `daily_brief_en`, `daily_brief_ja`, `weekly_trend`, `nl_intent`)별로 preferred 모델과 fallback chain을 task 특성(언어·정밀도·길이)에 맞게 분리해두었습니다.

1. **Anthropic Claude (Sonnet / Haiku)**: 긴 맥락 처리 및 미묘한 한국어/일본어 해설 품질에서 우수한 성능. `daily_brief`, `daily_brief_ja`, `weekly_trend`, `nl_intent` 4개 task의 preferred로 선언.
2. **Google Gemini 2.5 Flash**: 한국어 품질이 양호하고 무료 tier가 후한 모델. `per_signal_narration`, `daily_brief_en` 2개 task의 preferred + 4개 task의 1차 fallback.
3. **Groq Llama 3.3 70B Versatile**: 저지연이 요구되거나 상위 provider가 모두 실패한 경우의 최종 fallback.

**현 운영 상태 (2026-04 기준)**: MVP 단계에서 운영 비용을 0에 가깝게 통제하기 위해 의도적으로 Anthropic API key를 활성화하지 않았습니다. 그 결과 LLMRouter의 fallback 로직(`src/llm/router.py`의 `if provider is None: continue`)이 작동해 **6개 task 모두 Gemini 2.5 Flash가 실 호출**되고 있으며, Groq Llama 3.3 70B가 백업 fallback으로 대기 중입니다. `analysis_log` 시트의 `model` 컬럼이 라이브 증거입니다. 운영 본궤도 진입 시점에 Anthropic key를 추가하면 4개 task가 즉시 Sonnet/Haiku로 승격되도록 설계되어 있습니다.

**구조 채택 근거**: 단일 LLM provider 의존은 운영 가용성 측면에서 실질적 리스크를 구성합니다. 단일 provider의 30분 장애가 서비스 전체의 30분 장애로 전이됩니다. 3-provider fallback 매트릭스는 (provider 키 미설정·호출 실패·rate limit 도달 등) 어느 경우에도 다음 candidate로 자동 진행하여 서비스 가용성을 유의미하게 개선합니다. 또한 `config/llm_routing.yaml` 외부 설정 덕분에 키 한 줄 추가/제거만으로 모델 라인업을 즉시 재구성할 수 있습니다.

### 6-3. AI 활용의 운영 원칙

- **AI에 판단이 아닌 실행을 위임**: 탐지 규칙은 결정론적 Python 함수로 구현하며, LLM은 해설 역할에 한정.
- **프롬프트의 버전 관리**: `prompts/` 디렉토리에 브리핑 생성 및 요약 프롬프트를 파일로 유지하고 git으로 추적.
- **AI 출력의 직접 신뢰 금지**: LLM 응답은 Pydantic 모델로 스키마 검증을 수행하고, 검증 실패 시 fallback provider로 재시도.
- **AI 생성 코드의 사전 검증**: 402개의 pytest 케이스가 회귀 방지 역할을 수행하며, 리뷰 없는 머지를 구조적으로 차단. dashboard 영역은 `npm run dashboard:typecheck`, `dashboard:lint`, `dashboard:build`, `dashboard:e2e`로 정적·동적 검증을 분리 수행.

---

## 7. 현재 제약 및 향후 과제

### 7-1. 현재 제약 사항

1. **체인 커버리지 편향 — 구조적으로 해소됨, UTXO 고도화는 후속 과제**: Day 7에서 식별한 ETH/SOL 중심 편향은 Day 9 사이클에서 `ChainCollectorRegistry` + feature flag 구조로 해소되었습니다. 현재 XRP / TRX / BTC / DOGE collector가 구현되어 있으며 BTC는 primary 실패 시 Blockchair secondary로 fallback합니다. 다만 BTC/DOGE는 UTXO 특성상 현재 대표 주소 seed 기준 partial view로 동작하며, UTXO cluster 기반 보유량 정밀 추적은 Phase 3.5 고도화 과제로 분리되어 있습니다.
2. **사용자 피드백 루프 미구현**: 브리핑 내 긍정/부정 피드백 버튼이 설계 단계에는 반영되었으나 MVP에는 포함되지 않았습니다. 북극성 지표와 가장 근접한 정성적 신호로서, 런칭 직후 최우선 구현 대상입니다.
3. **가격 및 시장 맥락 결합의 제한**: 현재 사용자 홈에 Binance/Upbit/Bitflyer/Kraken 멀티소스 티커, 김치 프리미엄, Fear & Greed 게이지가 별도 섹션으로 존재하지만, 브리핑 본문이 이 맥락을 LLM 프롬프트에서 적극 활용하지는 않습니다. 가격 수준 및 거시 시장 상황과 온체인 이벤트의 결합 수준은 아직 제한적이며, full brief 컨텍스트에 시장 지표를 추가 주입하는 것이 다음 개선 대상입니다.
4. **개인화 강도의 한계**: Watchlist는 토큰 단위 필터만 지원하며, 사용자별 위험 선호도, 선호 시간대 등의 차원은 반영되지 않습니다.
5. **RSS news context 선택 로직**: 현재 `published_at` 기준 최신 N건만 full brief 컨텍스트에 주입하며, 고래 이벤트와의 relevance 점수 기반 정렬은 미구현 상태입니다. 결과적으로 주제와 무관한 최신 기사가 컨텍스트에 포함될 여지가 남아 있습니다.

> **Day 10~12 사이클에서 해소된 항목 (참고)**: 이전 판본에서 "현재 제약"으로 잡혀 있던 (a) Google Sheets 429 / 다인스턴스 쿼터 경합, (b) 대시보드 초기 로딩 체감 지연, (c) 모바일 터치 타깃/레이아웃 overflow, (d) Sheets 10M cell 한도는 Day 10~11 사이클에서 구조적으로 해결되었습니다. 현재 운영 데이터 원천은 PostgreSQL primary이며, Google Sheets는 legacy/mirror 확인 경로입니다. Day 12에는 Postgres table key 가정 오류로 인한 수집 freshness 장애를 복구하고, 유저홈 fallback 브리핑의 데이터 품질 표시를 보강했습니다.

### 7-2. 향후 2주 로드맵

Day 8~10 사이클에서 초기 로드맵의 Phase 0 / 1 / 2a / 2b / 3 / 4와 폴리싱 Phase A~F가 구현 완료 상태로 전환되었습니다. 현재 기준 남은 우선순위는 아래와 같습니다.

완료 항목 (참고):

- ✅ Phase 0 — Silent drop 가드 구현: `ChainCollectorRegistry`와 Service Health v2로 구조화.
- ✅ Phase 1 — Telegram 미러링 레인의 공식화: `observation_source=tg_mirror`, `external_only_observation` / `corroborated_move` 흐름 반영.
- ✅ Phase 2a — XRP 체인 확장: XRPSCAN-compatible collector 구현, feature flag로 canary.
- ✅ Phase 2b — TRX 체인 확장: TronGrid native + TRC20 collector 구현.
- ✅ Phase 3 — BTC 체인 확장: mempool.space primary + Blockchair secondary fallback 구조.
- ✅ Phase 4 — DOGE + per-chain signal override 구현.
- ✅ 하이브리드 브리핑: full / incremental 분기로 **Sonnet 기준 추정 월 비용이 약 $21 → $9**로 감소하는 설계. 현 운영은 Gemini 2.5 Flash + Groq Llama 3.3 70B 주력으로 실측 비용은 더 낮음.
- ✅ Render observability: `/admin`에서 서비스/배포/인스턴스/로그 통합 관측.
- ✅ Phase A — Suspense + `await` 병렬화 및 dashboard 서버 컴포넌트 waterfall 해소.
- ✅ Phase B — 대시보드 모달·차트의 `next/dynamic` lazy load 전환 및 recharts → 순수 SVG 치환.
- ✅ Phase C — Google Sheets 429 구조적 해결: Redis REST L2 (60s TTL) + 프로세스 로컬 Map L1 (45s TTL) 2-tier 캐시.
- ✅ Phase D — Vercel serverless region `icn1` 고정, `optimizePackageImports`, tier-based TTL 적용.
- ✅ Phase E — 모바일 접근성 전수 정비: WCAG 2.5.5 44×44 px 터치 타깃, `min-width: 0` / `minmax()` grid 가드, `Intl.DateTimeFormat` TZ 고정.
- ✅ Phase F — Speed Insights 활성화로 Production 실사용자 LCP/FCP/CLS/TTFB 회귀 감시.

남은 우선순위 (2주 단위):

1. 브리핑 피드백 버튼 구현 (약 4시간 추정): 북극성 지표와 근접한 사용자 정성 신호 확보. 런칭 이후 가장 먼저 필요한 데이터 축.
2. 시장 맥락의 브리핑 결합 고도화 (약 8~12시간 추정): 이미 사용자 홈에 존재하는 티커/Fear&Greed 신호를 full brief 프롬프트에 구조화된 컨텍스트로 주입.
3. RSS news relevance scoring (약 6시간 추정): published_at 기준 단순 최신 정렬을 고래 이벤트 키워드 매칭 기반 relevance 점수로 교체.
4. UTXO cluster 고도화 (Phase 3.5, 약 16~24시간 추정): BTC/DOGE partial view를 cluster 기반 보유량 정밀 추적으로 확장. 운영 데이터 누적 이후 우선순위 재판단.
5. Haiku 혼합 라우팅 실측 (약 4시간): 하이브리드 브리핑 비용을 추가로 절감할 수 있는지 incremental slot을 Haiku로 라우팅하여 정량 평가.
6. `chain_contract.yml` 주간 스케줄 승격 여부 결정 (약 2시간): 현재 manual-only인 live contract test를 주기적 실행으로 전환할지 판단.
7. 운영 상태 의미 체계 정리 (약 4시간): `signals=0`과 pipeline 실패를 구분하고, stale signal/stale story는 "장애"가 아니라 "신규 임계값 미충족" 또는 "아카이브"로 노출.
8. 유저홈 브리핑 사람 언어화 (약 6~8시간): top transaction 3~5건을 단순 객체/숫자가 아니라 "무슨 이동이고 왜 볼 만한지"로 변환하는 카드 UI 보강.

### 7-3. 6개월 관점의 지향점

- 체인 커버리지: 2개 → 8개 (BTC/ETH/SOL/XRP/TRX/BSC/Polygon/DOGE)
- Brief Open Rate 60% 수준 유지 및 D30 Retention 20% 이상 확보
- 무마케팅 유기적 기준 구독자 1,000명 확보
- 월간 운영 비용 80달러 이하 유지 (현재는 사실상 $0 수준의 저비용 구조 유지)

---

## 8. 실행 및 검증

### 8-1. 로컬 실행 절차

상세 내용은 [README.md](README.md)에 정리되어 있습니다.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # API 키 입력 (상세 가이드는 README 참조)

python -m scripts.init_postgres
python scripts/import_watched_addresses.py --backend postgres
python scripts/smoke_pipeline.py   # 외부 의존성 없이 fallback smoke 검증
python -m src.pipeline.run_all     # 파이프라인 1회 실행

npm install && npm run dashboard:dev   # Next.js 대시보드 (사용자: /, 운영자: /admin)
```

### 8-2. 검증 결과

- `pytest -q`: **402 passed** (계약·단위·통합·체인 커버리지·TG mirror 회귀 포함)
- `scripts/smoke_pipeline.py`: **SMOKE OK** (외부 의존성 없이 파이프라인 정합성 검증)
- Next.js 대시보드 정적·동적 검증 전부 통과:
  - `npm run dashboard:typecheck` — TypeScript 타입 검사 통과
  - `npm run dashboard:lint` — ESLint / stylelint 통과
  - `npm run dashboard:build` — 프로덕션 빌드 성공
  - `npm run dashboard:e2e` — Playwright 기반 E2E 통과
- Day 10 번들 / 로딩 성능 실측 (Vercel Production 빌드 기준):
  - 홈 `/` route size: **193 kB → 86.1 kB (-55%)**
  - 홈 `/` First Load JS: **312 kB → 206 kB (-34%)**
  - `/admin`: 0 회귀 (빌드 size / First Load JS 동일 수준 유지)
  - Stream API `maxDuration`: 300s → 60s, transaction snapshot은 최근 200건 + aggregate-only로 슬림화
- 운영 진단 엔드포인트: `/api/debug/dashboard?mode=env`, `?mode=redisPing` (`DASHBOARD_DIAG_TOKEN` 게이트), Vercel Speed Insights(실사용자 LCP/FCP/CLS/TTFB) 상시 관측.

### 8-3. 아키텍처 개관

```text
  ┌───────────── ChainCollectorRegistry (feature-flag 기반) ─────────────┐
  │                                                                       │
  │  [Etherscan] [Solscan] [XRPSCAN] [TronGrid] [mempool.space]  [Dogechain] │
  │    (ETH)      (SOL)     (XRP)    (TRX/TRC20)   (BTC primary)    (DOGE)   │
  │                                                    │                     │
  │                                             ┌──────┴──────┐              │
  │                                             ▼  (primary 실패 시)          │
  │                                        [Blockchair]                       │
  │                                        (BTC/DOGE secondary fallback)      │
  └───────┬──────────────────────────────┬─────────────────────┬──────────┘
          │                              │                     │
          ▼                              ▼                     ▼
   [Telegram Listener]              [Ingestion]          [Market Ticker]
   @whale_alert_io →                observation_          Binance/Upbit/
   observation_source=              source=onchain        Bitflyer/Kraken
   tg_mirror                                              + 김치 프리미엄
          │                              │                     │
          └──────────────┬───────────────┘                     │
                         ▼                                      │
           [SignalEngine (per-chain rules, external_only /      │
            corroborated_move / full-view / partial-view)]      │
                         │                                      │
                         ▼                                      │
          [LLMRouter: Anthropic → Gemini → Groq fallback]       │
           · hybrid brief: full @ KST 09/15/21, incremental otherwise
                         │                                      │
                         ▼                                      │
                 [PostgreSQL primary storage]                   │
                         │                                      │
                         ▼                                      │
       ┌───────────────────────────────────────────┐            │
       │  Legacy/mirror: Google Sheets             │            │
       │  L2 cache: Upstash Redis REST             │            │
       │  L1 cache: Next.js server Map             │            │
       │  · Postgres 우선, Sheets는 확인/이관 경로  │            │
       └───────────────────────────────────────────┘            │
                         │                                      │
           ┌─────────────┼─────────────────────────┐            │
           ▼             ▼                         ▼            ▼
   [Telegram Bot]  [Upstash Redis SSE]    [Next.js App Router]  │
   (broadcast:     (WHALESCOPE_SSE_       / 사용자 홈 + /admin 운영 ◀───┘
    DRY_RUN 가드)   ENABLED 3-gate 체크)    + Fear & Greed + News RSS
                     keys: whalescope:      + Whale Stories 4-card lane
                       live-update:*       + CORS proxy (upbit/bitflyer)
                   ※ SSE와 Sheets L2는      + Speed Insights 실사용자 계측
                     동일 Upstash 인스턴스    · Vercel region: icn1 (Seoul)
                                            · First Load JS 312→206 kB
                                                       │
                                                       ▼
                                     [Render REST API observability]
                                   pipeline / bot / listener 3 workers
                                  Service Health v2 heartbeat (instance_id,
                                   processed_count, lag_seconds, duration_ms)
```

---

## 9. 결어

WhaleScope는 "AI로 어떤 제품을 만들 수 있는가"가 아니라 "타겟 사용자의 일일 정보 소비 시간을 어떻게 더 의미 있게 만들 수 있는가"라는 질문에서 시작하였습니다. 7일간의 작업 과정에서 가장 빈번하게 적용한 판단 기준은 "본 기능이 부재할 경우에도 타겟 문제가 해결되는가"였으며, 해당 질문에 대한 답이 긍정인 기능은 모두 MVP 스코프에서 제외하였습니다.

제출 구성은 동작하는 MVP와 해당 MVP의 현재 한계를 명시적으로 드러낸 후속 개선안으로 이루어져 있습니다. 과제 원문이 제시한 평가 기준, 즉 문제 발견, 가설 설정, 소규모 제품을 통한 빠른 검증의 세 단계가 해당 구성에 일관되게 반영되어 있다고 판단하여 제출합니다.

감사합니다.
