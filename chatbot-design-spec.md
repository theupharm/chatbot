# 더유제약 챗봇 리뉴얼 — 시스템 설계 문서

> 이 문서는 Claude Code로 개발을 진행하기 위한 스펙입니다.
> 프로젝트 루트에 `CLAUDE.md` 또는 `docs/SPEC.md`로 두고 참조하세요.
>
> **v1.1 (2026-08-12)** — 스키마 누락 항목 보완(카테고리·처리상태·감사컬럼·인덱스), 상태 머신 위치 확정,
> 레이트리밋·CORS·지오코딩 쿼터·개인정보 보관기간 정책 추가, Phase 0(데이터 실사) 신설.
>
> **v1.2 (2026-08-12)** — 기존 스프레드시트 구조 확인 반영. §4-1 원본→스키마 매핑 신설,
> `pharmacies.name_norm`/`org_type` 추가, 원본 좌표 활용으로 이관 지오코딩 부담 제거,
> 취급처 유형(약국 외 의원·피부과 포함) 이슈 제기.
>
> **v1.3 (2026-08-12)** — 취급처 유형 노출 방식 (c) 확정(유형 배지 병기). §5-1 매칭 티어 구체화
> (초성 검색 추가, 인메모리 인덱스 방식 채택).
>
> **v1.4 (2026-08-12)** — 취급처 결과 카드에 카카오맵 길찾기·지도보기 링크 추가 (§5-2).

---

## 1. 프로젝트 개요

### 목적
Botpress + 구글스프레드시트 기반 챗봇을 자체 개발 시스템으로 전환한다.

### 핵심 원칙
1. **AI 자유응답 금지.** 제약회사 특성상 의약품 관련 질문에 생성형 AI가 답변하면 안 된다. 모든 응답은 사전 정의된 시나리오(상태 머신)와 DB 데이터에서만 나온다.
2. **오타 허용.** 제품명·주소 입력에 오타나 띄어쓰기 차이가 있어도 동작해야 한다. (기존 시스템의 가장 큰 문제)
3. **운영 담당자는 비개발자.** 데이터는 DB에서 단일 관리하되, 담당자가 쓸 수 있는 웹 관리자 페이지를 함께 제공한다. 입력 시점에 검증(지오코딩, 필수값, 중복)을 수행해 잘못된 데이터가 애초에 들어가지 않게 한다. 구글스프레드시트는 사용하지 않으며, 기존 시트 데이터는 최초 1회 CSV 업로드로 이관한다.

### 범위 (기존 시나리오 유지)
- 약국찾기 / 제품불만 / 제품정보 / 기타 — 4개 분기
- 홈페이지에 임베드하는 웹 채팅 위젯

---

## 2. 기술 스택

| 영역 | 선택 | 이유 |
|---|---|---|
| 프론트엔드 위젯 | Preact + Vite (단일 JS 번들) | `<script>` 한 줄로 기존 홈페이지에 임베드. React보다 가벼움 |
| 백엔드 | Next.js (App Router, API Routes) on Vercel | 서버리스, 무료 티어로 시작 가능 |
| DB | Supabase (PostgreSQL) | 무료 티어, `pg_trgm` 확장으로 퍼지 검색 내장 지원 |
| 주소 → 좌표 | Kakao Local REST API | 한국 주소 처리 최강. "수원 영통" 같은 대충 입력도 처리 |
| 이메일 발송 | Resend (또는 사내 SMTP + Nodemailer) | 불만 접수 → 고객센터 메일 |
| 관리자 페이지 | Next.js `/admin` + Supabase Auth | 비개발자 담당자용 CRUD·CSV 업로드·불만 조회. 동기화 계층 불필요 |

---

## 3. 아키텍처

```
[홈페이지] ──임베드──> [챗봇 위젯 (Preact)]
                            │ HTTPS
                            ▼
                   [Next.js API (Vercel)]
                    │        │        │
                    ▼        ▼        ▼
              [Supabase]  [Kakao   [Resend
               PostgreSQL  Local    이메일]
               + pg_trgm]  API]
                    ▲
                    │ CRUD (저장 시 지오코딩·검증)
              [관리자 페이지 /admin]
               (운영 담당자, Supabase Auth 로그인)
```

### 상태 머신 위치 — 클라이언트 전이 (확정)

시나리오 상태 전이는 **위젯(클라이언트)에서 수행**하고, 서버 API는 **데이터 조회·접수 전용**이다.
서버는 대화 세션을 갖지 않는다(stateless).

| | 위젯 | 서버 |
|---|---|---|
| 담당 | 현재 스텝 보관, 버튼 선택에 따른 전이, 렌더링 | 제품 검색, 지오코딩, 약국 검색, 불만 접수 |
| 상태 | 메모리(탭 새로고침 시 초기화) | 없음 |

