# 급식톡 카카오 챗봇 스킬 서버 최종본

## Render 설정

- Build Command: `npm install`
- Start Command: `npm start`
- Environment Variables
  - `NEIS_API_KEY`: 나이스 Open API 인증키
  - `NODE_ENV`: `production`

## 카카오 챗봇 스킬 URL

Render 기본 주소가 `https://geupsiktalk-server.onrender.com`라면 카카오 스킬 URL은 아래처럼 등록합니다.

```text
https://geupsiktalk-server.onrender.com/skill
```

## 연결이 필요한 블록

아래 블록은 모두 `급식조회스킬`에 연결하고, 봇 응답은 `스킬데이터 사용`으로 설정합니다.

- 학교등록 / 학교변경
- 사용자유형선택: 학생, 학부모
- 오늘 급식
- 내일 급식
- 이번 주 급식
- 저녁추천
- 장보기

설정/도움말 블록은 고정 텍스트로 둬도 되고, 스킬에 연결해도 됩니다. 이 서버는 `처음`, `시작`, `설정`, `도움말`, `메뉴` 입력도 처리합니다.

## 테스트 주소

```text
/health
/test?school=백양고등학교&date=20260526
```
