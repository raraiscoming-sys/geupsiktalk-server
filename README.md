# 급식톡 Supabase 서버 v12

## 변경 내용
- 이번주/다음주 급식표를 한 말풍선에 모두 담지 않고 날짜별 여러 말풍선으로 나누어 전송합니다.
- 주간 급식은 메뉴 뒤 알레르기 번호와 칼로리까지만 표시합니다.
- 오늘/내일 급식, Supabase 저장, 한국 날짜 기준, 속도 캐시는 기존 기능을 유지합니다.

## 적용
1. package.json, server.js, README.md를 GitHub 저장소에 업로드합니다.
2. Render가 자동 배포되지 않으면 Manual Deploy → Deploy latest commit을 누릅니다.
3. 카카오톡에서 이번주/다음주를 테스트합니다.
