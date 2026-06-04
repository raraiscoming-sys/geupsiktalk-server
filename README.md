# 급식톡 Supabase 서버 v8 speed-cache

기준: v7(학생(교직원) 버튼) + 한국 날짜 기준 + Supabase 저장 + 속도 개선.

## 추가 개선
- 사용자 등록 정보를 5분간 메모리 캐시하여 Supabase 조회 지연 감소
- 학교 검색 결과를 24시간 캐시
- 급식 조회 결과를 6시간 캐시
- 도움말/학교등록 시작 등은 Supabase 조회 전에 즉시 처리
- /health에서 cacheSize, koreaDate 확인 가능

## 환경변수
필수:
- NEIS_API_KEY
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

선택:
- NODE_ENV=production
- USER_CACHE_TTL_MS=300000
- MEAL_CACHE_TTL_MS=21600000
- SCHOOL_CACHE_TTL_MS=86400000
- NEIS_TIMEOUT_MS=4500
