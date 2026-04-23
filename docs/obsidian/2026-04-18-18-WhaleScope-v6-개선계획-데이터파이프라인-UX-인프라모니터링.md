---
type: improvement-plan
project: WhaleScope
date: 2026-04-18
sequence: 18
status: planning
tags:
  - whalescope
  - v6
  - render
  - cron
  - i18n
  - theme
  - admin
  - monitoring
related:
  - "[[2026-04-18-15-WhaleScope-v5-개선계획-Render-단일소스-UI-UX]]"
  - "[[2026-04-18-16-WhaleScope-v5-구현-QA-코드리뷰-종합보고서]]"
  - "[[2026-04-18-17-WhaleScope-v5-정합성-QA-다관점리뷰-종합보고서]]"
---

# WhaleScope v6 개선계획 — 데이터 파이프라인 정상화 · 다국어 · 화이트모드 · 인프라 모니터링

## §0. 문서 목적

이 문서는 v5 릴리스(2026-04-18) 이후 운영 관찰에서 드러난 **크리티컬 이슈 1건**과 사용자가 요청한 **UX/기능 개선 9건**을 하나의 v6 로드맵으로 묶는다. v5 정합성 보고서(문서 17)의 R-3 리스크가 실제로 발화해 대시보드가 "유령 상태"(크론은 돌고 있으나 데이터가 정지)에 있는 것이 가장 크리티컬하므로, 이를 P0로 고정하고 나머지 과제는 P1/P2로 분리한다.

## §1. TL;DR — 현재 상황과 결정

| 항목 | 현 상태 | 결정 |
|---|---|---|
| **Render cron 발화** | `*/15 * * * *` 정상 | 유지 |
| **`due_job_names` 게이트** | `minute % 15 != 0` → `[]` 리턴 | **P0 — 즉시 수정** |
| **대시보드 4개 섹션(뉴스/브리핑/시그널/감시지갑) 정체** | 크론은 돌지만 잡이 0개 실행 → Sheets 탭 증가 없음 | 위 P0 수정으로 해소 예상 |
| **Render `listener` / `bot` 서비스** | 별개 웹/워커 프로세스로 가동 | 상태 관찰 경로 신설 필요 (P1) |
| **어드민 페이지** | 파이프라인 중심, listener/bot/Vercel 분리 표기 미비 | 인프라 4종(pipeline + listener + bot + dashboard) 카드화로 확장 (P1) |
| **기본 테마** | `prefers-color-scheme: dark` 일 때 다크 시작 | 라이트 강제로 변경 (P1) |
| **언어 콤보박스** | ko/en/ja 3종, 콤보박스는 존재하지만 실제 i18n 번역 없음 | ko/en 2종으로 축소 + 실 번역 적용 (P1) |
| **텔레그램 모달 CTA** | DOM 상으로는 링크가 연결되어 있으나 `channelUrl` 이 null이면 비활성화 | env 배포 확인 + 버튼 상태 재검증 (P1) |
| **고래 스토리 카드 시간 표기** | `story.meta` 안에 혼재 | 카드 전용 "데이터 생성 시각" 메타 분리 (P2) |

## §2. P0 — 파이프라인 "유령 상태" 근본 원인과 수정

### 2.1 재현 경로

1. Render cron은 `*/15 * * * *`로 스케줄되어 있다 (`render.yaml:5`).
2. Render 플랫폼은 cron 발화를 **UTC 기준 정각**에 예약하지만, 실제 프로세스 시작은 수십 초∼수 분 지연된다 (Render docs "Jobs may be delayed up to a few minutes").
3. `src/pipeline/run_all.py:33-55` 의 `due_job_names()` 는 `datetime.now(timezone.utc)` 의 분(minute)을 그대로 읽어 `minute % 15 != 0` 이면 즉시 `[]` 리턴한다.
4. 결과: Render가 `13:15:00` 에 예약을 건 뒤 `13:15:37` 에 실제로 프로세스를 띄우면, `minute == 15` 이면 통과하지만 `13:16:05` 에 띄우면 `minute == 16` → `minute % 15 == 1` → **모든 잡이 스킵**.
5. 이 스킵은 로그에도 `"No scheduled jobs due at ..."` 로만 남기 때문에, 외관상 크론은 성공이고 system_log 에는 아무 것도 기록되지 않는다.

```python
# 현재 (src/pipeline/run_all.py:39-40)
if minute % 15 != 0:
    return []
```

### 2.2 영향

