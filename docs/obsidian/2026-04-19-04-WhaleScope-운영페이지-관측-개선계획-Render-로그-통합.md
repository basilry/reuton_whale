---
date: 2026-04-19
sequence: 4
tags:
  - whalescope
---

# WhaleScope 운영페이지 관측 개선계획: 수집 데이터, 워커 상태, Render 로그 통합

## 1. 문서 목적
- 현재 `/admin` 운영 페이지는 `Google Sheets` 기반 내부 원장 데이터를 중심으로 동작한다.
- 그러나 실제 운영 판단에는 다음 세 축이 동시에 필요하다.
  - 무엇이 수집되었는가
  - 어느 워커가 실제로 돌고 있는가
  - Render 플랫폼에서 인스턴스와 로그가 어떤 상태인가
- 본 문서는 운영 페이지를 `데이터 관측 + 워커 관측 + 플랫폼 관측` 3계층으로 재정리하기 위한 개선계획을 정의한다.

## 2. 현재 상태 요약

### 2.1 이미 구현된 것
- `transactions`, `signals`, `daily_brief`, `system_log`, `broadcast_log`, `brief_cost_ledger`, `channel_health`, `service_health` 등 Sheets 기반 운영 원장이 존재한다.
- `src.pipeline.run_all`은 슬롯 기준으로 `signals`, `curated_balance`, `news_rss`, `broadcast_periodic`, `brief`, `stories`, `broadcast_daily`, `channel_health`, `weekly_trend`를 스케줄링한다.
- `service_health` heartbeat와 `system_log`를 통해 파이프라인/리스너/텔레그램 관련 기본 운영 상태를 판단할 수 있다.
- `/admin`은 `apps/dashboard/lib/metrics.ts`에서 원장 시트를 읽어 운영 요약을 계산한다.

### 2.2 아직 부족한 것
- `수집 현황`과 `플랫폼 현황`이 명확히 분리되어 있지 않다.
- Render에서 실제 어떤 서비스가 살아 있는지, 최근 deploy가 무엇인지, 인스턴스가 몇 개인지, 최근 raw 로그가 어떤지 운영 페이지에서 직접 볼 수 없다.
- 현재 `service_health`는 heartbeat 중심이라, `마지막 성공 처리량`, `최근 실패 시각`, `지연 시간`, `소스별 처리 상태`까지는 정교하게 표현하지 못한다.
- 장애 분석 시 `Sheets 원장`, `system_log`, `Render Dashboard`를 운영자가 각각 따로 열어봐야 한다.

## 3. 개선 방향

### 3.1 운영 페이지의 정보 계층을 3개로 분리한다
1. `수집 데이터 계층`
   - 실제 데이터가 쌓였는지 본다.
   - 원천: `Google Sheets`
   - 대상: `transactions`, `signals`, `daily_brief`, `news_feed`, `tg_whale_events`, `broadcast_log`, `brief_cost_ledger`

2. `워커/파이프라인 계층`
   - 각 작업이 정상적으로 돌아가고 있는지 본다.
   - 원천: `service_health`, `system_log`, `channel_health`
   - 대상: `pipeline.run_all`, `signals`, `news_rss`, `brief`, `broadcast_periodic`, `broadcast_daily`, `channel_health`, `telethon_listener`, `telegram bot`

3. `플랫폼 계층`
   - Render 서비스/인스턴스/배포/로그 상태를 본다.
   - 원천: `Render REST API`
   - 대상: `pipeline cron`, `listener worker`, `bot worker`, 추후 web/private service

### 3.2 원칙
- `데이터가 있는가`와 `서비스가 떠 있는가`는 다른 질문으로 취급한다.
- 운영 페이지는 이 둘을 같은 카드에 섞지 않는다.
- `Sheets`에는 정규화된 운영 이벤트만 저장한다.
- `Render raw log`는 장기 적재하지 않고 최근 로그를 on-demand 또는 짧은 캐시로 보여준다.

## 4. 목표 화면 구조

### 4.1 섹션 A: 수집 데이터 현황
- 최근 24시간 row 증가량
- 마지막 적재 시각
- 탭별 최신 레코드 샘플
- 데이터 없음 / 지연 / 정상 구분

#### 대상 탭
- `transactions`
- `signals`
- `daily_brief`
- `news_feed`
- `tg_whale_events`
- `broadcast_log`
- `brief_cost_ledger`

