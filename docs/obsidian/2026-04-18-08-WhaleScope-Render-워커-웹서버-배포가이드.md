---
date: 2026-04-18
sequence: 8
project: WhaleScope
repo: /Users/basilry/Projects/02015_reuton_whale
type: render-deployment-guide
assignment: Wrtn Technologies Product Engineer 과제 전형
tags:
  - WhaleScope
  - Render
  - deployment
  - worker
  - cron
  - operations
related:
  - "[[2026-04-18-09-WhaleScope-페이지-정보구조-운영-사용자-분리-보고서]]"
---

# WhaleScope Render 배포 가이드

## 0. 결론

현재 WhaleScope의 Python 쪽은 "하나의 웹서버"라기보다 다음 3개 실행 단위로 나누는 것이 맞다.

| Render 서비스 | 타입 | 명령 | 역할 |
|---|---|---|---|
| `whalescope-pipeline` | Cron Job | `python -m src.main` | 주기적으로 온체인/TG 이벤트 수집, 시그널 생성, LLM 브리핑, Sheets 저장, Telegram 발송 |
| `whalescope-bot` | Background Worker | `python scripts/run_bot.py` | Telegram bot 사용자 명령 처리 |
| `whalescope-listener` | Background Worker | `TG_CHANNEL=@whale_alert_io python scripts/run_listener.py` | 공개 whale alert 채널 listen 후 `tg_whale_events`, `system_log` 저장 |

Vercel에는 Next.js dashboard만 올린다.

| Vercel 앱         | 경로            | 역할                              |
| ---------------- | ------------- | ------------------------------- |
| `apps/dashboard` | `/`, `/admin` | Google Sheets 읽기 전용 사용자/운영 대시보드 |
|                  |               |                                 |

## 1. 왜 Render Web Service 하나가 아니라 Cron + Worker인가

Render 공식 문서 기준으로:

- Web Service는 public URL을 받고 HTTP 요청을 처리하는 동적 웹 앱에 적합하다. HTTP 서버는 `0.0.0.0`에 bind해야 하며 기본 port는 `10000`이다.
- Background Worker는 지속 실행되지만 incoming network traffic을 받지 않는 프로세스에 적합하다.
- Cron Job은 스케줄에 따라 실행되는 주기 작업에 적합하고, long-running 또는 continuous process는 Background Worker를 써야 한다.

WhaleScope의 현재 Python 실행 파일들은 다음 성격이다.

| 파일 | 성격 | Web Service 적합성 |
|---|---|---|
| `python -m src.main` | 한 번 실행 후 종료되는 batch pipeline | Cron Job 적합 |
| `python scripts/run_bot.py` | 장시간 유지되는 Telegram polling/event loop | Background Worker 적합 |
| `python scripts/run_listener.py` | 장시간 유지되는 Telethon listener | Background Worker 적합 |

따라서 지금 단계에서는 Render Web Service를 억지로 하나 만들기보다, Cron/Worker를 각각 분리하는 편이 장애 격리와 운영 가시성 측면에서 좋다.

단, 사용자가 Render에 "웹서버"를 반드시 두고 싶다면 별도의 얇은 FastAPI/Flask service를 추가해 `/health`, `/trigger/pipeline` 같은 endpoint를 제공할 수 있다. 현재 repo에는 그런 Python HTTP server가 구현되어 있지 않으므로, 이 문서는 "현재 코드 기준 배포"를 우선한다.

## 2. 사전 준비

### 2.1 Google Sheets

로컬에서 먼저 실행한다.

```bash
python -m scripts.init_sheets
python scripts/import_watched_addresses.py --dry-run
python scripts/import_watched_addresses.py
```

확인할 것:

- Google Sheet가 생성되어 있거나 `GOOGLE_SHEET_ID`가 준비되어 있어야 한다.
- 서비스 계정 이메일에 해당 Sheet 편집 권한을 부여해야 한다.
- Render/Vercel에 넣을 `GOOGLE_CREDENTIALS_JSON`은 JSON 전체를 한 줄 문자열로 넣는다.

### 2.2 Telegram bot

필수:

- `TELEGRAM_BOT_TOKEN`
- 실제 사용자를 연결하려면 bot username도 별도로 기록한다.

현재 WhaleScope 데모 봇: **`whalescope_demo_bot`** → <https://t.me/whalescope_demo_bot>

권장:

```env
TELEGRAM_BOT_USERNAME=whalescope_demo_bot
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=whalescope_demo_bot
```

- `TELEGRAM_BOT_USERNAME`은 Python 워커(pipeline, bot, listener)에서 로깅/링크 생성용으로 쓴다.
- `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`은 Next.js 대시보드가 브라우저 번들로 내려보내는 값이다. 두 값은 **반드시 동일**해야 한다.

### 2.3 Telethon listener session

Render worker는 interactive phone login을 할 수 없으므로 `TELETHON_SESSION_STRING`을 권장한다.

필수:

```env
TELETHON_API_ID=
TELETHON_API_HASH=
TELETHON_SESSION_STRING=
TG_CHANNEL=@whale_alert_io
```

