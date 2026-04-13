# Arxiv Weekly - AI 논문 요약 & 연구 트렌드 큐레이션 서비스

## 1. 프로젝트 개요

**프로젝트명**: Arxiv Weekly  
**한 줄 요약**: 매주 Arxiv에서 올라오는 AI/ML 논문을 AI가 요약·큐레이션하고, 사용자 피드백을 반영해 점차 개인화하는 서비스

**목적**  
- 입사 과제로 **AI 요약 + 큐레이션 + 가벼운 개인화** 역량을 종합적으로 보여주기
- 실제로 쓸 수 있는 수준의 MVP 완성
- Claude Code(Artifacts)를 최대한 활용해 7일 이내 개발

**타겟 사용자**  
- AI 연구자, ML 엔지니어, 테크 트렌드를 따라가는 개발자/기획자

---

## 2. 주요 기능

### 필수 기능 (MVP)
- 매주 Arxiv 논문 자동 수집 (cs.AI, cs.LG 등)
- Claude를 활용한 고품질 논문 요약 (한 줄 요약 + 핵심 기여 + 실무 함의)
- Primary/Secondary 카테고리 자동 태깅
- 주간 트렌드 코멘터리 자동 생성
- Top 8~10개 논문 큐레이션

### 개인화 기능 (Light)
- Telegram에서 "에이전트 더 보고 싶어요", "멀티모달 위주로" 같은 자연어 피드백 수신
- Google Sheets에 사용자 관심 키워드 저장
- 다음 주 큐레이션 시 해당 키워드 가중치 부여

### 보조 인터페이스
- Streamlit 웹 대시보드 (전체 보기, 키워드 관리, 아카이브)

---

## 3. 기술 스택

| Layer | 기술 | 비고 |
|-------|------|------|
| LLM | Claude 3.5 Sonnet | 요약 품질 최우선 |
| 언어 | Python 3.11+ | - |
| Bot | python-telegram-bot v21 | - |
| 웹 | Streamlit | 빠른 UI |
| 데이터 저장 | Google Sheets (gspread) | DB 대신 사용 |
| 스케줄링 | GitHub Actions (cron) | 매주 월요일 실행 |

---

## 4. Google Sheets 구조

### 탭 1: Papers
- Date, Arxiv_ID, Title, Authors, Abstract, TLDR, Summary, Primary_Category, Secondary_Categories, Importance_Score, Trend_Comment

### 탭 2: User_Interests
- Timestamp, User_ID, Username, Keyword, Weight, Memo

---

## 5. 개발 일정 (7일)

- **Day 1~2**: Arxiv API 수집 + Claude 요약 파이프라인 + Google Sheets 연동
- **Day 3~4**: Telegram Bot + 피드백 처리 + GitHub Actions 자동화
- **Day 5~6**: Streamlit Dashboard + 아카이브/검색
- **Day 7**: 통합 테스트 + README + 데모 준비

---

## 6. 차별화 포인트
- 실무자 관점 해석이 포함된 트렌드 코멘터리
- Light Personalization (오버엔지니어링 피함)
- Google Sheets 초경량 아키텍처
- Telegram + Web 듀얼 인터페이스

---

## 7. 향후 확장 방향
- Supabase/PostgreSQL 마이그레이션
- RAG 기반 논문 검색 챗봇
- Notion/Email 연동
- 사용자별 맞춤 뉴스레터

---

> 개발 슬로건: "최대한 가볍게, 하지만 실제로 유용하게"