- `signals`, `curated_balance`: 매 15분 대상이 스킵되면 signals/curated 탭에 rows 추가 없음 → 대시보드의 "감지된 주요 시그널", "큐레이션 감시 지갑" 정지.
- `news_rss`: 30분 대상 역시 스킵 → `news_feed` 탭에 rows 없음 → `/api/news` 가 `source=fallback` 으로 응답 → "지금 읽을 맥락 / 뉴스 큐레이션" 고정 문구만 표시.
- `brief` / `stories` / `broadcast_daily`: 정각 의존 잡 전부 스킵 → "오늘의 고래 브리핑", "시장 분위기", "고래 스토리" 정체.
- **결론: v5 정합성 보고서 §7 R-3 이 실제로 발화한 상태.**

### 2.3 수정안 (P0)

#### 2.3.1 패치 — minute을 15분 슬롯으로 스냅

```python
# src/pipeline/run_all.py
_SLOT_WIDTH = 15

def due_job_names(now: datetime | None = None) -> list[str]:
    current = _normalize_now(now).astimezone(_KST)
    hour = current.hour
    weekday = current.weekday()
    # Snap the observed minute down to the nearest 15-minute slot so that
    # Render cron firing jitter (:01, :16, :31, :46) still resolves to the
    # canonical slot (:00, :15, :30, :45).
    slot = (current.minute // _SLOT_WIDTH) * _SLOT_WIDTH

    due = ["signals", "curated_balance"]
    if slot in {0, 30}:
        due.append("news_rss")
    if slot == 0 and hour in {0, 6, 12, 18}:
        due.append("stories")
    if slot == 0 and hour in {0, 8, 16}:
        due.append("brief")
    if slot == 0 and hour == 9:
        due.append("broadcast_daily")
    if slot == 15 and hour == 9:
        due.append("channel_health")
    if slot == 0 and hour == 8 and weekday == 1:
        due.append("weekly_trend")
    return due
```

#### 2.3.2 멱등성 가드 (중복 실행 방지)

15분 슬롯 스냅으로 느슨해진 만큼, 하루 1회 잡 (`broadcast_daily`, `channel_health`, `weekly_trend`)은 동일 슬롯 내 2회 발화 시 재실행되면 사용자에게 중복 브로드캐스트가 발생할 수 있다. 간단한 state 파일로 직전 실행 슬롯을 기록한다.

```python
# src/pipeline/common.py 에 슬롯 상태 헬퍼 추가
from pathlib import Path
_STATE_PATH = Path(os.environ.get("WHALESCOPE_RUN_STATE", "/tmp/whalescope_run_state.json"))

def load_last_slot() -> dict[str, str]: ...
def record_slot(job_name: str, slot_key: str) -> None: ...
```

하루 1회 잡 실행 전에 `slot_key = f"{date.isoformat()}-{hour:02d}-{slot:02d}"` 로 비교하고, 이미 실행되었으면 `skipped_idempotent` 로 기록.

주의: Render cron은 매 발화마다 컨테이너가 재기동되어 `/tmp` 는 휘발성이다. 따라서 **state는 반드시 Google Sheets 의 system_log 탭을 조회하는 방식**으로 확인해야 영속성이 있다. 다음 3안 중 택1:

| 안 | 내구성 | 복잡도 | 권장 |
|---|---|---|---|
| A. `/tmp` 파일 | 같은 컨테이너 내 재실행에만 유효 | 낮음 | 비권장 |
| B. Sheets system_log 조회 | 영속 | 중간 | **권장** (이미 크론마다 1∼2 row write) |
| C. Redis/외부 KV 추가 | 영속 + 빠름 | 높음 | 필요성 낮음 |

B안으로 구현: 잡 실행 전 `system_log` 최근 24시간 rows 를 읽어 `run_type` + `date_kst` + `slot` 매칭되는 성공 로그가 있으면 스킵.

#### 2.3.3 단위 테스트 보강

```python
# tests/test_run_all.py 에 추가
def test_due_jobs_tolerates_render_jitter():
    # :01 발화 시에도 00-slot 잡이 나와야 한다
    jitter = datetime(2026, 4, 18, 0, 1, 37, tzinfo=timezone.utc)
    assert "signals" in due_job_names(jitter)
    assert "curated_balance" in due_job_names(jitter)
    assert "brief" in due_job_names(jitter)

def test_due_jobs_slot_15_for_16_minute():
    # :16 은 15-slot 으로 스냅되어야 한다
    at = datetime(2026, 4, 18, 9, 16, 2, tzinfo=timezone.utc)
    assert "channel_health" in due_job_names(at)

def test_idempotent_daily_broadcast_guard():
    # 이미 실행된 슬롯이면 broadcast_daily 가 executed 에 들어가면 안 된다
    ...
```

### 2.4 롤아웃 순서

1. 패치 + 테스트 커밋 (`T-18-A`)
2. Render 수동 트리거 1회 → system_log 에 row 증가 확인
3. 15분 대기 후 자동 발화로 signals/curated_balance row 증가 확인
4. 30분 뒤 news_rss 도 증가했는지 확인
5. 정각 `brief`/`stories` 슬롯(:00 + 하루 3회)에 잡이 실행되는지 관찰
6. **24시간 관찰**: 하루 1회 잡(broadcast_daily, channel_health)이 1회씩만 실행되고 이중 송출이 없는지 확인

