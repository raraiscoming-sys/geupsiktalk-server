# 급식톡 카카오 스킬 서버 v6

## 변경 내용
- 나이스 급식 메뉴 뒤의 알레르기 번호를 제거하지 않고 그대로 표시합니다.
- 메뉴 아래에 포함 알레르기 요약을 추가합니다.
- 알레르기 번호 의미표를 함께 안내합니다.
- 주간 급식표에도 알레르기 번호 요약을 표시합니다.

## Render 설정
Build Command: npm install
Start Command: npm start

환경변수:
NEIS_API_KEY=나이스 API 키
NODE_ENV=production

## 테스트
/health
/test?school=백양고등학교&date=20260526