주의:

- `TELETHON_PHONE=+8210...` 방식은 로컬 최초 인증에는 쓸 수 있지만, Render 장기 운영에는 부적합하다.
- Render worker는 배포/재시작 때마다 interactive prompt에 답할 수 없으므로 session string을 사용해야 한다.

## 3. 공통 환경 변수

Render Environment Group을 만들어 세 서비스에 공유하는 것을 권장한다.

### 3.1 공통 필수

```env
GOOGLE_SHEET_ID=
GOOGLE_CREDENTIALS_JSON=
ETHERSCAN_API_KEY=
TELEGRAM_BOT_TOKEN=
```

### 3.2 LLM provider

최소 1개 필요하다.

```env
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
```

현재 구조는 Anthropic이 없어도 Gemini 또는 Groq fallback으로 daily brief를 생성할 수 있게 설계되어 있다.

### 3.3 선택/권장

```env
SOLSCAN_API_KEY=
TELEGRAM_BOT_USERNAME=whalescope_demo_bot
LISTENER_STALENESS_SECONDS=900
```

### 3.4 listener 전용

```env
TELETHON_API_ID=
TELETHON_API_HASH=
TELETHON_SESSION=whalescope
TELETHON_SESSION_STRING=
TG_CHANNEL=@whale_alert_io
```

## 4. Render Dashboard에서 수동 생성하는 방법

### 4.1 `whalescope-pipeline` Cron Job

1. Render Dashboard에서 `New` -> `Cron Job`을 선택한다.
2. GitHub repo `02015_reuton_whale`를 연결한다.
3. Runtime은 Python으로 둔다.
4. Build command:

```bash
pip install -r requirements.txt
```

5. Command:

```bash
python -m src.main
```

6. Schedule:

```text
0 */6 * * *
```

설명:

- 위 예시는 6시간마다 실행이다.
- Render cron schedule은 UTC 기준으로 해석되므로 한국 시간 운영표를 만들 때 UTC 변환이 필요하다.
- 더 자주 돌리고 싶으면 `*/30 * * * *`처럼 30분 단위로 줄일 수 있지만, 외부 API quota와 LLM 비용을 고려해야 한다.

7. Environment Group을 연결한다.
8. 최초 배포 후 `Trigger Run`으로 수동 실행한다.
9. Google Sheets의 `system_log`, `transactions`, `signals`, `daily_brief`에 행이 들어오는지 확인한다.

### 4.2 `whalescope-bot` Background Worker

1. Render Dashboard에서 `New` -> `Background Worker`를 선택한다.
2. 같은 GitHub repo를 연결한다.
3. Build command:

```bash
pip install -r requirements.txt
```

4. Start command:

```bash
python scripts/run_bot.py
```

5. Environment Group을 연결한다.
6. 배포 후 Telegram에서 bot에게 `/start`를 보낸다.
7. Google Sheets의 `subscribers`에 chat id가 등록되는지 확인한다.

### 4.3 `whalescope-listener` Background Worker

1. Render Dashboard에서 `New` -> `Background Worker`를 선택한다.
2. 같은 GitHub repo를 연결한다.
3. Build command:

```bash
pip install -r requirements.txt
```

4. Start command:

```bash
TG_CHANNEL=@whale_alert_io python scripts/run_listener.py
```

5. Environment Group과 listener 전용 env를 연결한다.
6. `TELETHON_SESSION_STRING`이 없으면 인증 실패한다.
7. `system_log`에 `run_type=telethon_listener`, `event=listener_start` 또는 `message_processed`가 기록되는지 확인한다.

## 5. 선택안: Render Web Service를 추가해야 하는 경우

현재는 필수는 아니다. 그래도 다음 요구가 생기면 얇은 HTTP server를 추가할 수 있다.

필요한 경우:

- `/health` endpoint로 Render uptime/health check를 받고 싶다.
- dashboard에서 버튼을 눌러 pipeline을 manual trigger하고 싶다.
- Render Deploy Hook 대신 signed webhook을 직접 검증하고 싶다.

필요한 코드 예시 방향:

```text
src/server.py
- GET /health -> {"ok": true}
- POST /trigger/pipeline -> secret 검증 후 background task 또는 one-off job trigger
```

Render Web Service 설정:

```bash
pip install -r requirements.txt
uvicorn src.server:app --host 0.0.0.0 --port $PORT
```

주의:

- 현재 repo에는 `src/server.py`가 없으므로 바로 배포할 수 없다.
- Web Service 하나에 bot/listener/pipeline을 모두 묶으면 장애 격리가 약해진다.
- Render Web Service는 incoming HTTP traffic을 받는 프로세스에 맞고, bot/listener는 Background Worker가 더 자연스럽다.

## 6. render.yaml Blueprint 초안

Render Blueprint를 쓰면 여러 서비스를 `render.yaml`로 정의할 수 있다. secret은 `sync: false`로 두고 Dashboard에서 입력하는 방식을 권장한다.