### 2.5 ETA 및 담당

- 패치: 반나절
- 멱등성 가드: 1일
- 24시간 관찰/검증: 1일
- **총 P0 완료 예상: 2.5일**

---

## §3. P1 — UX 개선 (요청 1∼5, 7, 8)

### 3.1 [요청 1/2/3/4] 데이터 섹션 정지

**근본 원인은 §2 에서 해결되므로, §3 에서는 "§2 가 끝난 뒤에도 잔여 이슈가 있는지" 를 검증하는 보완만 정의한다.**

#### 3.1.1 프론트엔드 관찰성 보강

현재 `apps/dashboard/app/page.tsx:292-315` 의 `loadInsightState` 는 실패 시 `sourceConnected: false` 만 반환한다. 원인(Sheets auth 실패, Quota 초과, 탭 이름 변경 등)이 구분되지 않는다. 4단 상태 모델로 확장:

```ts
type InsightSourceState = {
  connected: boolean;
  lastUpdatedAt: string | null;
  staleMinutes: number | null;      // 최신 row 로부터 경과 분
  failureKind: null | "auth" | "quota" | "schema" | "network" | "empty";
};
```

사이드바 상단의 "데이터 연결됨" 칩을 `failureKind` 에 따라 다른 메시지로 분기 (ex: "Sheets 쿼터 초과 — 15분 뒤 자동 재시도").

#### 3.1.2 뉴스 위젯 stale 감지

`apps/dashboard/lib/news.ts:238-272` 의 `loadNewsWidgetData` 는 최신 row 의 `fetched_at` 만 표기한다. **30분 이상 stale 이면 경고 배지**를 붙인다:

```ts
if (staleMinutes > 30) {
  return { ...result, stalenessWarning: `${staleMinutes}분 전 데이터` };
}
```

#### 3.1.3 백엔드 system_log 가시화

현재 system_log 는 admin 에만 노출된다. 유저 홈 리스크 고지 영역에 최근 파이프라인 상태 요약 한 줄 추가:

> _"최근 파이프라인 실행: 2026-04-18 14:15 KST · 성공 · 156건 처리"_

### 3.2 [요청 5] 고래 스토리 카드에 생성 시간 표기

#### 현 상태

`apps/dashboard/lib/whale-stories.ts:284-295` 의 `metaParts` 는 `chain · formatDateTime(occurredAt) · 큐레이션 연관` 을 하나의 문자열로 합쳐 `story.meta` 로 내보낸다. 페이지에서는 `apps/dashboard/app/page.tsx:513` 의 `<span>{story.meta}</span>` 한 줄로 렌더된다.

`occurredAt` 은 **거래 발생 시각** 이지 **데이터(스토리) 생성 시각** 이 아니다. 사용자 요구는 후자.

#### 변경 제안

`WhaleStory` 타입에 `generatedAt` 필드 추가 (이미 `buildWhaleStories` 내부에 있는 `generatedAt` 을 카드까지 전달):

```ts
// apps/dashboard/lib/types.ts
export type WhaleStory = {
  // ... 기존 필드
  occurredAt?: string;    // 거래 발생 시각 (기존)
  generatedAt: string;    // 스토리 카드 합성 시각 (신규)
};
```

`buildTransactionStory` / `buildSignalStory` / `buildBriefFallbackStory` 모두 `generatedAt` 파라미터를 받아 저장.

카드 렌더 (page.tsx):

```tsx
<div className={styles.storyMeta}>
  <span>{story.meta}</span>
  {story.hash ? <span>{truncateHash(story.hash)}</span> : null}
  <span className={styles.storyGeneratedAt}>
    <time dateTime={story.generatedAt}>
      {formatRelative(story.generatedAt)} 생성
    </time>
  </span>
</div>
```

`formatRelative` 는 `Intl.RelativeTimeFormat` 기반 헬퍼 (lib/format.ts 에 추가).

### 3.3 [요청 6] 언어 콤보박스 일관성 + i18n 축소/실구현

#### 현 상태

- `LanguageSelector` (ko/en/ja 3종) 는 **쿠키 + 서버 API 에 lang 저장만** 하고, 실제 UI 텍스트 번역은 되어 있지 않다. `src/i18n/` 은 백엔드 용이며 Next.js 클라이언트에 연결되어 있지 않다.
- 디자인 일관성: 로고/탭/테마토글은 `--panel` 배경 + `--line` 테두리 + `--radius-full` 인데, 언어 셀렉터만 독자적 `.label` 클래스가 `--elev-1` 그림자를 붙여 떠 보이는 차이가 있다.

#### 변경 제안

