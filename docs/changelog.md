# Changelog

## 2026-04-27 -- ONE_PAGER · README 비용 표현 정합성 수정

### Why (문제)

면접·심사 자료 사실 정합성 점검 중 `ONE_PAGER.md`와 `README.md`의 LLM 비용 문구가 운영 실태와 어긋난 부분을 발견했다.

1. **"$21 → $9 감소"가 실측 절감처럼 표현됨**: 해당 수치는 `2026-04-19-08-WhaleScope-v6-개선완료보고서.md`에서 산출한 **하이브리드 브리핑 설계 효과 추정치**(매 cycle full × Sonnet 가정)이지 실측 절감 금액이 아니다.
2. **"Anthropic Claude (preferred)" 단언이 현 운영 상태와 불일치**: 현 단계에서는 MVP 비용 통제 목적으로 Anthropic API key를 활성화하지 않았고, `LLMRouter`의 fallback 로직이 작동해 6개 task 모두 Gemini 2.5 Flash가 실 호출되고 있다. Groq Llama 3.3 70B가 백업 fallback으로 대기 중.
3. **"fallback은 상위 provider 실패 시에만 호출됨" 표현이 정확하지 않음**: provider 키 미설정 시에도 `if provider is None: continue`로 자동 skip되어 fallback chain이 진행되므로, "키 미설정 또는 호출 실패 시"로 정확히 표현해야 한다.

### What (변경)

- **`ONE_PAGER.md`** (4곳)
  - §4-6 KPI 표 "브리핑 비용 (Mar 2026)" 행: `$9.12` 옆에 "추정" 라벨 추가, Sonnet 추정 모델 기준임과 현 운영(Gemini Flash + Groq) 주력 사실을 주석으로 명시.
  - §5 Day 8 v6 개선 사이클 항목: "Sonnet 기준 월 비용이 약 $21 → $9 수준으로 감소" → "Sonnet 기준 **추정** 월 비용이 약 $21 → $9 수준으로 감소하는 설계. 다만 현 운영은 Anthropic key 미활성 상태로 Gemini 2.5 Flash + Groq Llama 3.3 70B를 주력으로 사용 중이며, 실측 비용은 위 추정치보다 낮음".
  - §6-2 런타임 AI 활용 절: provider 3개 단순 나열을 task별 라우팅 매트릭스 + 현 운영 상태 단락으로 재작성. Anthropic key 미활성과 라이브 fallback 동작을 사실 그대로 명시. "fallback은 상위 provider 실패 시에만 호출됨"을 "키 미설정·호출 실패·rate limit 도달 등 어느 경우에도 다음 candidate로 자동 진행"으로 수정.
  - §7-1 누적 액션 아이템 체크리스트: "✅ 하이브리드 브리핑 ... 월 비용 약 $21 → $9" → "**Sonnet 기준 추정** 월 비용이 약 $21 → $9로 감소하는 설계. 현 운영은 Gemini 2.5 Flash + Groq Llama 3.3 70B 주력으로 실측 비용은 더 낮음".
- **`README.md`** (1곳)
  - 하이브리드 브리핑 설명 단락: "Sonnet 기준 월 비용이 약 $21에서 $9 수준으로 감소합니다" → "Sonnet 기준 **추정** 월 비용이 약 $21에서 $9 수준으로 감소하는 설계. 현 운영은 Anthropic API key 미활성으로 Gemini 2.5 Flash + Groq Llama 3.3 70B 주력. 실제 체감 비용은 위 추정치보다 낮음. `config/llm_routing.yaml` 외부 설정으로 키 추가만으로 Sonnet/Haiku 승격 가능".

### How validated (검증)

- **사실 근거 재확인**: `config/llm_routing.yaml` 6 task 매트릭스(Sonnet/Haiku · Gemini Flash · Groq Llama 3.3 70B), `src/llm/router.py` `if provider is None: continue` fallback 로직, `.env` `ANTHROPIC_API_KEY=` 미설정 상태 모두 코드 인스펙션으로 확인.
- **추정치 출처 추적**: `2026-04-19-08-WhaleScope-v6-개선완료보고서.md` "기존 추정 매 사이클 full $0.03 × 24 × 30 ≈ $21/월 vs 하이브리드 일 3 full + 21 incremental ≈ $9/월" 산출 근거 확인.
- **실측 KPI**: `brief_cost_ledger` Mar 2026 = $9.12 — 추정 모델과 거의 일치(추정 모델이 합리적이라는 정합성 증거).

### Risks (남은 리스크)

- **옵시디언 미러 스냅샷 (`docs/obsidian/2026-04-21-01-...-README-스냅샷.md`, `2026-04-21-02-...-ONE_PAGER-스냅샷.md`)** 은 의도적으로 4/21 시점을 박제한 문서이므로 갱신하지 않음. 면접에서 미러 스냅샷을 인용할 경우 4/27 본문과 표현이 다를 수 있다는 점에 유의.
- **Anthropic key 활성화 시점**: 운영 본궤도(Postgres 전환 + 사용자 규모 확대) 진입 시 key를 추가하면 4 task가 즉시 Sonnet/Haiku로 승격되도록 설계. 활성화 후 brief_cost_ledger 실측 비용을 1주 이내 재측정해 ONE_PAGER §4-6 KPI 표에 반영해야 한다.
- **API 키 노출 사고 회수**: 본 작업 과정에서 `.env` 평문 키가 컨텍스트에 노출되어 사용자가 Gemini·Groq 키를 회전(폐기 후 재발급) 처리. 향후 `.env`는 절대 컨텍스트에 들어오지 않도록 도구 호출 패턴(전체 파일 read 대신 키 부분만 mask grep) 주의.