### 4.2 섹션 B: 워커 / 파이프라인 상태
- 서비스명
- 상태: `healthy / degraded / waiting / down / config_required`
- 마지막 heartbeat
- 마지막 성공 시각
- 마지막 실패 시각
- 최근 처리량
- 최근 오류 요약
- stale 기준

#### 운영 서비스 예시
- `pipeline.run_all`
- `pipeline.signals`
- `pipeline.news_rss`
- `pipeline.brief`
- `pipeline.broadcast_periodic`
- `pipeline.broadcast_daily`
- `pipeline.channel_health`
- `telethon_listener`
- `telegram subscriber bot`

### 4.3 섹션 C: Render 플랫폼 상태
- Render 서비스명
- 서비스 타입: `cron / worker / web / private`
- 현재 상태
- 최근 deploy 시각
- 최근 deploy 상태
- 인스턴스 수
- 인스턴스별 state / startedAt
- 최근 로그 20~50줄

## 5. 기술 설계

### 5.1 Source of Truth 분리

#### A. 운영 원장
- `Google Sheets`
- 장점
  - 현재 아키텍처와 일관된다.
  - 비개발자도 추적 가능하다.
  - brief/broadcast/telegram/channel health와 바로 연결된다.

#### B. 플랫폼 메타데이터
- `Render API`
- 장점
  - 서비스 목록, 인스턴스, deploy, 로그를 직접 조회할 수 있다.
  - 운영 페이지가 Render Dashboard를 일부 대체할 수 있다.

### 5.2 왜 둘을 합치지 않는가
- Render 로그는 양이 많고 retention/rate limit 이슈가 있다.
- Sheets에 raw platform logs를 모두 적재하면 노이즈와 비용이 커진다.
- 반대로 Sheets만으로는 `실제 서비스/인스턴스가 살아 있는지`를 정확히 알 수 없다.
- 따라서:
  - `정규화된 운영 이벤트`는 Sheets
  - `플랫폼 원본 상태`는 Render API
  - 운영 페이지가 둘을 합쳐서 보여주는 구조가 적절하다.

## 6. 데이터 모델 개선안

### 6.1 `service_health` 확장
- 현재 필드
  - `ts`, `service`, `component`, `status`, `heartbeat_key`, `details`, `error`
- 확장 제안
  - `instance_id`
  - `job_name`
  - `last_success_at`
  - `last_failure_at`
  - `processed_count`
  - `lag_seconds`
  - `duration_ms`
  - `source_name`

### 6.2 목적
- 단순히 `살아있다`가 아니라
  - 무엇을 처리했는지
  - 얼마나 지연됐는지
  - 마지막 성공/실패가 언제인지
  - 어느 source에서 문제가 나는지
  를 운영 페이지에서 바로 보여주기 위함이다.

## 7. Render 연동 설계

### 7.1 필요한 서버 전용 환경변수
- `RENDER_API_KEY`
- `RENDER_OWNER_ID`
- `RENDER_SERVICE_ID_PIPELINE`
- `RENDER_SERVICE_ID_LISTENER`
- `RENDER_SERVICE_ID_BOT`

### 7.2 보안 원칙
- 위 값은 모두 server-only env로 둔다.
- `NEXT_PUBLIC_*`로 노출하지 않는다.
- `/admin`에서만 사용하며 외부 공개 API로 열지 않는다.

### 7.3 필요한 기능
- `listRenderServices()`
- `getRenderService(serviceId)`
- `listRenderInstances(serviceId)`
- `listRenderDeploys(serviceId)`
- `listRenderLogs({ ownerId, resourceIds, startTime, endTime, limit })`