1. **언어 축소**: `SUPPORTED` 를 `ko / en` 2종으로 축소. `ja` 제거.
2. **디자인 일관성**: `.label` 의 `box-shadow: var(--elev-1)` 제거. `padding`, `border-radius`, `background` 를 theme-toggle 과 동일 토큰 스택(`--space-2xs var(--space-xs)`, `--radius-full`, `--panel`)으로 통일. 포커스 링만 `--focus-ring-*` 유지.
3. **실 i18n 구현** — Next.js App Router 권장 패턴인 쿠키 기반 서버 읽기 + 딕셔너리 방식:

```
apps/dashboard/lib/i18n/
├── dictionaries/
│   ├── ko.ts   # 현재 UI 에 하드코딩된 모든 한국어 문구를 key → value 로 이관
│   └── en.ts   # 동일 key 의 영어 번역
└── get-dictionary.ts   # cookies() 에서 lang 읽어 해당 딕셔너리 반환
```

서버 컴포넌트 (page.tsx, admin/page.tsx) 는 `const t = await getDictionary()` 로 받아 사용.

4. **번역 대상 정의 — 최소 번역 범위 (MVP)**:
   - TopNavbar: 탭 라벨, 브랜드 서브타이틀
   - InsightsSidebar: 5개 앵커 라벨
   - 유저 홈: 페이지 타이틀/서브, 섹션 헤딩 10개, 카드 타이틀/설명, Telegram CTA, 푸터
   - 어드민: 서비스 카드 4종 타이틀/라벨, 체크리스트 4종, 테이블 헤더
   - 모달: Telegram 연결 안내문, 채널 열기/링크 복사 버튼
   - **번역 제외**: AI 브리핑 본문(LLM 생성), 거래/시그널 데이터 값, 에러 트레이스

5. **키 네이밍 규약**: `section.sidebar.marketTicker`, `action.openChannel`, `state.connected` 처럼 `domain.context.element` 3단 구조.

### 3.4 [요청 7] 텔레그램 모달 버튼 미동작

#### 진단

`apps/dashboard/components/telegram-connect-modal.tsx` 코드상으로는 버튼이 모두 정상 연결되어 있다:
- **채널 열기**: `<a href={channelUrl}>` (line 153-167)
- **링크 복사**: `onClick={() => handleCopy(channelUrl)}` (line 168-175)
- **QR**: `<img src={channelQrUrl}>` (line 182-193)

모든 CTA 는 `hasChannelLink = Boolean(channelUrl)` 이 false 면 `disabled` / `data-disabled` 가 붙어 비활성화된다.

`channelUrl` 은 `getTelegramPublicConfig()` 가 `NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME` (또는 fallback `NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL`) 로부터 유도한다.

**즉, Vercel 프로덕션 env 에 두 변수 중 하나도 세팅되어 있지 않으면 버튼이 모두 비활성화 상태로 렌더된다. 사용자가 "동작하지 않는다" 고 보고하는 현상과 정확히 일치.**

#### 수정 제안

1. **Vercel env 점검 및 주입 (T-18-E)**:
   - `NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME=whalescope_alertz` 를 Production/Preview 에 세팅.
   - `apps/dashboard/.env.example` 의 해당 키에 값 예시 포함.

2. **Dev 환경에서의 "로컬 env 미설정" 힌트 강화**:
   - 현재 `channelUrl` 이 null 이면 모달 내에 "배포 환경에 공개 채널 주소가 설정되면 QR이 표시됩니다." 라는 안내가 나오는데, 운영자가 "버튼은 왜 비활성화되어 있는가" 를 알아채도록 **어드민 페이지에 env 체크 카드**를 신설 (§3.6 참조).

3. **QR 이미지 보강**:
   - `/api/qr?data=…` 라우트가 Canvas/SVG 생성 중 오류가 나면 `<img onError>` 가 발화하도록 클라이언트 핸들러 추가. 이미 SSR 에서 `<img>` 로 렌더되므로 `onError` 는 클라이언트 hydration 후에만 작동한다. 대안: Node 서버 라우트에서 QR 바이트를 생성해 바이너리로 응답 (이미 이렇게 되어 있는지 확인 필요 — `app/api/qr/route.ts` 내부 구현 점검).

4. **접근성 보완**:
   - `<a data-disabled="true" aria-disabled={true}>` 는 스크린리더에 "비활성화된 링크"로 읽히지만, 키보드 탭 이동은 여전히 가능하다. 추가로 `tabIndex={hasChannelLink ? undefined : -1}` 를 붙여 비활성 상태에서 탭 순서에서 배제.

### 3.5 [요청 8] 기본 테마를 라이트 모드로 고정

#### 현 상태

`apps/dashboard/app/layout.tsx:18-31` 의 pre-paint 스크립트는:

