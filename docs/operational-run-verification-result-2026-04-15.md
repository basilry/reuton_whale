# WhaleScope 운영 실행 검증 결과 - 2026-04-15

## 요약

- 실행일: 2026-04-15
- 실행자: Codex
- branch/commit: `main` / 검증 시작 HEAD `eebc75f`
- 기준 문서: `docs/operational-run-verification.md`
- 판정: 조건부 통과
- 조건부 사유: 운영 파이프라인은 수집, 선저장, signal 저장, LLM 브리핑 저장, Telegram polling 기동까지 확인했지만, CoinGecko 429로 최신 run status가 `completed_with_errors`로 기록됐다.

## 검증 중 반영한 수정

운영 검증 중 문서 절차를 그대로 실행했을 때 발견된 결함을 수정했다.

| 파일 | 수정 내용 |
|---|---|
| `scripts/smoke_llm.py` | `python scripts/smoke_llm.py` 실행 시 `src.llm` import가 깨지던 문제 수정 |
| `scripts/smoke_llm.py` | `.env`를 로드하지 않아 모든 LLM provider가 skip되던 문제 수정 |
| `scripts/smoke_llm.py` | Gemini smoke 모델을 `gemini-2.5-flash`로 정렬 |
| `config/llm_routing.yaml` | `daily_brief`, `weekly_trend`, `nl_intent`에 Groq fallback 추가 |
| `tests/test_llm_router.py` | production routing에서 Gemini 뒤 Groq fallback을 유지하는 테스트 추가 |
| `README.md` | 테스트 통과 수 최신화 |
| `docs/operational-run-verification.md` | 고정 commit 표기를 `main` HEAD 기준으로 정리 |

## 실행 명령과 결과

### 코드 상태와 테스트

```bash
git status --short --branch
pytest -q
```

결과:

- `main...origin/main`
- `pytest -q`: `265 passed, 6 warnings`

### 로컬 smoke

```bash
python scripts/smoke_pipeline.py
```

결과:

- fixture events: 23
- signals: 3
- status: `completed`
- output: `SMOKE OK`

### 외부 연결

```bash
python scripts/test_connection.py
```

결과:

| 대상 | 결과 |
|---|---|
| Etherscan | PASS |
| CoinGecko | PASS |
| Gemini | PASS |
| Groq | PASS |
| Google Sheets | PASS |
| Telegram | PASS |

### LLM smoke

```bash
python scripts/smoke_llm.py
```

결과:

| Provider | 결과 |
|---|---|
| Anthropic | skip, key 없음 |
| Gemini `gemini-2.5-flash` | OK |
| Groq `llama-3.3-70b-versatile` | OK |

### `src.main` dry-run

```bash
python -m src.main --dry-run
```

결과:

- fixture events: 23
- signals: 3
- status: `completed`
- 외부 수집/Telegram 발송은 skip
- 현재 구현상 dry-run analysis log는 Google Sheets에 기록됨

## Google Sheets row count

### 운영 실행 전

| 탭 | rows |
|---|---:|
| `watched_addresses` | 80 |
| `transactions` | 0 |
| `address_activity` | 0 |
| `signals` | 0 |
| `daily_brief` | 0 |
| `analysis_log` | 1 |
| `system_log` | 1 |
| `subscribers` | 0 |

### 첫 운영 실행 후

첫 운영 실행 명령:

```bash
python -m src.main
```

결과:

- collected events: 3606
- stored address activity: 3394
- stored transactions: 3606
- stored signals: 1
- daily brief: 실패
- status: `completed_with_errors`

실패 원인:

- Anthropic provider 미설정은 정상 fallback 대상
- Gemini `503 UNAVAILABLE` 발생
- 기존 `daily_brief` routing이 Groq까지 fallback하지 않아 brief 생성 실패

이후 `config/llm_routing.yaml`에 Groq fallback을 추가했다.

### 재실행 후

재실행 명령:

```bash
python -m src.main
```

결과:

