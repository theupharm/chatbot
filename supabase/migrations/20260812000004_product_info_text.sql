-- 제품 안내 문구 저장 (설계문서 §6 [제품정보] 분기, §13)
--
-- 원본 제품정보 파일은 URL 하나가 아니라 **사전 작성된 답변 전문**이다.
-- 생성형 AI 없이 이 텍스트를 그대로 출력하는 것이 [제품정보] 분기의 동작이므로
-- 본문을 DB 에 보관한다.
--
-- info_text  : 답변 본문 (링크 줄은 빼고 저장. 줄바꿈 유지)
-- info_links : 링크 버튼 목록 [{"label": "의약품상세정보", "url": "https://..."}]
--              기존 info_url 은 첫 번째 링크를 그대로 담아 하위 호환을 유지한다.

alter table products add column if not exists info_text  text;
alter table products add column if not exists info_links jsonb not null default '[]'::jsonb;

comment on column products.info_text is
  '[제품정보] 분기에서 그대로 출력할 안내 문구. 생성형 AI 응답 금지 원칙(§13)에 따라 사전 작성된 텍스트만 사용한다';
comment on column products.info_links is
  '안내 문구에 딸린 링크 버튼 목록. [{"label": string, "url": string}]';

-- 취급처 매핑이 있는 제품 id 만 추린 뷰.
--
-- [약국찾기] 분기는 취급처가 등록된 제품만 대상으로 해야 한다. 전체 제품(89종) 중
-- 취급처 매핑이 있는 것은 8종뿐이라, 필터가 없으면 "취급처 0곳" 막다른 길이 생긴다.
--
-- pharmacy_products 를 클라이언트가 직접 읽으면 5천 건이 넘어 PostgREST 기본 상한(1000)에
-- 걸리므로 DB 에서 distinct 를 끝낸다.
-- security_invoker: 호출자의 RLS 를 그대로 적용한다 (뷰가 권한 우회 통로가 되지 않게).
create or replace view products_with_pharmacy
  with (security_invoker = true)
  as select distinct product_id from pharmacy_products;

grant select on products_with_pharmacy to anon, authenticated;