```js
const theme = stored === 'dark' || stored === 'light'
  ? stored
  : (prefersDark ? 'dark' : 'light');
```

→ 시스템이 다크 선호면 다크로 시작. 유저의 요구는 "서비스 기본 톤은 라이트, 사용자가 원하면 다크 토글 가능".

#### 변경 제안

1. **pre-paint 스크립트 수정**:
   ```js
   const theme = stored === 'dark' || stored === 'light' ? stored : 'light';
   ```
   `prefersDark` 검사 제거. 시스템 선호 무시, 저장된 값 없으면 라이트 고정.

2. **design-tokens.css 재검토**:
   - `--panel`, `--surface`, `--on-surface`, `--accent` 등 기본 팔레트의 라이트 값이 충분한 대비(WCAG AA 4.5:1)를 만족하는지 `design:accessibility-review` 기준으로 한 번 더 감사.
   - 다크모드 토큰(`[data-theme="dark"]` 스코프)도 유지하되, 기본 CSS 스코프가 라이트임을 DESIGN.md 에 명시.

3. **TopNavbar 초기 렌더**:
   - `ThemeToggle` 이 mounted 전에 `visibility: hidden` placeholder 를 그리므로 FOUC 는 이미 방지됨. 수정 불필요.

4. **스크린샷 QA 필수**:
   - 변경 후 `design-checker` 스킬로 375/640/1024/1440 에서 라이트 테마 육안 점검. 특히 `.moodGauge` svg 색상, glass card `backdrop-filter`, signal-card 의 tone badge 가 라이트에서 여전히 읽히는지 확인.

### 3.6 [요청 9] 어드민 인프라 모니터링 확장

#### 현 상태

어드민 페이지 (`apps/dashboard/app/admin/page.tsx:46-95`) 의 `buildServiceCards` 는 4개 카드를 노출하지만, 각 카드의 상태 판정이 주로 `system_log` 에 의존한다. 실제 Render 서비스(pipeline/listener/bot)와 Vercel 서비스(dashboard) 각각에 대한 독립적 신호가 약하다.

| 서비스 | 현재 상태 신호 | 한계 |
|---|---|---|
| pipeline (Render cron) | `system_log.run_type='daily_brief'` 최신 row | §2 버그 시 row 자체가 없어 "확인 필요" 로만 뜸 |
| listener (Render web/worker) | `system_log.run_type='telethon_listener'` + `tg_whale_events` latest | 프로세스 crash 는 heartbeat 없음 + 이벤트 없음 으로만 추정 가능 |
| bot (Render worker) | 현재 카드는 "Telegram bot 워커" 로 존재하나 판정 로직이 `subscriberCount > 0` 로 단순화됨 | 실제 broadcast 성공/실패 가시성 없음 |
| dashboard (Vercel) | `sourceState === "connected"` (Sheets 읽기 성공 여부) | Vercel 자체 메타(빌드/리전) 미노출 |

#### 변경 제안

##### 3.6.1 신규 탭 `service_health`

Sheets 에 `service_health` 탭을 신설하고, 각 서비스가 30초∼5분 주기로 heartbeat를 쓰도록 한다.

| 컬럼 | 설명 |
|---|---|
| `service` | `pipeline` / `listener` / `bot` / `dashboard` |
| `instance` | Render service id 또는 Vercel deployment id |
| `status` | `ok` / `degraded` / `down` |
| `last_event_at` | heartbeat 시각 (UTC ISO) |
| `version` | git sha 또는 release tag |
| `details` | JSON (예: `{"uptime_s": 1234, "queue_lag_s": 2.3}`) |

Python 측 헬퍼:

```python
# src/observability/heartbeat.py
def write_heartbeat(service: str, status: str, details: dict | None = None): ...
```

- pipeline (`run_all.py`): 매 실행 시작 + 종료 시 2회 heartbeat.
- listener (`telethon_listener.py`): 메시지 수신 루프 안에서 N분마다 heartbeat.
- bot: 브로드캐스트 잡 실행 경로에서 성공/실패 카운터와 함께 heartbeat.
- dashboard: Next.js `/api/health` 라우트를 신설하여 외부 crob (Vercel cron 또는 Render pipeline) 이 주기 호출 후 heartbeat 작성.

##### 3.6.2 어드민 페이지 카드 재설계

`buildServiceCards` 반환을 아래 5종으로 확장:

1. **Pipeline (Render cron)**
   - status: `service_health.pipeline` 최신 row (없으면 `system_log` 폴백)
   - metrics: 최근 실행 시각, 처리된 rows 수, 에러 수
   - action: Render 대시보드 딥링크 (`RENDER_SERVICE_PIPELINE_URL` env)

2. **Listener (Render)**
   - status: `service_health.listener` + `tg_whale_events` stale check (15분 초과 시 attention)
   - metrics: 마지막 메시지 시각, 24h 수집 건수
   - action: Render 로그 딥링크