```yaml
services:
  - type: cron
    name: whalescope-pipeline
    runtime: python
    buildCommand: pip install -r requirements.txt
    startCommand: python -m src.main
    schedule: "0 */6 * * *"
    envVars:
      - fromGroup: whalescope-env

  - type: worker
    name: whalescope-bot
    runtime: python
    buildCommand: pip install -r requirements.txt
    startCommand: python scripts/run_bot.py
    envVars:
      - fromGroup: whalescope-env

  - type: worker
    name: whalescope-listener
    runtime: python
    buildCommand: pip install -r requirements.txt
    startCommand: TG_CHANNEL=@whale_alert_io python scripts/run_listener.py
    envVars:
      - fromGroup: whalescope-env

envVarGroups:
  - name: whalescope-env
    envVars:
      - key: GOOGLE_SHEET_ID
        sync: false
      - key: GOOGLE_CREDENTIALS_JSON
        sync: false
      - key: ETHERSCAN_API_KEY
        sync: false
      - key: TELEGRAM_BOT_TOKEN
        sync: false
      - key: GEMINI_API_KEY
        sync: false
      - key: GROQ_API_KEY
        sync: false
      - key: TELETHON_API_ID
        sync: false
      - key: TELETHON_API_HASH
        sync: false
      - key: TELETHON_SESSION_STRING
        sync: false
      - key: TG_CHANNEL
        value: "@whale_alert_io"
```

주의:

- 위 YAML은 초안이다. 실제 생성 전 Render Blueprint validation을 돌리는 편이 좋다.
- `sync: false`는 초기 Blueprint 생성 시 Dashboard에서 값을 입력하게 하기 위한 설정이다.

## 7. Vercel dashboard 연결

Vercel은 `apps/dashboard`만 배포한다.

설정:

| 항목 | 값 |
|---|---|
| Root Directory | `apps/dashboard` |
| Install Command | `npm install` |
| Build Command | `npm run build` |
| Framework | Next.js |

Vercel env:

```env
GOOGLE_SHEET_ID=
GOOGLE_CREDENTIALS_JSON=
DASHBOARD_PASSWORD=
NEXT_PUBLIC_APP_NAME=WhaleScope
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=whalescope_demo_bot
```

라우트:

- `/`: 사용자용 인사이트 홈
- `/admin`: 운영 대시보드
- `/insights`: `/`로 308 redirect

## 8. 배포 후 Smoke Test

### 8.1 Render pipeline

Render Cron Job에서 `Trigger Run`을 누른 뒤 확인한다.

```text
Google Sheets
- system_log: pipeline_run 기록
- transactions: 온체인 거래 기록
- signals: 규칙 기반 시그널
- daily_brief: 한국어 브리핑
```

### 8.2 Telegram bot

Telegram에서:

```text
/start
/status
/watchlist
```

확인:

- `subscribers`에 chat id 기록
- bot 응답 수신

### 8.3 Telegram listener

확인:

- `system_log`에 `telethon_listener` heartbeat
- `tg_whale_events`에 메시지 처리 결과
- `/admin` listener 카드가 `정상`, `대기 중`, `인증 필요`, `확인 필요` 중 적절한 상태 표시

### 8.4 Vercel dashboard

확인:

```bash
curl -I https://<vercel-domain>/
curl -I https://<vercel-domain>/admin
curl -I https://<vercel-domain>/insights
```

기대:

- `/`: 200
- `/admin`: 200
- `/insights`: 308 -> `/`

## 9. 운영 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| `TELETHON_SESSION_STRING` 누락 | listener가 interactive prompt에서 멈춤 또는 auth error | 로컬에서 session string 생성 후 Render env에 등록 |
| Google Sheet 권한 누락 | pipeline/dashboard 모두 데이터 없음 | 서비스 계정 이메일에 Sheet 편집 권한 부여 |
| LLM key 없음 | daily brief 생성 실패 또는 fallback 제한 | Gemini/Groq 중 최소 1개 설정 |
| Cron 주기 과다 | API quota/LLM 비용 증가 | 1~6시간 주기로 시작 |
| Bot/listener를 한 서비스에 통합 | 한쪽 장애가 전체 장애로 확산 | Render worker 분리 유지 |

## 10. 공식 문서 근거

- Render Web Services: https://render.com/docs/web-services
- Render Background Workers: https://render.com/docs/background-workers
- Render Cron Jobs: https://render.com/docs/cronjobs
- Render Environment Variables and Secrets: https://render.com/docs/configure-environment-variables
- Render Blueprint YAML Reference: https://render.com/docs/blueprint-spec

## 11. 최종 권장안

현재 과제 제출과 운영 검증 목적에서는 다음이 가장 실용적이다.

1. Render에는 `pipeline cron`, `bot worker`, `listener worker` 3개를 만든다.
2. Vercel에는 `apps/dashboard`를 배포한다.
3. Google Sheets는 당분간 MVP DB로 유지한다.
4. Python Web Service는 당장 만들지 않는다.
5. dashboard에서 수동 실행 버튼이 필요해지는 시점에만 별도 FastAPI health/trigger service를 추가한다.
