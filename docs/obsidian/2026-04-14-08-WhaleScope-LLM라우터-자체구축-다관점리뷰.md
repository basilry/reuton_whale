---
date: 2026-04-14
sequence: 8
project: WhaleScope (02015_reuton_whale)
type: multi-perspective-review
subject: OpenRouter 대신 자체 LLM 라우터를 구축하는 의사결정
related: [[2026-04-14-07-WhaleScope-OpenRouter-다관점리뷰]], [[2026-04-14-06-WhaleScope-자체수집-전환계획-v2]]
tags: [decision-review, llm, self-build, architecture, cost]
---

# 자체 LLM 라우터 구축 다관점 리뷰

OpenRouter 리뷰(종합 7.5)의 대안으로, Anthropic·Gemini·Groq 등 공급자 API 키를 직접 보유하고 내부 라우터를 구축하는 의사결정을 동일 6관점으로 평가한다.

## 0. 검토 대상 결정

- **대상 대안**: `src/analyzer/llm/` 아래 공급자별 adapter + 라우터를 직접 작성.
- **초기 공급자 3개**: Anthropic, Google Gemini, Groq.
- **스코프 제한 원칙**: streaming·tool-use 지연, 공급자 3개 고정, usage는 응답 필드 파싱만.
- **예상 초기 공수**: 1.5~2일. 유지보수 월 1~2시간.

## 1. Engineering / Architecture 관점

### 긍정
- **통제권**: Anthropic prompt caching, Gemini 1M context, Groq의 극저 latency 등 공급자 고유 기능에 제약 없이 접근.
- **외부 SPOF 제거**: 게이트웨이 다운으로 인한 전면 장애 경로 소멸. 한 공급자 장애는 다른 공급자로 폴백.
- **라우터 인터페이스가 도메인에 맞게 설계 가능**: WhaleScope가 실제로 원하는 시그니처(`call(system, user, max_tokens) -> LLMResult`)로 축소 가능.
- **테스트 용이**: 각 adapter를 `MagicMock(spec=LLMProvider)`로 교체.

### 부정
- **공급자 4개 특성 흡수**: 인증 방식·에러 코드·rate limit 시그널·토큰 계측 필드가 전부 다름. 각 adapter가 50~70 LOC로 끝나도 그 지식을 유지해야 함.
- **SDK 파손 대응**: 공급자가 breaking change를 낼 때마다 직접 대응. (OpenRouter는 이걸 흡수해줬음.)
- **리포트 파편화**: 사용량·비용·오류율 대시보드를 자체로 구성해야 집계 가능(최소 `system_log` 기반 쿼리).

### 점수: **7/10**
제어권과 테스트 용이성을 얻는 대신 유지보수 비용을 감당. WhaleScope 규모에선 감당 가능하나 공급자 5개를 넘으면 급격히 붕괴.

## 2. Cost / FinOps 관점

### 긍정
- **무료 티어 직접 소비**:
  - Gemini 1.5 Flash 직접: **15 RPM, 1M tokens/day 무료** → 일간 파이프라인 전체를 무료로 처리 가능.
  - Groq (Llama 3.3 70B): **~30 RPM 무료**, 응답 초고속.
  - OpenRouter free의 200/day보다 10배 이상 여유.
- **공급자 고유 비용 최적화 접근**:
  - Anthropic prompt caching → 반복 system prompt에서 토큰 비용 **최대 90% 절감**. WhaleScope처럼 프롬프트 본체가 거의 고정인 워크로드에 직접 효과.
- **마크업·수수료 없음**. BYOK 정책 변동 리스크 없음.
- **크레딧 만료 개념 없음**.

### 부정
- 결제 창구 3개(Anthropic/OpenAI/Gemini) 관리. 자동 충전 설정·실패 알림을 각각 구성.
- 공급자별 무료 티어는 정책이 수시로 바뀜 → 쿼리 코드에 '이 티어 가정' 주석 필수.

### 점수: **9/10**
직접 통합이 무료 티어에서 실질적으로 더 유리. 운영비 0 유지 가능성이 OpenRouter보다 높다.

## 3. Product / UX 관점

### 긍정
- **공급자 고유 기능으로 품질 상승**:
  - Gemini long context로 주간 트렌드 코멘터리 시 30일치 시그널 동시 투입 가능.
  - Anthropic caching으로 자연어 개인화 응답 latency 감소(캐시된 system 재활용).
- **Latency ↓**: 직접 호출은 OpenRouter 경유 대비 50~150ms 짧음. 텔레그램 즉답 UX에 반영.

### 부정
- **톤 일관성** 리스크는 OpenRouter와 동일. 작업별 단일 모델 고정 + 프롬프트 버전 로깅이 여전히 필수.
- 공급자별 응답 형식·길이 편차가 있어, 어떤 모델이 한국어 브리프에 더 좋은지는 실측으로 결정해야 함.

### 점수: **8/10**
기능 접근성의 이점이 실사용자 품질로 전달될 여지가 크다.

## 4. Security / Privacy / Compliance 관점

### 긍정
- **중간 경유자 없음**: 거래 요약·사용자 발화가 OpenRouter 서버를 거치지 않고 선택한 공급자에게만 전달.
- **PIPA 처리위탁 공시**: 대상 공급자만 명시하면 됨(OpenRouter라는 추가 entity 없음).
- **키 격리**: 공급자별 키를 독립적으로 회전·폐기 가능. 한쪽 유출의 폭발 반경 축소.