이유:
- Vercel 서버리스에는 지속 세션이 없어 서버 상태 머신은 별도 세션 스토어가 필요하다 (불필요한 복잡도)
- 전이마다 왕복이 사라져 버튼 응답이 즉시 반영된다
- **대화 내용이 서버에 남지 않아** 개인정보 최소화 원칙(§13)에 부합한다

시나리오 정의(`flow.ts`)는 위젯 번들에 포함된다. 시나리오를 바꾸려면 위젯을 재배포해야 하며,
운영 담당자가 시나리오 자체를 편집하는 기능은 이번 범위에 없다(제품·약국·불만 데이터만 관리자 페이지에서 관리).

- 데이터 원본은 Supabase 하나. 동기화 계층이 없으므로 관리자 페이지에서 저장하면 챗봇에 즉시 반영된다.

---

## 4. DB 스키마

```sql
-- 확장
create extension if not exists pg_trgm;

-- 제품
create table products (
  id            bigint generated always as identity primary key,
  name          text not null,              -- 표시용 정식 제품명
  name_norm     text not null,              -- 정규화: 공백/특수문자 제거, 소문자
  name_jamo     text not null,              -- 한글 자모 분해 (퍼지 검색용) 예: "베아제" → "ㅂㅔㅇㅏㅈㅔ"
  aliases       text[] default '{}',        -- 별칭, 흔한 오타 (예: {"배아제","베아재"})
  category      text,                        -- 제품 분류. 검색 0건 폴백 목록의 그룹 기준 (§5-1)
  info_url      text,                        -- 통합 정보 시스템 링크 (제품정보 분기에서 사용)
  is_active     boolean default true,
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz default now()
);
create unique index uq_products_name_norm on products (name_norm);                    -- 중복 등록 차단
create index idx_products_prefix on products (name_norm text_pattern_ops);            -- 전방일치 like 'q%'
create index idx_products_jamo_trgm on products using gin (name_jamo gin_trgm_ops);   -- 자모 유사도
create index idx_products_aliases on products using gin (aliases);                    -- q = any(aliases)
create index idx_products_category on products (category) where is_active;

-- 취급처 (약국·의원·피부과 등. 테이블명은 기존 명칭 유지)
create table pharmacies (
  id            bigint generated always as identity primary key,
  name          text not null,               -- 표시용 상호 (원본의 지역 접미사는 §4-1에서 제거)
  name_norm     text not null,               -- 정규화 상호 (중복 판정용)
  org_type      text not null default 'pharmacy'
                check (org_type in ('pharmacy','clinic','other')),  -- 원본에 의원·피부과·한의원 다수 포함
  address       text not null,               -- 원본 주소 전체 (도로명·지번 혼재)
  address_norm  text not null,               -- 정규화 주소 (중복 판정용)
  sido          text,                        -- 주소에서 파싱 + 표기 정규화 (강원도→강원, 충남→충남)
  sigungu       text,
  phone         text,
  lat           double precision not null,   -- 원본 좌표 또는 지오코딩 결과 (§9-2 검증을 DB에서도 강제)
  lng           double precision not null,
  is_active     boolean default true,
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz default now()
);
create unique index uq_pharmacies_name_addr on pharmacies (name_norm, address_norm);  -- 중복 등록 차단
create index idx_pharmacies_geo on pharmacies (lat, lng);
create index idx_pharmacies_region on pharmacies (sido, sigungu);                     -- 관리자 지역 필터
create index idx_pharmacies_type on pharmacies (org_type) where is_active;

-- 약국-취급제품 관계
create table pharmacy_products (
  pharmacy_id   bigint references pharmacies(id) on delete cascade,
  product_id    bigint references products(id) on delete cascade,
  primary key (pharmacy_id, product_id)
);
create index idx_pharmacy_products_product on pharmacy_products (product_id);         -- 제품→약국 역방향 조회

-- 지오코딩 캐시 (Kakao API 쿼터 절감. CSV 대량 이관 시 필수 — §9-3)
create table geocode_cache (
  q             text primary key,            -- 정규화된 질의 문자열
  lat           double precision not null,
  lng           double precision not null,
  road_address  text,
  hit_count     int default 0,
  created_at    timestamptz default now()
);

-- 불만 접수 (의료인)
create table complaints (
  id            bigint generated always as identity primary key,
  ticket_no     text not null unique,        -- 사용자 안내용 접수번호 (예: C-20260812-0007)
  org_name      text not null,               -- 상호명
  region        text not null,               -- 시/군/구
  content       text not null,               -- 불만 내용
  contact       text not null,               -- 연락처 (개인정보. §8 보관·파기 정책 대상)
  product_id    bigint references products(id),
  is_ae_suspect boolean default false,       -- 이상사례(부작용) 의심 키워드 감지 여부
  ae_keywords   text[] default '{}',         -- 감지된 키워드 (PV 검토 근거)
  consent_at    timestamptz not null,        -- 개인정보 수집·이용 동의 시각
  status        text not null default 'new'
                check (status in ('new','in_progress','done')),
  email_sent    boolean default false,
  email_error   text,                        -- 발송 실패 사유 (재발송 판단용)
  purged_at     timestamptz,                 -- 개인정보 파기 시각 (파기 시 contact/content 마스킹)
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz default now(),
  created_at    timestamptz default now()
);
create index idx_complaints_status on complaints (status, created_at desc);
create index idx_complaints_ae on complaints (created_at desc) where is_ae_suspect;
```

