---
type: cowork-session
date: 2026-04-18
sequence: 14
time: "21:05"
status: completed
environment: cowork
tags:
  - cowork-session
  - whalescope
  - consistency-review
  - render
  - github-actions
---

# 2026-04-18-14 WhaleScope v4 정합성 브리핑 — Render/GHA 중복 분석

## 1. 요약

v4 QA 보고서(`2026-04-18-13`)의 주장 대부분이 실제 코드와 일치한다. 단, **Render `whalescope-pipeline` Cron(`python -m src.main`, `0 */6 * * *`)과 GHA 신규 7개 워크플로가 동시에 살아 있는 구조적 중복**이 남아 있다. 이는 LLM 이중 청구, Google Sheets 쓰기 경합, 예산 가드 우회를 일으킬 수 있어 다음 배포 전 반드시 정리해야 한다.

## 2. Claim-to-Code 매트릭스 (v4 QA §2, §3 vs 실제 코드)

| QA 보고 주장 | 검증 파일:라인 | 결과 |
|---|---|---|
| `NewsWidget`이 sidebar footer slot에서 우측 sticky rail로 이동 | `apps/dashboard/app/page.tsx:598-600` (`aside.newsRail`), `insights/insights.module.css:1084-1104` (`@media (min-width:1024px)` sticky grid) | ✅ |
| 1024px 미만에서 뉴스 rail 하단 이동 / nav 상단 접힘 | `insights/insights.module.css:1108-1154` (`@media (max-width:1023px)` 수평 nav) | ✅ |
| `NewsWidgetData.lastUpdatedAt` + KST `YYYY.MM.DD HH:mm:ss` | `lib/news.ts:25, 249, 260, 268`, `components/news-widget.tsx:10-38, 97-102` | ✅ |
| `/api/news`와 `lib/news.ts` `news_feed` 우선 → `daily_brief/signals` fallback | `lib/news.ts:249` vs `lib/news.ts:260, 268` 이원 분기 | ✅ |
| 4개 소스 칩 `Binance/Upbit/FX/Snapshot` | `components/market-ticker-strip.tsx:683-707` | ⚠️ (Kraken→Snapshot 치환, §4 참조) |
| 칩 상태 `connecting/live/stale/down` | `components/market-ticker-source-chips.tsx:5, 17-28` | ✅ |
| 15s live threshold / 45s down threshold | `components/market-ticker-strip.tsx:57-58` (`LIVE_WINDOW_MS=15_000`, `DOWN_WINDOW_MS=45_000`) | ✅ |
| 카드 레이아웃 `repeat(auto-fit, minmax(280px, 1fr))` | `components/market-ticker-strip.module.css:85` | ✅ |
| Modal backdrop/ESC/focus restore | `components/market-detail-chart-modal.tsx:29-57` (overflow:hidden, keydown Escape, previouslyFocused.focus) | ✅ |
| `MonthlyBudgetGuard` $15 hard cap | `src/router/budget.py:37` (`cap_usd: float = 15.0`) | ✅ |
| billable_pipelines = `brief`, `stories`만 | `src/router/budget.py:38` | ✅ |
| `signals`는 예산 가드 우회 | `src/router/budget.py:54-65` (`not_limited` decision) | ✅ |
| `brief.py` precheck/record_usage 통합 | `src/pipeline/brief.py:54-57, 97-104` | ✅ |
| `stories.py` per-signal narration + 예산 체크 | `src/pipeline/stories.py:121-140` | ✅ |
| `curated_balance_refresh.py`가 `approx_balance` 캐시 | `src/ingestion/curated_balance_refresh.py:24-38` (approx_balance를 그대로 복사) | ⚠️ (계획 §5-2 RPC 호출과 gap, §4 참조) |
| 신규 7개 워크플로 추가 | `.github/workflows/{signals,brief,stories,news_rss,curated_balance,broadcast_daily,channel_health}.yml` | ✅ |
| 워크플로 cron 주기 | signals `*/15`, brief `0 */8`, stories `0 */6`, news_rss `*/30`, curated_balance `*/15`, broadcast_daily `0 0`, channel_health `15 0` | ✅ |
| `daily_brief.yml`이 `workflow_dispatch` 전용 legacy wrapper | `.github/workflows/daily_brief.yml:4-6` (on: workflow_dispatch만) | ✅ (존재 자체가 문제, §3 참조) |
| `broadcast_daily.py` KST 09:00 윈도우 | `src/pipeline/broadcast_daily.py:24-26` (`_is_broadcast_window`) + `--force`/`workflow_dispatch` 우회 | ✅ |
| `channel_health.py` getChat/getChatMemberCount | `src/pipeline/channel_health.py:49-52` | ✅ |
| 3개 Sheets 신규 탭 | `src/storage/schema.py:106-108, 181-215, 232-254` (상수, 헤더, ALL_TABS/TAB_HEADERS 모두 등록) | ✅ |
| `scripts/init_sheets.py` 미수정으로도 새 탭 자동 반영 | 스키마 상수를 읽어 생성하므로 자동 반영 정상 | ✅ (코드 컨벤션상 맞음) |