### 부정
- 키 관리 표면 증가(3개 secret). 로테이션 주기·접근제어를 각각 설계.
- 각 공급자의 데이터 보존·재학습 정책을 **개별 검토** 필요(OpenRouter는 그 흡수판을 제공했음).

### 점수: **8/10**
경유자 제거 이득이 키 관리 증가분을 상쇄.

## 5. Operations / Reliability 관점

### 긍정
- **단일 외부 SPOF 없음**. 공급자 다중화로 한 곳 장애에도 파이프라인 지속.
- 공급자별 SLA 특성을 직접 관측·튜닝 가능.

### 부정
- **폴백·서킷브레이커·retry 정책을 직접 작성**. OpenRouter가 제공하던 "공급자 자동 폴백"의 품질을 자체 코드가 동급으로 끌어올려야 함.
- 에러 모드 문서화·대응 런북을 공급자 수만큼 준비.
- rate limit 추적을 각 공급자별로 구현(헤더 파싱 규칙이 다름).

### 점수: **6/10**
안정성의 이점이 있지만 운영 코드를 직접 짜야 한다는 비용이 큼. 초기엔 낮게 시작해 점진적 강화.

## 6. Career / Demo 관점

### 긍정
- **설계 역량 증명**: "프로덕션 수준 LLMRouter를 설계·구현했다 — 폴백, 비용 추적, 프롬프트 버전, 공급자 고유 최적화 활용까지"는 **가장 강한 어필 포인트 중 하나**.
- 의사결정 트레이드오프를 설명할 수 있는 재료가 풍부: "왜 OpenRouter 대신 자체 구축인가, 언제 반대로 가야 하는가" 자체가 면접 답변.
- Anthropic caching·Gemini long context 같은 최신 기능을 실제로 구현하는 경험.

### 부정
- 면접관이 "그 시간을 도메인 가치에 투자했어야 하지 않나?"라고 반대 질문 가능. 답변: "포트폴리오 + 소규모 + 운영비 0 요구사항에서 자체 구축의 총비용이 OpenRouter 대비 1일 내외, 얻는 역량·유연성이 그 비용 이상"이라고 수치화.

### 점수: **9/10**
포트폴리오 맥락에서 자체 구축의 우위가 가장 뚜렷한 관점.

---

## 7. 종합 점수 및 비교

| 관점 | 자체 구축 | OpenRouter | 승자 |
|---|---|---|---|
| Engineering | 7 | 8 | OpenRouter |
| Cost / FinOps | 9 | 9 | 백중 (자체 구축 무료 티어 우위) |
| Product / UX | 8 | 7 | 자체 구축 |
| Security / Privacy | 8 | 6 | 자체 구축 |
| Operations | 6 | 7 | OpenRouter |
| Career / Demo | 9 | 8 | 자체 구축 |
| **종합** | **7.8** | **7.5** | **자체 구축 근소 우위** |

## 8. 권고: **자체 구축 채택**

WhaleScope 맥락(포트폴리오 + 소규모 + 운영비 0 목표)에서 자체 구축이 정답에 더 가깝다. 단 **스코프 봉쇄 3원칙**을 엄격히 지킨다.

1. **공급자 3개 고정**: Anthropic, Gemini, Groq. OpenAI는 필요 시점에만 추가. 그 이상은 OpenRouter 재평가 트리거.
2. **streaming·tool-use 지연**: 단발성 `prompt → text` 인터페이스만. 필요해지면 그때 확장.
3. **usage는 응답 필드 파싱만**: 공급자 대시보드 API 연동 금지. `system_log`에 적재.

### 동반 가드레일 (OpenRouter 리뷰와 동일)
1. 동일 산출물은 동일 모델 고정 — 톤 일관성.
2. `analysis_log`에 `model_id` + `prompt_version` 기록 — 회귀 추적.
3. README/약관에 공급자별 데이터 처리위탁 명시.
4. 호출당 (model, tokens_in, tokens_out, cost_usd, latency_ms) 계측. 월 예산 초과 시 Telegram 알림.

## 9. Reject 트리거 (자체 구축 → OpenRouter 회귀)

- 공급자 추가 필요가 3개 → 5개로 증가
- SDK 파손 대응에 월 4시간 초과
- 사용자 1K+ 도달, 폴백·서킷브레이커 품질이 자체 구현 역량을 초과
- 공급자 중 2개 이상이 BYOK 정책 없이 게이트웨이 경유만 허용하는 경우

## 10. 다음 작업

1. `src/analyzer/llm/` 디렉터리 신설: `base.py`(Protocol), `anthropic.py`, `gemini.py`, `groq.py`, `router.py`, `usage.py`.
2. 기존 `ClaudeAnalyzer`를 `LLMAnalyzer`로 리네이밍하고 Router 의존으로 변경.
3. 모델 매핑 YAML: `config/llm_routing.yaml` — 작업별 preferred/fallback 모델 정의.
4. `system_log` 스키마에 usage 컬럼 추가.
5. engineering:architecture 스킬로 정식 아키텍처 문서 작성.

---

관련 문서: [[2026-04-14-07-WhaleScope-OpenRouter-다관점리뷰]], [[2026-04-14-06-WhaleScope-자체수집-전환계획-v2]]
