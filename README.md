# 급식톡 스킬 서버 Supabase v1

카카오톡 챗봇 급식 조회 서버입니다. 사용자 학교/유형 정보를 Supabase `kakao_users` 테이블에 저장합니다.

## Render 환경변수

필수:
- `NEIS_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

권장:
- `NODE_ENV=production`

## Render 설정

- Build Command: `npm install`
- Start Command: `npm start`

## Supabase 테이블

```sql
create table if not exists kakao_users (
  kakao_user_id text primary key,
  user_type text,
  school_name text,
  office_code text,
  school_code text,
  office_name text,
  school_address text,
  pending_schools jsonb,
  pending_action text,
  updated_at timestamp with time zone default now()
);
```

## 테스트

- `/health`
- `/test?school=백양고등학교&date=20260526`
- `/skill`은 Kakao POST 전용