결론: **UI/백엔드/스키마 차원의 주장 22개 중 22개가 코드와 일치**한다. Kraken 치환과 curated_balance 캐시-only는 QA 보고서 §2-2 / §5-1에서 이미 자인하고 있으므로 허위 주장이 아니다.

## 3. Critical 이슈 — Render Cron vs GHA 워크플로 중복

### 3-1. 현재 구조

| 레이어 | 실행 경로 | 주기 | 수행 범위 |
|---|---|---|---|
| Render `whalescope-pipeline` | `python -m src.main` | `0 */6 * * *` (UTC) | Stage 1~10: 수집→시그널 감지→시그널 저장→일일 브리프 생성→Sheets 저장→Telegram 발송까지 monolithic |
| GHA `signals.yml` | `python -m src.pipeline.signals` | `*/15 * * * *` | 수집 + 시그널 저장만 |
| GHA `brief.yml` | `python -m src.pipeline.brief` | `0 */8 * * *` | 최근 24h signals → LLM 브리프 |
| GHA `stories.yml` | `python -m src.pipeline.stories` | `0 */6 * * *` | per-signal narration |
| GHA `news_rss.yml` | `python -m src.ingestion.news_rss` | `*/30 * * * *` | RSS 수집 |
| GHA `curated_balance.yml` | `python -m src.ingestion.curated_balance_refresh` | `*/15 * * * *` | 캐시 upsert |
| GHA `broadcast_daily.yml` | `python -m src.pipeline.broadcast_daily` | `0 0 * * *` (UTC=KST 09:00) | 최신 브리프 Telegram 배포 |
| GHA `channel_health.yml` | `python -m src.pipeline.channel_health` | `15 0 * * *` | getChat/getChatMemberCount |
| GHA `daily_brief.yml` (legacy) | `python -m src.main` | workflow_dispatch 전용 | 수동 실행 시 전체 monolithic 파이프라인 |

### 3-2. 충돌 포인트

1. **이중 수집 + 시그널 이중 감지**: Render `src.main`은 6시간마다 signals/transactions/news까지 몽땅 다시 돈다. GHA `signals.yml`은 이미 15분마다 수집 + 시그널 저장을 수행. 같은 tx가 두 경로에서 저장되며 tx_hash UPSERT는 통과하더라도 signal_id 중복 또는 이벤트 시각 차이로 시그널이 중복 생성될 수 있다.
2. **LLM 이중 청구 + 예산 가드 바이패스**: `src.main`의 Stage 8(daily brief 생성)은 `MonthlyBudgetGuard`를 경유하지 않는 자체 LLM 경로로 구성돼 있다. 반면 `src/pipeline/brief.py`는 precheck/record_usage를 통과한다. 즉 **Render가 돌면 `llm_budget_log`에 기록되지 않는 비용이 누적**되고 $15 cap이 무의미해진다.
3. **Sheets 쓰기 경합**: `daily_brief` 시트는 날짜 기준 upsert인데, Render cron이 UTC 00/06/12/18에 돌고 GHA `brief.yml`이 `0 */8`(00/08/16)에 돌면 같은 윈도우에 두 job이 동시에 save_daily_brief()를 호출해 더 늦은 쪽이 덮어쓴다.
4. **Telegram 배포 중복 위험**: `src.main`의 Stage 10은 Telegram 발송까지 포함한다. 동시에 GHA `broadcast_daily.yml`도 존재한다. `TELEGRAM_BROADCAST_DRY_RUN=true`로 기본값이 잡혀 있어 즉시 스팸은 아니지만, live 전환 시 **하루 두 번 발송** 리스크가 잠재.

### 3-3. 해결 옵션 비교

