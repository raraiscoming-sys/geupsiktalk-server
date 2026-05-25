# 급식톡 Supabase 서버 v4

변경 사항:
- 급식 조회 날짜에 요일을 함께 표시합니다. 예: 2026.05.26.(화)
- 오늘/내일/이번 주 급식표 모두 같은 날짜 형식으로 표시됩니다.
- Supabase 저장, 조식/중식/석식 표시, 알레르기 요약, 학부모 저녁추천 기능은 유지됩니다.

Render 설정:
- Build Command: npm install
- Start Command: npm start
- 환경변수: NEIS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NODE_ENV