**공통 규칙**
- `updated_at`은 `before update` 트리거로 자동 갱신, `updated_by`는 API 계층에서 `auth.uid()`를 채운다
- `name_norm`/`name_jamo`/`address_norm`은 **서버가 저장 시 자동 생성**한다. 관리자 페이지에 노출하지 않으며 클라이언트 입력값을 신뢰하지 않는다
- 전방일치용 인덱스가 `text_pattern_ops`인 이유: 기본 collation의 btree 인덱스는 `like 'q%'`에 사용되지 않는다
- RLS: 모든 테이블 활성화. 익명 키는 `products`/`pharmacies`/`pharmacy_products`의 `is_active` 행에 대한 **select만** 허용. `complaints`는 익명 select 금지(insert는 서버 서비스 키 경유), 쓰기 전반은 인증된 관리자만

---

## 4-1. 기존 스프레드시트 → 스키마 매핑

기존 시트는 **(제품명 × 취급처) 롱 포맷**이다. 같은 약국이 제품 수만큼 반복 등장한다.

| 시트 컬럼 | 예시 | 이관 대상 |
|---|---|---|
| 제품명 | `닥터로반연고` | `products.name` (dedup 후 마스터 생성) |
| 약국명 | `100세약국(인천 남동구)` | `pharmacies.name` (괄호 지역 접미사 제거) |
| 주소 | `인천 남동구 남동대로 892` | `pharmacies.address` / `sido` / `sigungu` |
| 전화번호 | `032-427-7585` | `pharmacies.phone` |
| 위도 / 경도 | `37.4620832` / `126.7086607` | `pharmacies.lat` / `lng` |
| (행 자체) | | `pharmacy_products` 1건 |

### 이관 규칙

1. **좌표는 원본을 그대로 사용한다.** 시트에 이미 위경도가 있으므로 이관 시 Kakao 지오코딩을 호출하지 않는다.
   좌표가 비었거나 검증에 실패한 행만 지오코딩한다 → 이관 시 API 호출량이 사실상 0에 수렴
2. **좌표 검증**: 주소에서 파싱한 시/도의 대략적 경계 박스 안에 좌표가 들어오는지 확인. 벗어나면 실패 행으로 리포트 (원본 좌표를 무검증 신뢰하지 않는다)
3. **취급처 dedup**: `(name_norm, address_norm)` 기준. 같은 건물에 다른 상호가 있으므로(예: 화정로 47 — 다나온누리약국 / 동원텔약국) 주소 단독으로는 판정하지 않는다
4. **상호 정규화(`name_norm`)**: 괄호 지역 접미사 제거 → 공백·특수문자 제거 → lower.
   `100세약국(인천 남동구)` → `100세약국`
5. **주소 정규화(`address_norm`)**: 공백·특수문자 통일, 층·호·상호 꼬리 제거 시도.
   `인천 미추홀구 소성로 150 고일약국` → `인천미추홀구소성로150`
   지번(`구로구 오류동 55-50`)과 도로명이 혼재하므로 완벽한 정규화는 기대하지 않는다. **정규화는 중복 판정 보조 수단일 뿐**이고, 최종 판단은 관리자 페이지의 중복 경고로 사람이 한다
6. **시/도 표기 정규화**: `강원도`→`강원`, `충남`/`충청남도`→`충남` 등 매핑 테이블로 통일
7. **기관 유형 자동 분류**: 상호 접미사로 1차 추정 — `약국`→`pharmacy`, `의원`/`피부과`/`성형외과`/`한의원`→`clinic`, 그 외 `other`.
   추정 결과는 이관 리포트에 유형별 건수로 표시하고, 관리자 페이지에서 수정 가능하게 한다

---

## 5. 검색/매칭 로직 (핵심)

### 5-1. 제품명 자동완성 + 퍼지 검색
사용자가 입력하는 즉시(디바운스 300ms) 후보를 보여준다. 매칭 우선순위:

