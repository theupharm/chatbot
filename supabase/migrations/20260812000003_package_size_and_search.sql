-- 제품 규격 컬럼 + 취급처 거리 검색 함수 (설계문서 §5-2)
--
-- 1) products.package_size
--    원본 시트의 제품명에는 용량·포장 표기가 섞여 있다 ("덱세릴MD크림 500g").
--    챗봇 표시명에서 이를 분리하고, 원본 표기는 aliases 에 남겨 검색으로 찾을 수 있게 한다.
--
-- 2) search_pharmacies()
--    하버사인 거리 계산을 DB 에서 수행한다. SECURITY INVOKER(기본값)이므로
--    호출자의 RLS 가 그대로 적용된다 — 익명 키로는 is_active 취급처만 보인다.

alter table products add column if not exists package_size text;

comment on column products.package_size is '용량·포장 규격. 표시명과 분리해 보관 (예: 500g, 30T)';

create or replace function search_pharmacies(
  p_product_id bigint,
  p_lat        double precision,
  p_lng        double precision,
  p_limit      int default 5,
  p_radius_km  double precision default 10
)
returns table (
  id          bigint,
  name        text,
  address     text,
  phone       text,
  org_type    text,
  lat         double precision,
  lng         double precision,
  distance_km numeric
)
language sql
stable
as $$
  with box as (
    select
      p_radius_km / 111.0 as dlat,
      -- 위도가 높을수록 경도 1도의 실제 거리가 짧아진다. 0 나눗셈만 방어한다.
      p_radius_km / greatest(111.0 * cos(radians(p_lat)), 0.000001) as dlng
  ),
  candidates as (
    select
      ph.id, ph.name, ph.address, ph.phone, ph.org_type, ph.lat, ph.lng,
      -- acos 정의역을 벗어나는 부동소수점 오차를 잘라낸다
      6371 * acos(least(1.0, greatest(-1.0,
        cos(radians(p_lat)) * cos(radians(ph.lat)) * cos(radians(ph.lng) - radians(p_lng))
        + sin(radians(p_lat)) * sin(radians(ph.lat))
      ))) as dist
    from pharmacies ph
    join pharmacy_products pp on pp.pharmacy_id = ph.id
    cross join box
    where pp.product_id = p_product_id
      and ph.is_active
      -- 바운딩 박스 선필터: idx_pharmacies_geo 를 태워 후보를 좁힌다
      and ph.lat between p_lat - box.dlat and p_lat + box.dlat
      and ph.lng between p_lng - box.dlng and p_lng + box.dlng
  )
  select id, name, address, phone, org_type, lat, lng, round(dist::numeric, 1)
  from candidates
  where dist <= p_radius_km
  order by dist asc
  limit p_limit;
$$;

grant execute on function search_pharmacies(bigint, double precision, double precision, int, double precision)
  to anon, authenticated;