3. **Bot (Render)**
   - status: `service_health.bot`
   - metrics: 24h 브로드캐스트 성공/실패 건수, 활성 구독자 수
   - action: Telegram 채널 열기 / Render 로그

4. **Dashboard (Vercel)**
   - status: `service_health.dashboard` + 현재 페이지 렌더 성공 (당연히 ok, 자기 자신을 읽는 것이므로)
   - metrics: 현재 빌드 sha, 리전, Sheets 연결 상태
   - action: Vercel 배포 페이지 딥링크 (`VERCEL_DEPLOYMENT_URL` env)

5. **Data source (Google Sheets)**
   - status: Sheets 읽기 RTT, quota 잔여(대략), 24h write 건수
   - metrics: 각 탭별 row 수, 마지막 write 시각

##### 3.6.3 서비스 상태 집계 카드

페이지 상단 Hero 아래에 **"지금 이 순간 운영 정상?"** 한 줄 요약 카드 추가:

> _"5개 서비스 모두 정상. 마지막 확인: 14:23 KST."_

5개 중 하나라도 `degraded`/`down` 이면 해당 서비스 이름을 붉은 배지로 강조.

##### 3.6.4 env 상태 체크 패널

Telegram env(`NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME`), Anthropic API key, Render env 주입 여부를 "✅/⚠️" 기호로 노출하는 **설정 점검 카드** 를 어드민에 추가 — §3.4 수정 제안 2와 연결.

---

## §4. P2 — 백로그 (§2∼§3 이후 정리)

### 4.1 v5 정합성 보고서에서 잔여 중인 항목

문서 17 §9 의 P2/P3 티켓 중 아래 4건은 v6 플랜에 이관:

| 티켓 | 제목 | v6 재우선화 |
|---|---|---|
| T-17-A | `stories.py` per-signal precheck 최적화 | **P1 로 승격** — Sheets 쿼터 보호가 §2 수정 후 더 중요해짐 |
| T-17-B | `record_usage` 실패 시 로컬 fallback | P2 유지 |
| T-17-I | `channel_health` 프론트 노출 | **P1 로 승격** — §3.6.2 Bot 카드에 통합 |
| T-17-K | Weekly Trend placeholder → 실 데이터 | P3 유지 |

### 4.2 신규 P2

- **T-18-G** 쿠키 기반 i18n 의 SSR ↔ CSR 불일치 검증 (첫 렌더는 기본 언어, hydration 후 쿠키 언어로 바뀌는 플릭 방지)
- **T-18-H** Telegram 모달 QR 이미지 `/api/qr` 라우트 E2E 테스트 (Playwright)
- **T-18-I** 어드민 `service_health` 탭이 write 실패할 때의 graceful degradation (read-side 는 오래된 row 도 보여주고 staleness 배지 표시)
- **T-18-J** 라이트 테마에서 `@media (prefers-reduced-motion: reduce)` 가 glass blur 연출과 충돌하지 않는지 확인
- **T-18-K** 언어 축소 이후 `apps/dashboard/app/api/language/route.ts` 의 검증 로직이 `"ja"` 를 거부하도록 업데이트 (이전 쿠키 사용자의 fallback 경로 포함)

---

## §5. 코드 변경 요약표

| 티켓 | 파일 | 변경 내용 | 우선순위 |
|---|---|---|---|
| T-18-A | `src/pipeline/run_all.py` | `minute % 15` 게이트 → 슬롯 스냅 | **P0** |
| T-18-A | `tests/test_run_all.py` | jitter/idempotent 케이스 추가 | **P0** |
| T-18-B | `src/pipeline/common.py` + Sheets 조회 헬퍼 | 하루 1회 잡 멱등성 가드 | **P0** |
| T-18-C | `src/observability/heartbeat.py` (신규) | service_health 탭 write 헬퍼 | P1 |
| T-18-C | `src/pipeline/run_all.py`, `src/ingestion/telethon_listener.py`, broadcast 경로 | heartbeat 삽입 | P1 |
| T-18-D | `apps/dashboard/app/layout.tsx` | 라이트 모드 강제 pre-paint | P1 |
| T-18-E | Vercel env + `.env.example` | `NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME` 주입 | P1 |
| T-18-F | `apps/dashboard/components/language-selector.tsx` + `.module.css` | 언어 축소 + 스타일 통일 | P1 |
| T-18-F | `apps/dashboard/lib/i18n/` (신규) | 딕셔너리 방식 i18n | P1 |
| T-18-F | 유저 홈/어드민/모달 서버 컴포넌트 | `getDictionary()` 연결 | P1 |
| T-18-G | `apps/dashboard/lib/types.ts`, `whale-stories.ts`, `page.tsx`, `page.module.css` | 고래 스토리 카드 `generatedAt` 표기 | P1 |
| T-18-H | `apps/dashboard/app/admin/page.tsx` + `api/admin/health/route.ts`(신규) | 인프라 5종 카드 + service_health 연동 | P1 |
| T-18-I | `apps/dashboard/lib/news.ts` + news-widget-client | staleness 배지 | P2 |
| T-18-J | `apps/dashboard/lib/metrics.ts` | `failureKind` 상태 모델 확장 | P2 |
| T-17-A (승격) | `src/pipeline/stories.py` | precheck 1회 + 로컬 누적 | P1 |
| T-17-I (승격) | 어드민 카드 Bot 영역 | channel_health 노출 | P1 (§3.6.2에 흡수) |