| 옵션 | 내용 | 장점 | 단점 | 권장도 |
|---|---|---|---|---|
| A. Render cron 비활성화, GHA 단일 소스 | Render에서 `whalescope-pipeline` 서비스를 suspend, GHA 7개 워크플로가 production | 예산 가드가 모든 LLM 호출을 커버, Sheets 쓰기 단일화 | GHA runner 의존도 증가, Rate limit/minutes 한도 주시 필요 | ★★★ (권장) |
| B. Render를 signals-only로 축소 | `src.main`을 `run_signals_pipeline()` 한 번만 부르도록 수정 | Render의 상시성(6h) + GHA의 분절성 양립 | 코드 분기 필요, `src.main`의 기존 호출자 정리 | ★★ |
| C. Render를 단일소스로 올리고 GHA 전부 workflow_dispatch | `src.main`에 예산 가드/모듈화 주입 후 signals/brief/stories를 모두 Render cron으로 전환 | 외부 의존성 최소 | v4에서 분리한 이점 상실, Render cron만 장애 시 전체 중단 | ★ |

**권고**: **옵션 A**. v4 구현 노력을 살리려면 GHA 7종 조합이 production path여야 하며, Render pipeline cron은 **suspend** 또는 `blueprint.yaml`에서 제외한다. Render Worker 두 개(bot/listener)는 **유지**가 맞다 — 이 둘은 상시성이 필요한 서비스이고 GHA로 대체 불가능하다.

## 4. 계획 ↔ 구현 gap (Before/After/Why)

| 항목 | 계획 (v4 §) | 구현 (QA §) | Why / Action |
|---|---|---|---|
| Source chip 구성 | v4 §2-2: `Binance / Upbit / FX / Kraken` | QA §2-2: `Binance / Upbit / FX / Snapshot` | Kraken 실시간 피드 미확보. Snapshot chip이 REST 폴백 상태를 드러내므로 UX 목적(소스 투명성)은 충족됐다. v4 계획 문서에 "Kraken 대신 Snapshot" 1줄 보강 필요 |
| curated_balance 실데이터 | v4 §5-2: 체인별 RPC/API로 실시간 잔고 조회 | QA §5-1: `approx_balance`를 그대로 캐시 upsert | 실잔고 조회는 RPC 키 + rate limit 대응 포함한 별도 스파이크 필요. 현재 캐시는 **신선도가 `curated_wallets.updated_at`을 넘지 않는다**는 한계를 /admin UI에서 명시해야 오해 없음 |
| channel_health → /admin UI | v4 §4 (운영 대시보드 필요) | QA §5-3: 저장까지만, UI 미연동 | `/admin`에 `channel_health` 최신 row + `llm_budget_log` 월별 누적을 보여주는 카드 2개 추가가 다음 스프린트의 1순위 |
| daily_brief.yml 제거 | v4 §3: legacy wrapper만 남기기로 결정 | QA §5-4: 파일 잔존, workflow_dispatch만 | 실 트리거 경로가 사라졌지만 **수동 실행 시 예산 가드 없는 src.main이 도는 함정**이 있음. 단기 조치로 삭제 또는 명시적 sys.exit으로 봉인 권장 |
| 실브라우저 모바일 QA | v4 §7: 375/640/1024/1280/1440 시각 검증 | QA §4-2: HTTP smoke만 | design-checker 또는 Playwright snapshot 1회 돌려 Vercel preview URL 기준으로 5개 viewport 비교 필요 |
| Next.js 다중 lockfile warning | v4 §8 | QA §3-2: 빌드 warning 잔존 | `outputFileTracingRoot: __dirname` 설정 또는 monorepo root의 불필요 lockfile 정리 |

## 5. Render 3-서비스 + Vercel 정합성

| 서비스 | 배포 대상 | v4 정합성 상태 |
|---|---|---|
| Vercel `apps/dashboard` | `/`, `/admin`, `/insights`(→`/` 308) | ✅ page.tsx 24929B (v4 내용 반영), admin route 존재, insights는 redirect |
| Render `whalescope-pipeline` (Cron) | `python -m src.main` | ⚠️ GHA와 중복, §3 조치 필요 |
| Render `whalescope-bot` (Worker) | `python scripts/run_bot.py` | ✅ v4 범위 밖, `broadcast_daily.py`의 `WhaleScopeBot.send_daily_brief`는 **subscriber DM 경로만** 담당하고 채널 발송은 `TelegramBroadcastAdapter`가 담당 — 역할 중첩 없음 |
| Render `whalescope-listener` (Worker) | `TG_CHANNEL=@whale_alert_io python scripts/run_listener.py` | ✅ tg_whale_events 지속 수집, signals.py가 이를 소비. v4 신규 워크플로와는 **생산자-소비자 관계**이므로 충돌 없음 |

