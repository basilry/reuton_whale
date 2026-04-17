# Changelog

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