1. **정규화 후 전방일치**: 입력을 정규화(`공백·특수문자 제거, lower`)해서 `name_norm like q || '%'`
2. **별칭 일치**: `q = any(aliases)` 또는 별칭 전방일치
3. **자모 trigram 유사도**: 입력을 자모 분해 후 `similarity(name_jamo, q_jamo) > 0.35`, 유사도 내림차순
   - "배아제" 입력 → 자모 유사도로 "베아제" 매칭됨

한글 자모 분해는 유틸 함수로 구현 (초성/중성/종성 분리). 라이브러리: `es-hangul` 또는 직접 구현 (유니코드 0xAC00 기반, 30줄 내외).

**결과가 하나도 없으면**: "제품을 찾지 못했어요. 아래에서 선택해주세요" + `products.category` 기준으로 묶은 전체 활성 제품 목록(`/api/products/catalog`)을 카테고리 → 제품 2단계 버튼으로 제공. 절대 빈 화면으로 끝내지 않는다.
`category`가 비어 있는 제품은 "기타" 그룹으로 묶는다.

### 5-2. 취급처 찾기 (좌표 → 거리 기반)

> ✅ **확정 (v1.3)** — 기존 데이터에는 약국뿐 아니라 의원·피부과·한의원·성형외과가 포함된다(§4-1).
> **모든 유형을 함께 노출하되 결과 카드에 유형 배지를 표시한다.**
> - 배지 문구: `org_type = 'pharmacy'` → **약국**, `'clinic'` → **의원**, `'other'` → 배지 없음
> - 거리순 정렬에 유형 가중치를 두지 않는다 (가까운 순 그대로)
> - 메뉴명은 "약국찾기"를 유지하되, 결과 안내 문구는 "가까운 취급처"로 표기한다

사용자 좌표를 얻는 경로는 두 가지이며, 이후 검색 로직은 동일하다.

**경로 A — 내 위치로 찾기 (기본 제안)**
1. 챗봇이 [📍 현재 위치로 찾기] / [주소로 찾기] 버튼을 함께 제시
2. "현재 위치"를 선택하면 브라우저 Geolocation API로 좌표 획득 (HTTPS 필수)
3. 권한 거부·실패 시 자연스럽게 주소 입력(경로 B)으로 안내. 에러 화면으로 끝내지 않는다

**경로 B — 주소로 찾기**
1. 사용자 입력 주소를 Kakao Local API `/v2/local/search/address` + `/v2/local/search/keyword`로 좌표 변환
   - "수원 영통", "영통구", "경기도 수원시 영통구 xx로 12" 모두 처리
   - 여러 후보가 나오면 사용자에게 선택지 제시 (최대 3개)

**공통 — 거리 검색**
좌표 기준 하버사인 거리 계산으로 해당 제품 취급 약국 중 가까운 순 5개 반환

**결과 카드 구성**
상호 · 유형 배지 · 거리 · 주소 · 전화번호 + 버튼 3개

| 버튼 | 동작 |
|---|---|
| 길찾기 | `https://map.kakao.com/link/to/{상호},{lat},{lng}` — 출발지는 카카오맵이 사용자 현재 위치로 잡는다 |
| 지도보기 | `https://map.kakao.com/link/map/{상호},{lat},{lng}` |
| 전화 | `tel:` |

카카오맵 **공개 URL 스킴**이라 API 키가 필요 없다. 모바일에서는 설치된 카카오맵 앱이 열리고,
없으면 웹 지도로 넘어간다. 위젯 안에 지도를 삽입하지 않는 이유: JS 키·도메인 등록이 필요한 데다
채팅창 폭(380px)에서는 지도가 너무 작고, 사용자가 실제로 원하는 것은 길찾기이기 때문이다.

```sql
-- 하버사인 근사 (반경 10km 내, 가까운 순 5개)
select p.name, p.address, p.phone, p.org_type,
  round((6371 * acos(
    cos(radians(:lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(:lng))
    + sin(radians(:lat)) * sin(radians(p.lat))
  ))::numeric, 1) as distance_km
from pharmacies p
join pharmacy_products pp on pp.pharmacy_id = p.id
where pp.product_id = :product_id and p.is_active
order by distance_km asc
limit 5;
```

10km 내 약국이 없으면: "가까운 취급 약국이 없습니다" + 고객센터 안내. (조용히 실패하지 않는다)

---

## 6. 챗봇 시나리오 (상태 머신)

시나리오는 코드 상의 선언적 정의(TS 객체)로 관리하며 **위젯 번들에 포함되어 클라이언트에서 전이한다**(§3). 자유 텍스트 입력은 **제품 검색·주소 입력·불만 양식** 3곳에만 허용하고 나머지는 모두 버튼이다.