---

## §6. Before / After / Why — 디자인 개선 항목

| Before | After | Why |
|---|---|---|
| `prefers-color-scheme` 따라 초기 테마 분기 | `stored ?? 'light'` 로 고정 | 사용자가 요청한 기본 톤이 라이트. 시스템 선호가 브랜드 톤을 덮으면 일관성이 깨짐 |
| 언어 콤보 ko/en/ja + 실제 번역 없음 | ko/en + 실제 번역 | 사용되지 않는 옵션은 신뢰를 떨어뜨린다. 번역 없는 셀렉터는 AI slop 신호 |
| `.label` 에만 `box-shadow: var(--elev-1)` | theme-toggle 과 동일 elevation 레벨 | TopNavbar 우측 3요소(탭/테마/언어)가 같은 레이어로 보여야 한다 |
| 고래 스토리 `meta = chain · 시간 · 큐레이션` 한 줄 | 별도 라인: `{meta}` + `{생성 X분 전}` | 사용자가 "언제 생성된 카드인가" 를 한눈에 확인하려면 생성 시각을 별도 토큰으로 분리해야 한다 |
| 어드민 서비스 카드 4종이 전부 system_log 기반 | Render(pipeline/listener/bot) + Vercel 별 독립 heartbeat | 한 신호원이 죽으면 상태 자체를 확인 불가. 각 서비스가 자기 상태를 기록해야 한다 |
| 텔레그램 모달 버튼이 env 없을 때 "조용히 비활성" | 어드민에 env 체크 카드 추가 + 사용자 안내 강화 | "동작하지 않는다" 는 피드백이 나오지 않도록 운영자/사용자 모두에게 가시화 필요 |

---

## §7. 아키텍처 다이어그램 — v6 인프라 상태 흐름

```
┌────────────────────────────┐
│  Render · pipeline (cron)  │
│  run_all.py 매 15분        │
│  ├─ signals                │  ──────┐
│  ├─ curated_balance        │        │
│  ├─ news_rss (30분)        │        │  heartbeat write
│  ├─ stories (6시간)        │        ├──────▶  Google Sheets
│  ├─ brief (8시간)          │        │   ├─ service_health (신규)
│  ├─ broadcast_daily (09KST)│        │   ├─ signals
│  ├─ channel_health (0915)  │        │   ├─ news_feed
│  └─ weekly_trend (화 08KST)│        │   ├─ daily_brief
└────────────────────────────┘        │   └─ system_log
                                      │
┌────────────────────────────┐        │
│  Render · listener (web)   │ ───────┤
│  telethon_listener.py      │        │
└────────────────────────────┘        │
                                      │
┌────────────────────────────┐        │
│  Render · bot (worker)     │ ───────┤
│  broadcast / 응답          │        │
└────────────────────────────┘        │
                                      │
┌────────────────────────────┐        │
│  Vercel · dashboard        │        │
│  Next.js App Router        │ ◀──────┘  Sheets read
│  /api/health (self-report) │ ───────▶  service_health.dashboard
└────────────────────────────┘
           │
           │ SSR
           ▼
┌────────────────────────────┐
│  User Home (/)             │
│  +  Admin (/admin)         │
│     └─ 5개 서비스 카드     │
└────────────────────────────┘
```

---

## §8. 리스크 및 롤백 계획

| 리스크 | 완화 | 롤백 |
|---|---|---|
| 슬롯 스냅 변경 후 정각 잡이 중복 실행 | §2.3.2 멱등성 가드 | `run_all.py` 를 이전 커밋으로 되돌리고 `src.main` legacy 경로로 긴급 운영 |
| i18n 번역 누락 키가 화면에 영어 키로 출력 | 번역 누락 시 한국어로 폴백 + CI 에서 키 커버리지 검증 | 언어 콤보 숨기고 한국어 고정 |
| service_health 탭 write 실패가 주기적 로그 오염 | warning 레벨 + 재시도 없이 skip | 서비스 재시작 없이 heartbeat 비활성화 플래그 toggle |
| 라이트 모드 전환 후 일부 위젯 대비 불충분 | `design:accessibility-review` 로 AA 검증 | `data-theme` 기본값 재지정만으로 롤백 가능 |
| Telegram env 주입 후 모달 버튼 여전히 동작 안 함 | Playwright E2E + 어드민 env 체크 카드로 조기 감지 | env 롤백만으로 즉시 원복 |

