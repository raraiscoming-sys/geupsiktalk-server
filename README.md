# 급식톡 Supabase 저장 서버 v2 Safe

Render에서 SUPABASE_URL 형식이 잘못되어도 서버가 바로 종료되지 않도록 보완한 버전입니다.

필수 환경변수:
- NEIS_API_KEY
- SUPABASE_URL 예: https://xxxx.supabase.co
- SUPABASE_SERVICE_ROLE_KEY
- NODE_ENV=production

Render 설정:
- Build Command: npm install
- Start Command: npm start
