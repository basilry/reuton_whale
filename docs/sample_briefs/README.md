# 샘플 브리핑 모음

이 디렉토리는 WhaleScope 파이프라인이 실제로 생성한 한국어 브리핑의 스냅샷 모음입니다. 심사/리뷰 시 "오늘자 브리핑 하나 보여주세요" 질문에 즉시 응답할 수 있도록 구성했습니다.

## 명명 규칙

```
YYYYMMDD_HHMM_{full|incremental}.md
```

예: `20260421_0900_full.md`, `20260421_1030_incremental.md`

- `full`: KST 09/15/21 슬롯에서 생성된 RSS top N + curated watchlist 포함 브리핑
- `incremental`: 그 외 슬롯에서 이전 full 브리핑 기반으로 생성된 증분 브리핑

## 각 파일 하단 메타데이터 형식

```yaml
---
generated_at: 2026-04-21T09:00:00+09:00
mode: full
llm_provider: anthropic
input_fingerprint: sha256-...
cost_usd: 0.0041
signals_count: 7
transactions_processed: 142
---
```

## 재현 방법

```bash
# 리포지토리 루트에서
export ANTHROPIC_API_KEY=...   # 또는 GEMINI_API_KEY / GROQ_API_KEY
export GOOGLE_SHEET_ID=...
export GOOGLE_CREDENTIALS_JSON='...'

python scripts/demo_real_llm.py \
  --mode full \
  --output docs/sample_briefs/$(date -u +%Y%m%d_%H%M)_full.md
```

`scripts/demo_real_llm.py`는 실 Sheets/LLM 경로를 호출하므로 환경변수 및 과금 권한이 필요합니다. 샘플 갱신은 운영자 수동 실행으로 유지하며, Phase 3 단계에서 자동화 예정입니다.

## 법적/출처 경계

- 온체인 트랜잭션: 공개 체인(public chain)에서 수집한 원본 데이터 기반.
- 지갑 라벨: Etherscan, Arkham 등 공개 라벨만 사용하며 재배포하지 않습니다.
- Telegram 공개 채널 수집: read-only broadcast. 원 메시지 재발송 금지.
- 뉴스 RSS: headline과 URL만 인용하며 본문 전문 인용을 금지합니다.

## 큐레이션 기준

- `full` 슬롯 최근 3일 × 3슬롯 = 최대 9건에서 대표성 높은 3~5건 선별
- `incremental` 1~2건을 보조 비교용으로 포함
- 사용자 개인정보·미공개 지갑 라벨·비공개 채널 메시지는 포함하지 않음