### 7.4 참고 API
- Render API 문서: [The Render API](https://render.com/docs/api)
- 서비스 목록: [List services](https://api-docs.render.com/reference/list-services)
- 인스턴스 목록: [List instances](https://api-docs.render.com/reference/list-instances)
- 배포 목록: [List deploys](https://api-docs.render.com/reference/list-deploys)
- 로그 목록: [List logs](https://api-docs.render.com/reference/list-logs)

## 8. `/admin` 확장 설계

### 8.1 새 summary 타입 제안
- `renderServices`
- `renderInstances`
- `renderLogs`

### 8.2 예시 타입
```ts
type AdminRenderService = {
  id: string;
  name: string;
  type: string;
  status: "live" | "degraded" | "deploying" | "unknown";
  lastDeployAt?: string;
  lastDeployStatus?: string;
};

type AdminRenderInstance = {
  serviceId: string;
  instanceId: string;
  state: string;
  startedAt?: string;
};

type AdminRenderLogLine = {
  serviceId: string;
  serviceName: string;
  timestamp: string;
  level: string;
  message: string;
  instanceId?: string;
};
```

### 8.3 UI 카드 구성
- `데이터 적재 현황`
- `워크플로/워커 헬스`
- `Render 서비스 상태`
- `최근 Render 로그`
- `최근 실패 이벤트`

## 9. 캐싱 및 비용 전략

### 9.1 Sheets
- 기존처럼 서버에서 읽는다.
- 운영 페이지에서 15~30초 정도의 revalidate 또는 request memoization을 둔다.

### 9.2 Render API
- 매 페이지 요청마다 무제한 호출하지 않는다.
- `/admin`용 서버 fetch는 짧은 캐시를 둔다.
- 로그는 최근 `20~50줄`만 가져온다.
- 기본 범위는 `최근 15분` 또는 `최근 1시간`으로 제한한다.

### 9.3 왜 필요한가
- Render API는 플랫폼 메타 조회에 적합하지만, 운영 페이지 새로고침마다 전체 로그를 가져오면 과도하다.
- 운영 판단에 필요한 최근 상태만 노출하는 것이 맞다.

## 10. 구현 단계

### Phase 1. 데이터/워커 계층 정교화
- `service_health` schema 확장
- `pipeline.run_all`, `telethon_listener`, `telegram bot` heartbeat에 상세 필드 기록
- `/admin`에 `수집 데이터 현황`과 `워커 상태`를 명확히 분리

### Phase 2. Render 플랫폼 계층 추가
- `apps/dashboard/lib/render.ts` 추가
- Render services/instances/deploys/logs 조회 구현
- `/admin`에 `Render 상태` 카드와 `최근 로그 패널` 추가

### Phase 3. 운영 상관분석 UX
- 특정 워커에서 에러 발생 시 관련 `system_log`와 `Render log`를 나란히 보여주기
- 특정 서비스가 down이면 관련 Sheets stale 탭을 함께 하이라이트
- `데이터 없음 vs 서비스 장애 vs 설정 누락`을 사람 언어로 설명

## 11. QA 기준

### 11.1 기능 QA
- `/admin`에서 세 계층이 분리되어 보인다.
- Render 연동 env가 없을 때 graceful fallback 한다.
- Render API 실패 시 내부 오류 전문을 그대로 노출하지 않는다.
- 최근 로그가 서비스별로 필터링된다.

### 11.2 운영 QA
- pipeline cron이 정상인데 data가 stale한 경우 식별된다.
- listener가 auth_required인데 Render 서비스는 live인 상태를 구분해서 보여준다.
- bot worker가 live지만 broadcast_log가 skip만 쌓이는 경우 식별된다.
- deploy 실패와 runtime failure를 다른 상태로 보여준다.

## 12. 예상 리스크
- Render API rate limit
- Render 로그 retention 한계
- 플랫폼 로그와 애플리케이션 로그 시간축 불일치
- `/admin` 서버 fetch 지연 증가

### 대응
- 짧은 캐시
- 최근 범위 제한
- 타임존 통일(KST 표시, UTC 내부 저장)
- raw 에러 대신 정제 메시지 노출

## 13. 결론
- 운영 페이지를 제대로 쓰려면 `수집 데이터`, `워커 상태`, `Render 플랫폼 상태`를 분리해서 보여줘야 한다.
- 현재 WhaleScope는 첫 번째와 두 번째 축의 기초는 이미 있다.
- 다음 단계의 본질은 `Render 플랫폼 메타 계층`을 `/admin`에 추가해, 운영자가 Sheets와 Render Dashboard를 번갈아 열지 않게 만드는 것이다.
- 최종 목표는 `/admin` 하나에서 다음 질문에 답할 수 있게 하는 것이다.
  - 데이터는 들어오고 있는가
  - 어느 워커가 멈췄는가
  - Render에서 실제로 무슨 로그가 발생했는가
