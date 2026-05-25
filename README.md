# 급식톡 최종 스킬 서버 v7

## 변경 사항
- 당일/내일 급식 조회 시 조식·중식·석식이 모두 있으면 모두 표시합니다.
- 주간 급식표도 각 날짜별 조식·중식·석식을 함께 표시합니다.
- 학부모용 저녁 추천은 중식을 기준으로 하되, 중식이 없으면 해당 날짜의 첫 번째 급식을 기준으로 추천합니다.
- 메뉴별 알레르기 번호와 전체 알레르기 요약을 유지합니다.

## Render 설정
- Build Command: `npm install`
- Start Command: `npm start`
- Environment Variable: `NEIS_API_KEY`

## 테스트
- `/health`
- `/test?school=백양고등학교&date=20260526`
