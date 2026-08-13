-- ============================================================================
-- 더유제약 챗봇 — 초기 스키마 전체 (SQL Editor 붙여넣기용)
--
-- supabase/migrations/ 의 두 마이그레이션을 순서대로 합친 파일입니다.
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run 하세요.
--
-- CLI(`supabase db push`)로 적용하는 경우 이 파일은 사용하지 마세요.
-- 이 파일로 적용한 뒤 나중에 CLI 를 쓰려면 마이그레이션 이력을 맞춰야 합니다:
--   npx supabase migration repair --status applied 20260812000001
--   npx supabase migration repair --status applied 20260812000002
-- ============================================================================

-- ===== 20260812000001_init.sql =====
-- 더유제약 챗봇 — 초기 스키마 (설계문서 §4)
-- 적용 후 이 파일은 수정하지 말 것. 변경은 새 순번 마이그레이션으로 추가한다. (§13)

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- 공통: updated_at 자동 갱신
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 제품
-- ---------------------------------------------------------------------------
create table products (
  id            bigint generated always as identity primary key,
  name          text not null,               -- 표시용 정식 제품명
  name_norm     text not null,               -- 정규화: 공백/특수문자 제거, 소문자
  name_jamo     text not null,               -- 자모 분해 (퍼지 검색용)
  name_chosung  text not null,               -- 초성 (초성 검색용) 예: "베아제" → "ㅂㅇㅈ"
  aliases       text[] not null default '{}',-- 별칭·흔한 오타
  category      text,                        -- 검색 0건 폴백 목록의 그룹 기준 (§5-1)
  info_url      text,                        -- 통합 정보 시스템 링크
  is_active     boolean not null default true,
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now()
);

create unique index uq_products_name_norm  on products (name_norm);
create index idx_products_prefix           on products (name_norm text_pattern_ops);
create index idx_products_jamo_trgm        on products using gin (name_jamo gin_trgm_ops);
create index idx_products_aliases          on products using gin (aliases);
create index idx_products_category         on products (category) where is_active;

create trigger trg_products_updated_at
  before update on products
  for each row execute function set_updated_at();

comment on column products.name_norm is '서버가 저장 시 자동 생성. 클라이언트 입력값을 신뢰하지 않는다 (§13)';

-- ---------------------------------------------------------------------------
-- 취급처 (약국·의원·피부과 등)
-- ---------------------------------------------------------------------------
create table pharmacies (
  id            bigint generated always as identity primary key,
  name          text not null,               -- 표시용 상호 (원본의 지역 접미사 제거 — §4-1)
  name_norm     text not null,               -- 정규화 상호 (중복 판정용)
  org_type      text not null default 'pharmacy'
                check (org_type in ('pharmacy', 'clinic', 'other')),
  address       text not null,               -- 원본 주소 전체 (도로명·지번 혼재)
  address_norm  text not null,               -- 정규화 주소 (중복 판정용)
  sido          text,
  sigungu       text,
  phone         text,
  -- NOT NULL: "잘못된 주소는 저장 차단"을 앱이 아니라 DB에서 강제한다 (§9-2)
  lat           double precision not null,
  lng           double precision not null,
  is_active     boolean not null default true,
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  constraint chk_pharmacies_lat check (lat between 32.0 and 39.5),   -- 대한민국 범위
  constraint chk_pharmacies_lng check (lng between 124.0 and 132.0)
);

create unique index uq_pharmacies_name_addr on pharmacies (name_norm, address_norm);
create index idx_pharmacies_geo             on pharmacies (lat, lng);
create index idx_pharmacies_region          on pharmacies (sido, sigungu);
create index idx_pharmacies_type            on pharmacies (org_type) where is_active;

create trigger trg_pharmacies_updated_at
  before update on pharmacies
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 취급처-제품 관계 (기존 시트의 각 행 = 이 테이블 1건 — §4-1)
-- ---------------------------------------------------------------------------
create table pharmacy_products (
  pharmacy_id   bigint not null references pharmacies(id) on delete cascade,
  product_id    bigint not null references products(id) on delete cascade,
  primary key (pharmacy_id, product_id)
);

create index idx_pharmacy_products_product on pharmacy_products (product_id);

