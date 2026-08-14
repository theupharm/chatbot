-- 이용 통계 (설계문서 §9-5)
--
-- 지금까지 서버는 대화를 저장하지 않았다(§3, §13). 통계를 내려면 최소한의 이벤트를
-- 남겨야 하므로, **무엇을 남기지 않을지**를 먼저 정하고 그에 맞춘 테이블이다.
--
-- 남기지 않는 것
--   · 사용자 위치 좌표 — §13. 지역은 주소로 검색한 경우의 시/도만, 그것도 선택적으로 남긴다
--   · 대화 전문, 불만 내용·연락처
--   · IP, 브라우저 정보
--   · 검색어 원문 — 결과가 0건인 경우에만 남긴다 (별칭 보강 목적)
--
-- session_id 는 대화 하나당 새로 만드는 임의값이고 브라우저에 저장하지 않는다.
-- 따라서 재방문한 같은 사람을 이어붙일 수 없다. "몇 명"이 아니라 "몇 번의 대화"를 센다.

create table usage_events (
  id           bigint generated always as identity primary key,
  session_id   uuid not null,
  event_type   text not null check (event_type in (
                 'widget_open',      -- 위젯을 열었다
                 'branch',           -- 분기를 선택했다
                 'product_search',   -- 제품을 검색했다
                 'product_select',   -- 제품을 골랐다
                 'pharmacy_search',  -- 취급처를 검색했다
                 'complaint_submit'  -- 불만을 접수했다
               )),
  branch       text check (branch in ('pharmacy', 'complaint', 'info', 'etc')),
  product_id   bigint references products(id) on delete set null,
  -- 결과가 0건인 검색어만 담는다. 정규화·길이 제한은 API 에서 처리한다
  query        text,
  -- 주소로 검색한 경우의 시/도. 현재 위치로 검색한 경우는 비운다
  sido         text,
  result_count int,
  created_at   timestamptz not null default now()
);

create index idx_usage_events_created  on usage_events (created_at desc);
create index idx_usage_events_type     on usage_events (event_type, created_at desc);
create index idx_usage_events_product  on usage_events (product_id) where product_id is not null;
create index idx_usage_events_query    on usage_events (created_at desc) where query is not null;

alter table usage_events enable row level security;

-- 익명 접근 없음. 기록은 서버가 service key 로, 조회는 관리자만.
create policy usage_events_auth_read on usage_events
  for select to authenticated
  using (true);

comment on table usage_events is
  '챗봇 이용 통계용 이벤트. 개인 식별 정보와 위치 좌표는 담지 않는다 (§13)';


-- ── 집계 함수 ────────────────────────────────────────────────────────────
-- 관리자 화면이 원시 행을 내려받아 계산하지 않도록 DB 에서 집계해 준다.
-- 모두 SECURITY INVOKER(기본값)라 호출자의 RLS 가 그대로 적용된다.

/** 일별 이용량: 대화 수(위젯 열림)와 분기별 선택 수 */
create or replace function stats_daily(p_from date, p_to date)
returns table (
  day        date,
  opens      bigint,
  pharmacy   bigint,
  complaint  bigint,
  info       bigint,
  etc        bigint
)
language sql
stable
as $$
  select
    (created_at at time zone 'Asia/Seoul')::date as day,
    count(*) filter (where event_type = 'widget_open')                        as opens,
    count(*) filter (where event_type = 'branch' and branch = 'pharmacy')     as pharmacy,
    count(*) filter (where event_type = 'branch' and branch = 'complaint')    as complaint,
    count(*) filter (where event_type = 'branch' and branch = 'info')         as info,
    count(*) filter (where event_type = 'branch' and branch = 'etc')          as etc
  from usage_events
  where (created_at at time zone 'Asia/Seoul')::date between p_from and p_to
  group by 1
  order by 1;
$$;

/** 많이 고른 제품 */
create or replace function stats_top_products(p_from date, p_to date, p_limit int default 20)
returns table (
  product_id bigint,
  name       text,
  picks      bigint
)
language sql
stable
as $$
  select e.product_id, p.name, count(*) as picks
  from usage_events e
  join products p on p.id = e.product_id
  where e.event_type = 'product_select'
    and (e.created_at at time zone 'Asia/Seoul')::date between p_from and p_to
  group by e.product_id, p.name
  order by picks desc, p.name
  limit p_limit;
$$;

/** 0건으로 끝난 검색어. 별칭을 무엇으로 넣어야 할지 알려준다 */
create or replace function stats_failed_queries(p_from date, p_to date, p_limit int default 30)
returns table (
  query   text,
  tries   bigint,
  last_at timestamptz
)
language sql
stable
as $$
  select e.query, count(*) as tries, max(e.created_at) as last_at
  from usage_events e
  where e.event_type = 'product_search'
    and e.query is not null
    and (e.created_at at time zone 'Asia/Seoul')::date between p_from and p_to
  group by e.query
  order by tries desc, last_at desc
  limit p_limit;
$$;

/** 취급처 검색 결과: 제품별 검색 수와 '가까운 곳 없음' 비율 */
create or replace function stats_pharmacy_search(p_from date, p_to date)
returns table (
  product_id bigint,
  name       text,
  searches   bigint,
  empty      bigint
)
language sql
stable
as $$
  select e.product_id, p.name,
         count(*) as searches,
         count(*) filter (where e.result_count = 0) as empty
  from usage_events e
  join products p on p.id = e.product_id
  where e.event_type = 'pharmacy_search'
    and (e.created_at at time zone 'Asia/Seoul')::date between p_from and p_to
  group by e.product_id, p.name
  order by searches desc, p.name;
$$;

/** 취급처를 못 찾은 지역 (주소로 검색한 건만 집계된다) */
create or replace function stats_empty_regions(p_from date, p_to date, p_limit int default 20)
returns table (
  sido     text,
  searches bigint,
  empty    bigint
)
language sql
stable
as $$
  select e.sido,
         count(*) as searches,
         count(*) filter (where e.result_count = 0) as empty
  from usage_events e
  where e.event_type = 'pharmacy_search'
    and e.sido is not null
    and (e.created_at at time zone 'Asia/Seoul')::date between p_from and p_to
  group by e.sido
  order by empty desc, searches desc
  limit p_limit;
$$;

grant execute on function stats_daily(date, date)                       to authenticated;
grant execute on function stats_top_products(date, date, int)           to authenticated;
grant execute on function stats_failed_queries(date, date, int)         to authenticated;
grant execute on function stats_pharmacy_search(date, date)             to authenticated;
grant execute on function stats_empty_regions(date, date, int)          to authenticated;
