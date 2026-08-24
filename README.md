# 급식톡 Supabase 서버 v18 - 나이스 급식 캐시 예열 안정화

v18은 v17의 Supabase 급식 캐시 기능을 유지하면서, 첫 조회 때 나이스 API가 느려서 계속 안내 메시지만 나오는 문제를 줄이기 위해 캐시 예열 기능을 추가한 버전입니다.

## 핵심 변경

- `/warmup` 주소를 열면 등록된 학교의 오늘/내일/이번주/다음주 급식을 Supabase `meal_cache`에 미리 저장합니다.
- 서버가 재시작되면 자동으로 한 번 캐시 예열을 시작합니다.
- 기본 6시간마다 캐시 예열을 다시 시도합니다.
- 오늘/요일 급식 조회가 시간 초과되면, 같은 날짜 급식을 백그라운드에서 한 번 더 길게 불러와 저장합니다.
- `/health`에서 `version: v18-neis-warmup`을 확인할 수 있습니다.

## Supabase SQL

v17에서 만든 `meal_cache` 테이블이 이미 있으면 다시 실행하지 않아도 됩니다.
아직 만들지 않았다면 `supabase_meal_cache.sql`을 Supabase SQL Editor에서 실행하세요.

## 배포 파일

GitHub에 아래 파일을 덮어쓰기 업로드하세요.

- `package.json`
- `server.js`
- `README.md`

## Render 환경변수 추천

- `NEIS_TIMEOUT_MS`: 4000
- `NEIS_BACKGROUND_TIMEOUT_MS`: 12000
- `WARMUP_MAX_SCHOOLS`: 100

선택:

- `AUTO_WARMUP_ON_START=false` : 서버 시작 시 자동 예열 끄기
- `AUTO_WARMUP_INTERVAL=false` : 6시간마다 자동 예열 끄기
- `WARMUP_TOKEN=원하는문자` : `/warmup?token=원하는문자`로만 예열 허용

## 배포 후 테스트

1. `https://렌더주소/health` 접속
2. `version`이 `v18-neis-warmup`인지 확인
3. `https://렌더주소/warmup` 접속
4. 1~2분 뒤 Supabase `meal_cache` 테이블에 row가 생겼는지 확인
5. 카카오톡에서 `오늘 급식`, `이번주 → 요일 선택` 테스트