---

## §9. 검증 체크리스트 (v6 완료 정의)

- [ ] §2 패치 병합 후 Render cron 1시간 관찰 시 `signals` + `curated_balance` 에 최소 4 rows 추가
- [ ] 30분 후 `news_feed` 에 rows 증가 확인
- [ ] 정각 브리핑 슬롯 1회 경과 후 `daily_brief` 에 row 추가
- [ ] 09:00 KST 슬롯 경과 후 broadcast_daily 가 **1회** 만 실행 (멱등성 가드 검증)
- [ ] 유저 홈 4개 섹션 (뉴스/브리핑/시그널/감시지갑) 이 30분 이내 데이터로 갱신됨
- [ ] 고래 스토리 카드에 `… 전 생성` 메타가 렌더됨
- [ ] 언어 셀렉터가 ko/en 2종 + 스타일이 theme-toggle 과 동일 elevation
- [ ] `en` 선택 시 상단 내비, 사이드바, 주요 헤딩, Telegram 모달이 영어로 렌더
- [ ] 라이트 모드가 기본, 시스템 다크 선호에 영향 받지 않음
- [ ] 텔레그램 모달에서 "채널 열기", "링크 복사", QR 이미지 3종이 모두 동작
- [ ] 어드민 페이지에 Pipeline/Listener/Bot/Dashboard/Data source 5종 카드 노출
- [ ] 5종 카드 각각의 상태가 `service_health` 탭 + system_log 기반으로 판정
- [ ] env 체크 패널이 누락 키를 ⚠️ 로 표기
- [ ] WCAG AA 본문 대비 4.5:1, focus-visible 전 컴포넌트 통과
- [ ] 375 / 640 / 1024 / 1440 breakpoint 육안 QA 1회 통과

---

## §10. ETA 요약

| Phase | 작업 | 예상 |
|---|---|---|
| Phase 0 (P0) | §2 파이프라인 버그 수정 + 멱등성 + 24시간 관찰 | 2∼3일 |
| Phase 1a (P1) | 라이트 테마 강제 + 언어 축소 + Telegram env 주입 | 1일 |
| Phase 1b (P1) | i18n 딕셔너리 + 번역 적용 | 2일 |
| Phase 1c (P1) | 어드민 인프라 5종 카드 + service_health 탭 | 3일 |
| Phase 1d (P1) | 고래 스토리 생성시각 표기 + staleness 배지 | 1일 |
| Phase 2 (P2) | 백로그 항목 소화 + Accessibility 감사 + QA | 2일 |
| **총계** | | **11∼13일 / 2 sprint** |

---

## §11. 다음 세션 복원 컨텍스트

> 이 노트만 읽으면 다음 세션의 Claude 는 아래 작업으로 바로 이어갈 수 있다.

**현 상황**: v5 까지 구현·QA·정합성 리뷰가 끝났고, 운영 데이터 정체가 확인되었다. v6 플랜이 §2∼§4 로 정리되어 있다.

**즉시 실행 가능한 P0 코드 변경** (약 15분):
1. `src/pipeline/run_all.py:39-40` 의 `if minute % 15 != 0: return []` 를 §2.3.1 스니펫으로 대체
2. `tests/test_run_all.py` 에 §2.3.3 의 3개 테스트 케이스 추가
3. `pytest tests/test_run_all.py` 녹색 확인
4. 커밋 + push → Render 자동 재배포 → 15분 후 Sheets 모니터링

**P1 착수 순서 권장**: §3.5 라이트 모드 → §3.4 Telegram env → §3.3 i18n → §3.6 어드민 카드 → §3.2 스토리 시간 표기. (가장 저비용·고체감 순)

**검증 환경**: Render pipeline 서비스 이름은 `whalescope-pipeline`, KST 타임존 기준. Google Sheets 탭 이름은 `schema.ts` 의 `TAB_*` 상수 기준. Vercel 도메인과 Render 서비스 URL 은 `.env.example` 참조.

**주의 사항**:
- §2 수정은 **Render 에 실제로 배포되지 않으면** 대시보드가 계속 빈 상태로 보인다. 로컬 pytest 만으로는 문제가 해결되지 않음.
- §3.3 i18n 작업 시 `cleanGeneratedBrief` 등 LLM 출력 경로는 번역 대상이 아니다 (콘텐츠 값이지 UI chrome 이 아님).
- §3.6 의 service_health 탭 추가는 Google Sheets 권한에 write scope 가 이미 있으므로 별도 IAM 변경 불필요.
