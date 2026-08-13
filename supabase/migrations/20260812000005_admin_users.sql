-- 관리자 허용목록 (설계문서 §9)
--
-- 왜 필요한가
--   Supabase Auth 에 로그인했다는 것만으로 관리자 권한을 주면, 프로젝트에 회원가입이
--   열려 있는 순간 누구나 불만 접수 연락처를 볼 수 있게 된다.
--   "인증됨"과 "관리자임"을 분리한다.
--
-- 운영
--   1) Supabase 대시보드 > Authentication > Users 에서 계정을 만든다
--   2) 그 계정의 uuid 를 이 테이블에 넣는다
--   회원가입 자체도 대시보드에서 꺼두는 것을 권장한다 (이중 방어).

create table admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  note       text,
  created_at timestamptz not null default now()
);

alter table admin_users enable row level security;

-- 로그인한 사용자는 "내가 관리자인지"만 확인할 수 있다. 다른 관리자 목록은 볼 수 없다.
create policy admin_users_self_read on admin_users
  for select to authenticated
  using (user_id = auth.uid());

comment on table admin_users is
  '관리자 페이지 접근이 허용된 사용자. 인증(auth.users)과 인가(이 테이블)를 분리한다';
