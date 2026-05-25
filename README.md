# 급식톡 카카오 챗봇 스킬 서버 최종 v2

## 변경점
- `학교등록` 버튼을 누르면 특정 학교(예: 백양고등학교)가 나오지 않고, 사용자가 직접 학교명을 입력하도록 안내합니다.
- 사용자가 `학교등록`만 입력하면 학교명 입력 대기 상태로 전환됩니다.
- 이후 사용자가 `백양고등학교`처럼 학교명만 입력해도 검색합니다.
- 학교 검색 결과가 여러 개면 학교 선택 버튼이 표시됩니다.
- 학교 선택 후 학생/학부모 버튼이 표시됩니다.

## Render 설정
Build Command: `npm install`
Start Command: `npm start`
Environment Variables:
- `NEIS_API_KEY`: 나이스 API 키
- `NODE_ENV`: production

## 카카오 스킬 URL
`https://YOUR_RENDER_URL.onrender.com/skill`

## 테스트 URL
- `/health`
- `/test?school=백양고등학교&date=20260526`