## 6. 다음 액션 (우선순위)

1. **[P0] Render `whalescope-pipeline` Cron suspend** — Render 대시보드에서 서비스 상태를 `suspended`로 변경하거나 `blueprint.yaml`에서 cron 섹션 제거. 동시에 `daily_brief.yml`의 `workflow_dispatch` 경로가 `src.main`을 그대로 돌리지 않도록 `exit 0` wrapper로 봉인.
2. **[P0] GHA `signals.yml` + `brief.yml` 조합의 한 주기 관찰** — Render pipeline suspend 후 KST 24시간 동안 `system_log`, `signals`, `daily_brief`, `llm_budget_log` 네 시트의 write 패턴을 확인해 중복이 사라지는지 검증.
3. **[P1] `/admin` 운영 UI에 `channel_health` + `llm_budget_log` 카드 추가** — v4 QA §6-2의 "다음 액션 제안"과 일치. 데이터는 이미 시트에 쌓이므로 UI만 붙이면 된다.
4. **[P1] Kraken → Snapshot 치환을 v4 계획 문서에 반영** — `2026-04-18-12` 문서 §2-2를 1줄 수정하여 UI/문서 정합성 회복.
5. **[P2] curated_balance 실 RPC 스파이크** — ETH(Alchemy/Infura free tier), SOL(Solscan API), 그 외 체인별 rate limit 매핑 + retries + fallback 경로 설계.
6. **[P2] 실브라우저 모바일 QA** — Vercel preview URL을 design-checker로 375/640/1024/1280/1440 5뷰포트 스크린샷.
7. **[P3] Next.js multi-lockfile warning 정리** — `next.config.js`에 `outputFileTracingRoot` 명시.

## 7. 결론

v4 코드 구현 자체는 QA 보고서 주장과 완전히 일치한다. 치명 결함은 없다. 다만 **Render cron 경로가 v4 이전 시절의 monolithic `src.main`을 여전히 6시간마다 돌리는 구조**가 살아 있어, GHA 분할 설계의 이점(예산 가드·신선도 분리·장애 격리)이 모두 무효화된다. Render pipeline cron을 suspend하는 단순 결정 하나가 **P0 필수 조치**이고, 이걸 먼저 끝내야 다른 잔여 리스크들(channel_health UI, curated_balance 실데이터, 모바일 QA)이 의미를 갖는다.

## 관련 파일

- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/src/router/budget.py`
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/src/pipeline/{signals,brief,stories,broadcast_daily,channel_health,common}.py`
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/src/ingestion/curated_balance_refresh.py`
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/src/storage/schema.py`
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/src/main.py`
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/.github/workflows/{signals,brief,stories,news_rss,curated_balance,broadcast_daily,channel_health,daily_brief}.yml`
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/apps/dashboard/app/page.tsx`
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/apps/dashboard/app/insights/insights.module.css`
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/apps/dashboard/components/{insights-sidebar,market-ticker-source-chips,market-ticker-strip,market-detail-chart-modal,news-widget}.tsx`
- `/sessions/sharp-eloquent-euler/mnt/02015_reuton_whale/apps/dashboard/lib/news.ts`
- `2026-04-18-13-WhaleScope-유저홈-v4-구현-QA-코드리뷰-종합보고서.md` (검증 대상)
- `2026-04-18-WhaleScope-Render-워커-웹서버-배포가이드.md` (구조 출처)

## 복원 컨텍스트

> 다음 세션 복원 시 이 노트만 읽으면 된다.

- v4 구현 주장 22건이 모두 코드와 일치함을 확인했다.
- **P0 이슈**: Render `whalescope-pipeline` Cron(`python -m src.main`, 6h)이 GHA 7개 워크플로와 중복 실행 중. LLM 예산 가드 우회, Sheets 경합, Telegram 중복 발송 리스크.
- **권장**: 옵션 A = Render pipeline cron suspend, GHA 단일 소스 체제 확립.
- Kraken→Snapshot 치환은 합리적이나 계획 문서 §2-2만 1줄 갱신 필요.
- 다음 스프린트 우선순위: (1) Render cron suspend → (2) 24h 관찰 → (3) /admin UI에 channel_health/llm_budget_log 카드 → (4) curated_balance 실 RPC → (5) 모바일 실브라우저 QA.
