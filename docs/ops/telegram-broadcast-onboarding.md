# Telegram Broadcast Onboarding

## 목적
- `broadcast_daily` 워커가 공개 채널과 구독자 DM에 같은 브리핑 원문을 안정적으로 배포하도록 운영 절차를 고정한다.
- 기본 운영 모드는 `Shadow`다. 실제 전송 전 최소 1주일 동안 `broadcast_log`와 `channel_health`를 먼저 검증한다.

## 1. 준비물
- 공개 채널 username
  - 예: `@whalescope_alertz`
- 발송용 봇 토큰
  - 우선순위: `TELEGRAM_BROADCAST_BOT_TOKEN`
  - 없으면 `TELEGRAM_BOT_TOKEN` fallback
- Render/GitHub Actions/Vercel과 분리된 동일 환경변수 세트
  - `TELEGRAM_BROADCAST_CHAT`
  - `TELEGRAM_BROADCAST_ENABLED`
  - `TELEGRAM_BROADCAST_DRY_RUN`

## 2. 채널 권한 설정
- Telegram에서 공개 채널 생성 후 username을 고정한다.
- 발송용 봇을 채널에 초대한다.
- 봇 권한은 최소 `Post Messages`가 필요하다.
- 가능하면 `Edit Messages`, `Delete Messages`는 주지 않는다.
- `ChannelHealth` 워커가 `getChat`과 `getChatMemberCount`를 호출할 수 있도록 채널 admin으로 승격한다.

## 3. 기본 환경변수
- Shadow 운영 기본값
  - `TELEGRAM_BROADCAST_ENABLED=true`
  - `TELEGRAM_BROADCAST_DRY_RUN=true`
- Live 전환 전까지 `DRY_RUN`은 유지한다.
- `TELEGRAM_BROADCAST_CHAT`에는 공개 채널 username을 넣는다.
  - 예: `@whalescope_alertz`

## 4. 검증 순서
1. `python -m src.pipeline.channel_health`
   - `channel_health` 시트에 `status=ok`가 기록되는지 확인한다.
2. `python -m src.pipeline.broadcast_daily`
   - `broadcast_log`에 `dry_run`이 기록되는지 확인한다.
3. `python -m src.pipeline.brief`
   - `daily_brief`와 `llm_budget_log`가 같이 증가하는지 확인한다.
4. GitHub Actions에서 `signals`, `brief`, `broadcast_daily`, `channel_health` 워크플로를 수동 실행한다.

## 5. Shadow 운영 기준
- 최소 7일 유지한다.
- 매일 확인할 항목
  - `daily_brief` 최신 row 존재
  - `broadcast_log`에 `dry_run` 1건 이상
  - `channel_health` 최신 row의 `status`
  - `system_log`에 `broadcast_daily` 오류 누적 여부
- 아래 중 하나라도 있으면 Live 전환 금지
  - `channel_health.status=failed`
  - `broadcast_log.status=failed`
  - 최신 brief가 36시간 이상 stale

## 6. Live 전환 체크리스트
- `TELEGRAM_BROADCAST_DRY_RUN=false`
- `TELEGRAM_BROADCAST_ENABLED=true`
- 발송용 봇이 채널 admin 상태 유지
- 최근 7일 `channel_health` 실패 없음
- 최근 7일 `broadcast_log` dry-run 실패 없음
- 첫 Live 전환 직후 수동으로 `python -m src.pipeline.broadcast_daily` 실행

## 7. 운영 중 문제 발생 시
- 공개 채널 전송만 끄려면
  - `TELEGRAM_BROADCAST_ENABLED=false`
- Shadow로 되돌리려면
  - `TELEGRAM_BROADCAST_ENABLED=true`
  - `TELEGRAM_BROADCAST_DRY_RUN=true`
- 구독자 DM 봇은 `broadcast_daily`에서 별도 토큰으로 계속 동작하므로, public channel만 실패하는지 분리해서 본다.
