# 급식톡 Supabase 저장 서버 v3

변경 사항:
- 급식 메뉴 뒤 알레르기 번호는 유지합니다.
- 해당 급식에 포함된 알레르기 번호와 항목만 요약해서 표시합니다.
- 1~19번 전체 알레르기 번호표는 제거했습니다.
- Supabase 사용자 저장, 학교 검색, 학생/학부모 선택, 조식/중식/석식 표시 기능은 유지됩니다.

Render 설정:
- Build Command: npm install
- Start Command: npm start

필수 환경변수:
- NEIS_API_KEY
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- NODE_ENV=production (선택이지만 유지 권장)
