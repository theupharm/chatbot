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
