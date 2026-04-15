# WhaleScope Demo Output

Wrtn Technologies Product Engineer 과제 전형에서 사용할 데모 출력 기준입니다.

## 데모 원칙

- 실제 LLM API 기반 경로를 우선합니다.
- smoke 경로는 API 키가 없거나 외부 의존성을 배제해야 할 때만 fallback으로 사용합니다.
- 배포 URL은 현재 없습니다. 로컬 실행과 저장소 산출물을 기준으로 확인합니다.

## 권장 시연 순서

### 1. 실데모 경로

과제 제출에서 가장 먼저 보여줄 경로입니다. fixture 시그널을 사용하지만 브리핑은 실제 LLM API를 통해 생성합니다.

```bash
python scripts/demo_real_llm.py
python scripts/demo_real_llm.py --output docs/demo-output.md
```

이 경로에서 기대하는 산출물은 다음과 같습니다.

- fixture 기반 signal summary
- 실제 LLM API가 생성한 한국어 브리핑
- provider/model/prompt 기반으로 재현 가능한 AI 요약/큐레이션 흐름

### 2. 운영형 전체 파이프라인

```bash
python -m scripts.init_sheets
python scripts/import_watched_addresses.py
python -m src.main
```

이 경로에서 기대하는 산출물은 다음과 같습니다.

- `daily_brief` 시트의 신규 브리핑 행
- `analysis_log`의 LLM 호출 기록
- Telegram 브리핑 발송 로그
- `signals` 시트의 규칙 기반 시그널 저장

### 3. fallback 경로

```bash
python scripts/smoke_pipeline.py
```

이 경로는 다음을 보여주는 보조 검증용입니다.

- fixture 이벤트 로드
- signal 생성
- dry-run brief 생성
- mock log 저장

## 데모에서 보여줄 메시지

실데모의 핵심은 "원시 데이터"가 아니라 "사용자가 바로 읽을 수 있는 한국어 요약"입니다.

예상 브리핑 구조:

```text
오늘의 핵심 시그널
- 고래 유출/유입 스파이크
- 거래소 입금/출금 맥락
- 공개 Telegram 채널에서 확인된 교차 근거
- 사용자 관심 규칙과 맞는 항목

한줄 요약
- 왜 중요한지
- 지금 봐야 하는 이유
- 과도한 해석을 피하기 위한 주의 문구
```

## 데모 체크포인트

- 실제 LLM provider가 선택되는지 확인합니다.
- signal이 있을 때만 중요한 항목이 올라오는지 확인합니다.
- 개인화가 적용되면 관심 규칙이 반영되는지 확인합니다.
- smoke 출력은 정상 동작의 보조 증거로만 사용합니다.

## 발표 시 설명 포인트

- 이 프로젝트는 수집 서비스가 아니라 AI 요약/큐레이션 서비스입니다.
- 규칙 기반 탐지와 LLM 해설을 분리해 품질과 안정성을 함께 확보했습니다.
- Google Sheets와 Telegram을 써서 과제 전형에서 바로 확인 가능한 형태로 만들었습니다.