- collected events: 3578
- stored address activity: 574
- stored transactions: 576, duplicates skipped: 3002
- stored signals: 1
- daily brief: 1건 저장
- Telegram distribution: `sent=0, failed=0, blocked=0`
- latest status: `completed_with_errors`

최신 row count:

| 탭 | rows |
|---|---:|
| `watched_addresses` | 80 |
| `transactions` | 4182 |
| `address_activity` | 3968 |
| `signals` | 2 |
| `daily_brief` | 1 |
| `analysis_log` | 3 |
| `system_log` | 5 |
| `subscribers` | 1 |

최신 `system_log` 요약:

| 필드 | 값 |
|---|---|
| `run_id` | `run_20260415_073412_b067ab` |
| `status` | `completed_with_errors` |
| `transactions_count` | 576 |
| `errors` | `["enrich_transactions: CoinGecko rate limited (429)"]` |
| `details` | `sent=0, failed=0, blocked=0` |

## Dashboard 검증

실행:

```bash
streamlit run streamlit_app.py --server.headless true --server.port 8501
```

결과:

- `http://127.0.0.1:8501` HTTP 200
- 운영 password가 설정되어 있어 로그인 화면 표시 확인

본문 렌더링 확인은 비밀번호 노출을 피하기 위해 별도 포트에서 `STREAMLIT_PASSWORD`를 빈 값으로 오버라이드했다.

```bash
env STREAMLIT_PASSWORD= streamlit run streamlit_app.py --server.headless true --server.port 8502
```

브라우저 확인 결과:

- `WhaleScope Dashboard` 렌더링
- `오늘의 브리핑`, `거래 히스토리`, `시그널`, `통계` 탭 렌더링
- `Daily Brief - 2026-04-15` 표시
- total volume: `$6,555,360`
- alert count: `1`
- signal dashboard: `2 signals`
- 오늘 거래 목록 표시

콘솔:

- 앱 중단 error 없음
- Streamlit/차트 warning 존재
- form label 관련 accessibility issue 존재

## Telegram 검증

실행:

```bash
python scripts/run_bot.py
```

결과:

- Google Sheets 초기화 통과
- Telegram polling 시작 로그 확인
- pending update 처리 중 subscriber 1명 추가 로그 확인
- 부작용 방지를 위해 검증 후 bot 프로세스 종료

최종 `subscribers` row count:

- 1

주의:

- 이 검증은 실제 Telegram 앱에서 수동 메시지를 새로 보낸 검증은 아니다.
- pending update가 처리되어 `/start` 또는 구독 등록 흐름이 실제로 동작한 것은 확인됐다.
- 일반 텍스트 fallback과 `/help` 응답은 테스트 코드로 검증되어 있다.

## 통과 항목

- 전체 테스트 통과
- smoke pipeline 통과
- 외부 연결 통과
- LLM provider smoke 통과
- dry-run 통과
- 운영 수집 통과
- LLM 실패 전 `transactions`, `address_activity` 선저장 통과
- signal 저장 통과
- routing 수정 후 daily brief 저장 통과
- Streamlit dashboard 렌더링 통과
- Telegram bot polling 기동 통과

## 조건부 통과 항목

- 최신 run status는 `completed_with_errors`
- 원인은 `CoinGecko rate limited (429)`
- 이 오류는 가격 보강 실패이며, 원천 수집/시그널/브리핑 저장 경로를 중단시키지는 않았다.

## 후속 개선 권장

1. CoinGecko enrich 단계를 optional job으로 분리하거나 shared cache를 적용한다.
2. `system_log`에 stage별 elapsed/count를 구조화해서 저장한다.
3. Stage 3 collector에 chain/address별 진행률 로그를 추가한다.
4. 대시보드 token multiselect가 수백 개 토큰을 모두 default selected로 보여주는 UX를 개선한다.
5. Streamlit chart warning과 form label accessibility issue를 별도 UI QA 항목으로 처리한다.
6. Telegram `/help`와 일반 텍스트 응답은 실제 사용자 계정으로 한 번 더 수동 확인한다.
