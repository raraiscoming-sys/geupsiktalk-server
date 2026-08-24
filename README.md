# 급식톡 Supabase 서버 v17

## 변경 내용

- v16의 요일 선택 방식과 [오늘 급식] 버튼을 유지합니다.
- 나이스 급식 API가 느릴 때 카카오 스킬 타임아웃이 반복되는 문제를 줄이기 위해 급식 데이터를 Supabase `meal_cache` 테이블에 저장합니다.
- 한 번 조회에 성공한 학교/날짜 급식은 Render 재시작 후에도 Supabase에서 바로 읽어옵니다.
- 학교 등록 완료 후 오늘, 내일, 이번 주 월~금 급식을 백그라운드로 미리 불러옵니다.
- `이번주`, `다음주` 요일 선택 화면을 열면 해당 주 월~금 급식을 백그라운드로 미리 불러옵니다.
- `NEIS_TIMEOUT_MS`가 너무 낮게 설정되어 있어도 3500ms 미만으로 내려가지 않게 보정합니다.

## Supabase에 추가할 테이블

Supabase SQL Editor에서 `supabase_meal_cache.sql` 내용을 실행하세요.
기존 `kakao_users` 테이블은 그대로 둡니다.

## 적용 방법

1. Supabase SQL Editor에서 `supabase_meal_cache.sql` 실행
2. GitHub 저장소에 `package.json`, `server.js`, `README.md` 업로드/덮어쓰기
3. Render에서 자동 배포 확인
4. 자동 배포가 안 되면 Manual Deploy → Deploy latest commit
5. Render Environment에서 `NEIS_TIMEOUT_MS`를 삭제하거나 `4000`으로 설정
6. `/health`에서 `neisTimeoutMs`가 4000 안팎으로 보이는지 확인
7. 카카오톡에서 `오늘 급식`, `이번주`, `이번주 월요일` 순서로 테스트

## 권장 환경변수

- `NEIS_TIMEOUT_MS`: 비워두거나 `4000`
- `NEIS_WARM_TIMEOUT_MS`: 비워두거나 `8000`
- `MEAL_CACHE_TTL_MS`: 기본값 유지 권장