---

## 2026-04-17 -- 리스너 언블록 · 시스템 로그 UX · CEX 노이즈 분리

### Why (문제)

1. **Telethon listener 이벤트 루프 블록킹**: `router.call_task`와 `storage.append_*`를 동기 호출하면서 asyncio 이벤트 루프를 점유했다. Telegram polling이 밀리고 heartbeat 로그가 튀는 증상으로 표면화됐다.
2. **대시보드 운영 알림 센터의 raw JSON 노출**: 시스템 로그가 JSON-ish 원문 그대로 렌더링돼 운영자가 해석하려면 Google Sheets를 별도로 열어야 했다.
3. **교환소-교환소 리밸런싱 노이즈**: `cex_outflow_spike` / `cex_inflow_spike` 룰이 거래소 간 내부 이전까지 시그널로 발화시켜 품질이 저하됐다.
4. **브리프 정제 유틸 파편화**: `cleanGeneratedBrief` 등이 `app/page.tsx`에 흩어져 있어 재사용과 테스트가 어려웠다.
5. **Signal 파이프라인 게이트 누락**: `_signals_to_top5`가 score 0 이하 시그널도 배포 후보에 포함해 low-value 알림이 섞였다.

### What (변경)

- **A단계 / Pipeline Core** -- `src/utils/datetime_utils.py` 신설로 중복된 `_parse_dt` 세 곳을 단일화, `_signals_to_top5`에 `score > 0` 필터 가드 추가, Gemini 2.5 단가 반영과 `ANALYSIS_LOG_HEADERS`에 `status` 컬럼 추가, `send_daily_brief`에 `brief_texts` 인자를 통한 LLM 해설 파이프라인 완결.
- **B단계 / Dashboard UX** -- `MetricCardAction.href?`로 `<a>` / `<button>` 분기 렌더링, 서비스 카드 CTA에 섹션 앵커(`#log`, `#signals`) 연결, `SystemLogPanel` 컴포넌트 구현(모달 · ESC · 백드롭), `humanizeLogMessage`로 로그 한국어 변환.
- **C단계 / Listener & Storage** -- `_tg_direction`에서 교환소↔교환소를 `cex_to_cex`로 분리, `asyncio.to_thread`로 리스너 블록킹 3개소 언블록, `health_status()`와 에러 카운팅 테스트 추가, `Storage.list_tg_whale_events` 반환 타입 좁힘과 `limit` 파라미터 도입.
- **D단계 / Shared Utilities** -- `cleanGeneratedBrief`를 `apps/dashboard/lib/format.ts`로 이관, `_safe_float` 실패 경로에 컨텍스트 로깅 추가, `list_tg_whale_events` 엣지 케이스(빈 시트, since=None, timezone-naive) 테스트 커버리지 확장.
- **E단계 / Code Review 후속** -- `src/signals/rules.py` 모듈 docstring에 `cex_to_cex` 의도적 제외 설계 명시, `config/signals.yaml` CEX 룰 3건에 주석 추가로 회귀 차단, `SheetsClient` 9개 write/upsert 메서드에 `threading.Lock` 직렬화 적용(`asyncio.to_thread` 경쟁 상태 제거).

### How validated (검증)

- **Python 유닛 테스트**: `pytest tests/ -q` -- 277 passed (기존 275 + `test_sheets_client_lock.py` 2건). deprecation warning 6건은 기존 수준 유지.
- **정적 가드**: `grep -c "with self._write_lock" src/storage/sheets_client.py == 9` 로 lock 적용 범위 확인, `tests/test_sheets_client_lock.py`가 `inspect.getsource` 로 write 메서드가 lock 블록 안에 있는지 재검.
- **대시보드 빌드**: `cd apps/dashboard && npm run build` 성공, SystemLogPanel 모달 수동 확인(ESC · 백드롭 · 클릭).
- **YAML 스키마**: `python -c "import yaml; yaml.safe_load(open('config/signals.yaml'))"` -- rules 8개 로드 확인.
- **리스너 스모크**: `python scripts/run_listener.py` 로컬 실행으로 heartbeat 로그가 더 이상 튀지 않고 5분 주기 health log만 출력됨을 확인.

### Risks (남은 리스크)

- **Threading.Lock은 프로세스 내부 직렬화만 보장**: 다수 워커 프로세스가 동일 Google Sheets를 건드리면 여전히 race 발생 가능. 장기적으로는 append-only queue(예: Redis Streams)로 이관이 필요.
- **Gemini 2.5 단가 공식 발표 전**: `src/llm/usage.py`의 단가는 공개 프리뷰 가격 기준이며, GA 시 재확인 필요.
- **`cex_to_cex` 카테고리 누적**: 별도 룰로 활용하지 않으면 storage에는 적재되지만 소비처가 없는 상태. 후속으로 `cex_venue_rebalance` 룰 신설 여부를 판단해야 한다.
- **LISTENER_STALENESS_SECONDS 기본 900s**: 실제 운영에서는 채널 활성도에 따라 300s~1800s 범위로 조정이 필요할 수 있으며, 값이 너무 작으면 health status가 stale로 자주 뜬다.