```
START
 ├─ [약국찾기] → PRODUCT_SEARCH(autocomplete)
 │                → [📍 현재 위치로 찾기] → Geolocation 좌표 → 약국 5개 카드 출력
 │                → [주소로 찾기] → ADDRESS_INPUT → (후보 여러개면 선택) → 약국 5개 카드 출력
 │                  (위치 권한 거부 시 주소 입력으로 자동 전환) → START로 복귀 버튼
 ├─ [제품불만] → [일반소비자] → 홈페이지 게시판 링크 버튼 → 종료
 │             → [의료인]     → 양식: 상호명 → 시/군/구 → 관련제품(autocomplete, 선택) 
 │                              → 불만내용 → 연락처 → 개인정보 수집 동의 → 접수 완료 + 접수번호 안내
 ├─ [제품정보] → PRODUCT_SEARCH(autocomplete) → info_url 링크 버튼 출력
 └─ [기타]     → 고객센터 전화/이메일/운영시간 안내
```

시나리오 밖 자유 질문이 들어오면: "죄송합니다, 의약품 관련 문의는 정확한 안내를 위해 아래 메뉴를 이용해주세요" + 메인 메뉴 재표시. **어떤 경우에도 임의 답변을 생성하지 않는다.**

---

## 7. API 엔드포인트

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/products/search?q=` | 자동완성. §5-1 로직. 최대 8건 |
| GET | `/api/products/catalog` | 카테고리별 활성 제품 전체 목록. 검색 0건 폴백용. `Cache-Control: s-maxage=300` |
| GET | `/api/products/:id` | 제품 상세 (info_url 포함) |
| GET | `/api/geocode?q=` | Kakao 프록시. 주소 후보 최대 3건 반환 (API 키는 서버에만 둠). `geocode_cache` 우선 조회 |
| GET | `/api/pharmacies/search?product_id=&lat=&lng=` | 거리순 5건 |
| POST | `/api/complaints` | 불만 접수 → DB 저장 → 이메일 발송 → `ticket_no` 반환 |
| CRUD | `/api/admin/products`, `/api/admin/pharmacies` | 관리자 전용. Supabase Auth 세션 필수 |
| POST | `/api/admin/import` | CSV **청크(최대 200행)** 업로드 → 검증·지오코딩·upsert → 청크별 리포트 반환 |
| GET | `/api/admin/complaints` | 불만 접수 내역 조회 (관리자 전용) |
| PATCH | `/api/admin/complaints/:id` | 처리 상태 변경, 메일 재발송 |

### 공통 규약

- **검증**: 모든 입력은 Zod. 길이 제한 — 검색어 40자, 주소 100자, 상호명 60자, 불만내용 2000자, 연락처 40자
- **레이트리밋**: IP당 분당 30회 (`/api/complaints`는 분당 3회). **Upstash Redis**(`@upstash/ratelimit`) 사용 — Vercel 서버리스는 인스턴스마다 메모리가 분리되므로 인메모리 카운터는 동작하지 않는다
- **CORS**: `ALLOWED_ORIGINS` 환경변수의 허용 목록만 통과. 와일드카드(`*`) 금지. `/api/admin/*`는 CORS 미허용(동일 출처 전용)
- **인증**: `/api/admin/*`는 미들웨어에서 Supabase Auth 세션 검증. 서비스 키는 서버 코드에서만 사용
- **에러 응답**: `{ error: { code, message } }` 통일. `message`는 사용자에게 그대로 보여줄 수 있는 한국어 문구로만 채우고, 내부 예외 정보는 담지 않는다

---

## 8. 불만 접수 상세

1. `complaints` 테이블에 저장 (메일 실패해도 데이터는 남도록 저장 먼저). 저장 시 `ticket_no` 생성 — 형식 `C-YYYYMMDD-NNNN`(당일 일련번호). 내부 `id`를 그대로 노출하지 않는다
2. 고객센터 메일 발송 (Resend). 제목: `[챗봇 불만접수 {ticket_no}] {상호명} - {제품명}`
   - 발송 실패 시 `email_sent = false` + `email_error` 기록 → 관리자 페이지에서 재발송 (§9-4). 실패해도 사용자에게는 접수 완료로 안내한다
3. **이상사례(AE) 감지**: 불만 내용에 부작용 의심 키워드(예: 부작용, 이상반응, 구토, 발진, 어지러움, 입원 등 — PV팀과 키워드 목록 협의)가 포함되면 `is_ae_suspect = true` + 감지 키워드를 `ae_keywords`에 기록하고 **PV(약물감시) 담당 메일로도 함께 발송**. 제약회사는 이상사례 보고 의무가 있으므로 이 라우팅이 중요하다.
   - 키워드 목록은 `lib/ae-keywords.ts`에 상수로 관리하고 변경 이력을 남긴다. 판정은 **넓게(오탐 허용)** — 누락이 오탐보다 위험하다
4. 접수 완료 시 `ticket_no`를 사용자에게 안내
5. 연락처 수집 전 개인정보 수집·이용 동의 체크 필수. 동의 시각을 `consent_at`에 기록한다

### 개인정보 보관·파기 정책 ⚠️ 법무·RA 확인 필요

아래는 **구현 기본값(제안)**이며, 착수 전 법무·RA 확정이 필요하다. 확정 전에는 파기 배치를 켜지 않는다.

| 구분 | 보관기간(제안) | 파기 방식 |
|---|---|---|
| 일반 불만 (`is_ae_suspect = false`) | 처리 완료 후 3년 | `contact` 삭제, `content` 마스킹, `purged_at` 기록. 통계용 행은 남긴다 |
| AE 의심 건 (`is_ae_suspect = true`) | 약물감시 관련 규정에 따름 (일반건보다 장기) | 자동 파기 대상에서 **제외**. PV팀 판단으로만 처리 |

- 파기는 일 1회 배치(Vercel Cron)로 수행하고 실행 결과를 로그로 남긴다
- 동의 문구, 보관기간 고지 문구, 개인정보 처리방침 링크는 법무 확정본을 그대로 사용한다

---

## 9. 관리자 페이지 (`/admin`)

비개발자 운영 담당자가 사용하는 유일한 데이터 관리 화면. Supabase Auth(이메일+비밀번호) 로그인 필수.

### 메뉴 구성
1. **제품 관리** — 목록(검색·정렬), 등록/수정/비활성화. 별칭(aliases)·카테고리·info_url 편집 가능. `name_norm`, `name_jamo`는 저장 시 서버가 자동 생성 (담당자에게 노출하지 않음)
2. **약국 관리** — 목록(지역 필터), 등록/수정/비활성화, 약국별 취급 제품 체크박스 지정
   - **저장 시 즉시 지오코딩**: 주소 입력 → Kakao API 호출 → 좌표 변환 성공 시 지도 미리보기로 위치 확인, 실패 시 "주소를 확인해주세요" 에러로 저장 차단. 잘못된 주소가 DB에 들어갈 수 없다 (`lat`/`lng` NOT NULL로 DB에서도 강제)
   - 이름+정규화 주소가 같은 약국이 이미 있으면 저장 전 중복 경고
3. **CSV 일괄 업로드** — 기존 스프레드시트 데이터의 최초 이관 및 대량 갱신용
   - 템플릿 CSV 다운로드 제공 (기존 시트 컬럼 구조에 맞춤)
   - **좌표 컬럼을 받는다**: 기존 시트에 위경도가 이미 있으므로 템플릿에 `위도`/`경도` 컬럼을 포함하고, 값이 있으면 그대로 사용한다 (§4-1). 좌표가 있는 행은 Kakao 호출이 발생하지 않는다
   - **청크 업로드**: 브라우저에서 200행 단위로 잘라 순차 전송하고 진행률을 표시한다. Vercel 함수 실행시간 제한(무료 티어 기준 수십 초) 안에 수천 행을 단일 요청으로 처리할 수 없다
   - 좌표가 빈 행만 지오코딩한다. `geocode_cache` 우선 조회 → 미스만 Kakao 호출, **동시 5건 이하 스로틀링** + 429 시 지수 백오프
   - 행별 검증·지오코딩 → 결과 리포트 화면 (성공 n건 / 실패 n건 + 실패 사유·행 번호)
   - 실패 행만 모아 CSV로 다시 다운로드 → 수정 후 재업로드하는 흐름
   - 재업로드가 중복을 만들지 않도록 upsert 기준을 명시한다 — 제품은 `name_norm`, 약국은 `(name, address_norm)`
4. **불만 접수 내역** — 접수 목록 조회, AE 의심 건 필터, 처리 상태(신규/처리중/완료) 변경, 메일 재발송 버튼
   - 목록에는 연락처를 마스킹해 표시하고, 상세 화면에서만 전체 노출한다

### 구현 노트
- UI는 단순한 테이블 + 폼이면 충분. shadcn/ui 또는 기본 컴포넌트 사용
- 관리자 페이지는 챗봇 위젯과 같은 Next.js 앱 안에 두되 라우트만 분리 (`/admin/*`)
- Supabase RLS(Row Level Security): 익명 키는 읽기 전용 최소 권한, 쓰기는 인증된 관리자만
- 감사(audit): 데이터 변경 시 변경자·변경 시각 기록 (`updated_by`, `updated_at` — §4 공통 규칙)

---

## 10. 위젯 임베드

```html
<script src="https://chatbot.theu-pharma.co.kr/widget.js" async></script>
```

- 우하단 플로팅 버튼 → 클릭 시 채팅창 (기존 UI 톤: 그린 계열 유지)
- 모바일 대응 (전체화면 모드)
- 번들 크기 목표: gzip 50KB 이하

### 임베드 방식 — iframe 아닌 Shadow DOM (확정)

위젯은 부모 페이지에 DOM을 직접 주입하되 **Shadow DOM**으로 감싼다.

- **CSS 격리**: 기존 홈페이지 스타일과 상호 간섭이 없다 (iframe 없이도 해결)
- **Geolocation**: 부모 페이지 origin의 권한으로 동작한다. iframe이었다면 홈페이지 쪽에 `allow="geolocation"`을 넣어달라고 요청해야 하고, 그게 누락되면 §5-2 경로 A가 통째로 실패한다
- 단, 홈페이지가 **HTTPS**여야 Geolocation이 동작한다. 배포 전 확인 필요

API 호출은 챗봇 도메인으로 나가므로 홈페이지 origin을 `ALLOWED_ORIGINS`에 등록해야 한다 (§7 공통 규약).

---

## 11. 프로젝트 구조

```
theu-chatbot/
├── CLAUDE.md                  # 이 문서
├── apps/
│   ├── web/                   # Next.js (API + 위젯 호스팅 + 관리자)
│   │   ├── app/api/...        # §7 엔드포인트
│   │   ├── app/admin/...      # §9 관리자 페이지 (제품/약국/CSV/불만)
│   │   ├── middleware.ts      # /api/admin/* 인증, CORS, 레이트리밋
│   │   └── lib/
│   │       ├── hangul.ts      # 자모 분해 유틸
│   │       ├── search.ts      # 퍼지 검색 로직
│   │       ├── geocode.ts     # Kakao 래퍼 (geocode_cache 경유, 스로틀링)
│   │       ├── csv-import.ts  # CSV 파싱·검증·리포트
│   │       ├── ae-keywords.ts # AE 의심 키워드 목록 (§8-3)
│   │       └── mail.ts        # Resend 래퍼
│   └── widget/                # Preact 위젯 (Vite 빌드 → widget.js)
│       └── src/
│           ├── scenario/flow.ts  # 시나리오 상태 머신 정의 (클라이언트 전이 — §3)
│           └── api.ts            # 서버 데이터 조회 클라이언트
└── supabase/migrations/       # §4 스키마
```

**환경변수**

| 변수 | 용도 |
|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | 공개 읽기 (RLS 적용) |
| `SUPABASE_SERVICE_KEY` | 서버 전용 쓰기. 클라이언트 번들 유입 금지 |
| `KAKAO_REST_KEY` | 지오코딩. 서버 전용 |
| `RESEND_API_KEY` | 메일 발송 |
| `COMPLAINT_MAIL_TO` / `PV_MAIL_TO` | 고객센터 / 약물감시 수신 주소 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 레이트리밋 (§7) |
| `ALLOWED_ORIGINS` | CORS 허용 origin 목록 (쉼표 구분) |

`NEXT_PUBLIC_` 접두사는 어떤 비밀값에도 붙이지 않는다.

---

## 12. 개발 단계 (Claude Code 작업 순서)

### Phase 0 — 데이터 실사 · 사전 확정 (코드 작성 전)

개발이 아니라 확인 작업이다. 여기서 나오는 결과에 따라 이후 단계의 전제가 바뀐다.

1. ~~**기존 스프레드시트 실물 확보**~~ ✅ **해결** — 컬럼 구조 확인 완료 (제품명·약국명·주소·전화번호·위도·경도). §4-1에 매핑 정리
2. ~~**약국별 취급제품 매핑 존재 여부**~~ ✅ **해결** — 롱 포맷으로 존재. `pharmacy_products` 도출 가능
3. ~~**Kakao 로컬 API 쿼터**~~ ✅ **해결** — 원본에 좌표가 있어 이관 시 지오코딩 호출이 사실상 불필요. 신규 등록 건에만 사용
4. **취급처 유형 처리 방침 확정** ⚠️ **신규 이슈** — 데이터에 의원·피부과·한의원 포함. §5-2의 (a)/(b)/(c) 중 선택
5. **원본 시트 전량 확보** — 전체 행 수, 제품 종류 수, 제품별 취급처 편차 파악 (현재는 화면 일부만 확인)
6. **제품 마스터 정보 확보** — 시트에는 제품명만 있다. 정식 표기·카테고리·`info_url`·흔한 오타 별칭 필요 (§5-1)
7. **AE 의심 키워드 목록 PV팀 협의** (§8-3)
8. **개인정보 동의 문구·보관기간 법무 확인** (§8 보관·파기 정책)
9. **고객센터 정보 확정** — 전화·이메일·운영시간(§6 [기타] 분기), 불만 접수 수신 메일, PV 수신 메일
10. **일반소비자 불만 게시판 URL 확보** (§6)
11. **홈페이지 HTTPS 여부 및 임베드 가능 위치 확인** (§10)

**완료 기준**: 위 항목 모두 문서화. 특히 4·6번이 확정되어야 Phase 1(제품 검색)과 Phase 2(취급처 찾기)를 완료 기준까지 검증할 수 있다

### Phase 1 — 데이터 계층 (검증 가능한 최소 단위)
- Supabase 스키마 마이그레이션 (RLS 정책 포함)
- 자모 분해 유틸 + 단위 테스트 ("배아제"→"베아제" 매칭 케이스 포함)
- `/api/products/search`, `/api/products/catalog` 구현 + 테스트
- **완료 기준**: 오타 3종 케이스에서 올바른 제품이 1순위로 반환, 0건 입력 시 카테고리 폴백 목록 반환

### Phase 2 — 약국찾기
- Kakao 지오코딩 프록시 + 거리 검색 API + 브라우저 Geolocation 연동
- **완료 기준**: ① "수원 영통" 입력 → 좌표 변환 → 거리순 5개 반환 ② 현재 위치 버튼 → 좌표 획득 → 거리순 5개 반환 ③ 위치 권한 거부 시 주소 입력으로 전환

### Phase 3 — 시나리오 엔진 + 위젯
- 상태 머신 정의 + 위젯 UI (4개 분기 전체)
- **완료 기준**: 4개 분기 전부 버튼만으로 끝까지 진행 가능

### Phase 4 — 불만 접수 + 메일
- 접수 API, Resend 연동, AE 키워드 라우팅, `ticket_no` 발번
- **완료 기준**: 접수 → DB 저장 → 메일 수신 확인, AE 키워드 시 PV 메일 동시 수신, 메일 발송 실패해도 접수 데이터가 남고 재발송 가능

### Phase 5 — 관리자 페이지
- Supabase Auth 로그인, 제품/약국 CRUD(저장 시 지오코딩 검증), 불만 접수 조회
- **완료 기준**: 관리자 페이지에서 약국 1건 등록 → 챗봇 약국찾기 결과에 즉시 반영, 잘못된 주소는 저장 자체가 차단됨

### Phase 6 — 데이터 이관 + 배포
- CSV 청크 업로드 기능(검증·지오코딩 스로틀링·실패 리포트), 기존 스프레드시트 데이터 전량 이관, Vercel 배포, 기존 홈페이지 임베드
- 개인정보 파기 배치(Vercel Cron) — 법무 확정 후에만 활성화
- **완료 기준**: 기존 시트의 약국·제품 데이터가 전부 이관되고 실패 건은 리포트로 확인 가능, 동일 CSV 재업로드 시 중복이 생기지 않음, 운영 도메인에서 챗봇 4개 분기 정상 동작

---

## 13. 주의사항 (Claude Code에게)

- 생성형 AI 응답 기능을 절대 추가하지 말 것. 모든 텍스트는 시나리오 정의 또는 DB에서만 나온다.
- Kakao API 키·Supabase 서비스 키는 서버 환경변수로만 사용, 클라이언트 노출 금지 (`NEXT_PUBLIC_` 금지)
- 불만 접수 데이터는 개인정보이므로 로그에 연락처·내용을 남기지 말 것. 에러 로그에도 요청 바디를 통째로 찍지 말 것
- 사용자 위치 좌표는 약국 검색 요청에만 사용하고 서버에 저장하지 말 것 (위치정보는 검색 즉시 폐기, 액세스 로그에도 남기지 않음)
- 대화 내용은 서버에 저장하지 않는다 (§3 클라이언트 상태 머신)
- 모든 사용자 입력은 Zod 검증 + 길이 제한 (§7 공통 규약)
- `name_norm`/`name_jamo`/`address_norm`은 항상 서버에서 재계산할 것. 클라이언트가 보낸 값을 그대로 저장하지 말 것
- 검색 결과 0건 상황에서 항상 대안 경로(카테고리 전체 목록, 고객센터 안내)를 제공할 것
- 지오코딩은 반드시 `geocode_cache`를 먼저 조회할 것. 같은 주소로 Kakao API를 반복 호출하지 말 것
- 마이그레이션은 `supabase/migrations/`에 순번 파일로만 추가하고, 이미 적용된 파일은 수정하지 말 것