-- ---------------------------------------------------------------------------
-- 지오코딩 캐시 (Kakao 쿼터 절감 — §9-3)
-- ---------------------------------------------------------------------------
create table geocode_cache (
  q             text primary key,            -- 정규화된 질의 문자열
  lat           double precision not null,
  lng           double precision not null,
  road_address  text,
  hit_count     int not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 불만 접수 (의료인) — §8
-- ---------------------------------------------------------------------------
create table complaints (
  id            bigint generated always as identity primary key,
  ticket_no     text not null,               -- 사용자 안내용 접수번호 C-YYYYMMDD-NNNN
  org_name      text not null,
  region        text not null,
  content       text not null,
  contact       text not null,               -- 개인정보. §8 보관·파기 정책 대상
  product_id    bigint references products(id),
  is_ae_suspect boolean not null default false,
  ae_keywords   text[] not null default '{}',
  consent_at    timestamptz not null,        -- 개인정보 수집·이용 동의 시각
  status        text not null default 'new'
                check (status in ('new', 'in_progress', 'done')),
  email_sent    boolean not null default false,
  email_error   text,
  purged_at     timestamptz,                 -- 파기 시각 (파기 시 contact/content 마스킹)
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create unique index uq_complaints_ticket_no on complaints (ticket_no);
create index idx_complaints_status on complaints (status, created_at desc);
create index idx_complaints_ae     on complaints (created_at desc) where is_ae_suspect;

create trigger trg_complaints_updated_at
  before update on complaints
  for each row execute function set_updated_at();

-- 접수번호 자동 발번. 동시 접수 시 충돌은 uq_complaints_ticket_no 가 막고,
-- API 계층에서 재시도한다 (Phase 4).
create or replace function gen_ticket_no()
returns trigger
language plpgsql
as $$
declare
  d text := to_char(timezone('Asia/Seoul', now()), 'YYYYMMDD');
  n int;
begin
  if new.ticket_no is not null and new.ticket_no <> '' then
    return new;
  end if;
  select count(*) + 1 into n from complaints where ticket_no like 'C-' || d || '-%';
  new.ticket_no := 'C-' || d || '-' || lpad(n::text, 4, '0');
  return new;
end;
$$;

-- BEFORE INSERT 트리거는 NOT NULL 검사보다 먼저 실행되므로
-- ticket_no 를 생략하고 insert 해도 트리거가 채운 값으로 통과한다.
create trigger trg_complaints_ticket_no
  before insert on complaints
  for each row execute function gen_ticket_no();


-- ===== 20260812000002_rls.sql =====
-- RLS 정책 (설계문서 §4 공통 규칙, §9 구현 노트)
--
-- 원칙
--   - 익명(anon) 키: is_active 인 제품·취급처·매핑에 대한 select 만 허용
--   - 인증(authenticated): 관리자 화면 조회용. 비활성 행 포함 select 허용, 쓰기는 없음
--   - 모든 쓰기는 서버 라우트가 service key 로 수행한다 (service key 는 RLS 를 우회)
--   - 정책이 하나도 없는 테이블은 service key 외에는 접근 불가

alter table products          enable row level security;
alter table pharmacies        enable row level security;
alter table pharmacy_products enable row level security;
alter table complaints        enable row level security;
alter table geocode_cache     enable row level security;

-- 제품 -----------------------------------------------------------------------
create policy products_anon_read on products
  for select to anon
  using (is_active);

create policy products_auth_read on products
  for select to authenticated
  using (true);

-- 취급처 ---------------------------------------------------------------------
create policy pharmacies_anon_read on pharmacies
  for select to anon
  using (is_active);

create policy pharmacies_auth_read on pharmacies
  for select to authenticated
  using (true);

-- 매핑 -----------------------------------------------------------------------
create policy pharmacy_products_anon_read on pharmacy_products
  for select to anon
  using (
    exists (select 1 from pharmacies ph where ph.id = pharmacy_id and ph.is_active)
    and exists (select 1 from products p where p.id = product_id and p.is_active)
  );

create policy pharmacy_products_auth_read on pharmacy_products
  for select to authenticated
  using (true);

-- 불만 접수 ------------------------------------------------------------------
-- 익명 접근 전면 금지. 접수(insert)는 서버가 service key 로 수행한다.
-- 관리자 조회는 /api/admin/complaints 를 경유하지만, 직접 조회도 가능하도록 열어둔다.
create policy complaints_auth_read on complaints
  for select to authenticated
  using (true);

-- 지오코딩 캐시 --------------------------------------------------------------
-- 정책 없음 = service key 전용

