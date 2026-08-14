# 더유제약 챗봇 — 개발 가이드

설계 스펙은 [chatbot-design-spec.md](chatbot-design-spec.md) 에 있다. 이 파일은 그 위에서
실제로 코드를 만질 때 필요한 것만 정리한다. 스펙과 충돌하면 **스펙이 우선**이고,
스펙을 바꿔야 한다면 스펙 파일을 먼저 고치고 개정 이력을 남긴다.

## 절대 규칙

1. **생성형 AI 응답 기능을 추가하지 않는다.** 모든 문구는 시나리오 정의 또는 DB에서만 나온다.
   제약회사 특성상 의약품 관련 자유 응답은 금지다.
2. **비밀값을 클라이언트로 내보내지 않는다.** `SUPABASE_SERVICE_KEY`, `KAKAO_REST_KEY` 는
   서버 전용. `NEXT_PUBLIC_` 접두사를 어떤 비밀값에도 붙이지 않는다.
3. **개인정보를 로그에 남기지 않는다.** 불만 접수의 연락처·내용, 사용자 위치 좌표.
   에러 로그에 요청 바디를 통째로 찍지 않는다.
4. **파생 필드는 항상 서버에서 재계산한다.** `name_norm` / `name_jamo` / `name_chosung` /
   `address_norm` 은 `deriveProductFields()` 같은 서버 로직으로만 만든다.
   클라이언트가 보낸 값을 그대로 저장하지 않는다.
5. **0건으로 끝내지 않는다.** 검색 결과가 없으면 항상 대안(카테고리 전체 목록, 고객센터 안내)을
   함께 내려준다.
6. **적용된 마이그레이션은 수정하지 않는다.** 변경은 `supabase/migrations/` 에 새 순번 파일로.

## 명령어

```bash
npm install
```

```bash
npm run test --workspace @theu/web
```

```bash
npm run typecheck --workspace @theu/web
```

```bash
npm run build --workspace @theu/web
```

```bash
npm run dev --workspace @theu/web
```

제품 시드 (DB 반영 전에 `--dry-run` 으로 먼저 확인):

```bash
npm run seed:products --workspace @theu/web -- fixtures/products.sample.json --dry-run
```

### DB

Supabase CLI 는 devDependency 로 설치돼 있다. 마이그레이션은
`supabase/migrations/` 에 `YYYYMMDDHHmmss_이름.sql` 형식으로만 추가한다.

```bash
npm run db:login
```

```bash
npm run db:link -- --project-ref <프로젝트-ref>
```

```bash
npm run db:push
```

연결·스키마·RLS 점검 (`.env.local` 을 채운 뒤 실행):

```bash
npm run check:db --workspace @theu/web
```

### 관리자 계정

인증(로그인했나)과 인가(관리자인가)를 분리했다. Supabase Auth 로그인만으로는 아무것도 못 보고,
`admin_users` 테이블에 등록된 계정만 통과한다. 프로젝트에 회원가입이 열려 있어도 관리자
페이지가 뚫리지 않게 하기 위함이다.

계정 자체는 Supabase 대시보드 > Authentication > Users 에서 만든다(비밀번호를 코드가 다루지
않는다). 그 뒤 권한을 준다:

```bash
npm run admin:grant --workspace @theu/web -- 이메일주소
```

```bash
npm run admin:list --workspace @theu/web
```

해제는 `-- 이메일주소 --revoke`.

### 메일

Nodemailer + SMTP 다. 접수 내용에 환자 이상사례 정보와 의료인 연락처가 들어가므로
**데이터가 국내에 머무는 경로만 쓴다.** 해외 메일 API 를 거치면 개인정보 국외이전에 해당해
별도 고지·동의가 필요해진다.

| 환경 | 경로 | 이유 |
|---|---|---|
| 로컬 개발 | 다우오피스 `gw.theu.co.kr:465` | 사무실 IP 가 허용목록에 있음 |
| 운영(Vercel) | NHN Cloud Email `smtp-mail.nhncloudservice.com:465` | AppKey 인증이라 IP 제한이 없음.<br>다우오피스는 IP 허용목록 방식이라 Vercel 발신 IP 가 거부됨 |

`.env.local` 에 SMTP 설정을 두 벌 두지 말 것. 로더는 **먼저 나온 값**을 쓰므로 아래에 새로
추가해도 위쪽 값이 이긴다.

코드는 같다. 환경변수만 다르다. 실패 사례와 SES 설정 절차는 [DEPLOY.md](DEPLOY.md) §4-1, §5 참고.

연결·인증만 확인:

```bash
npm run check:mail --workspace @theu/web
```

실제 테스트 발송 (`--ae` 를 붙이면 이상사례 의심 건으로 보내 PV 라우팅까지 확인):

```bash
npm run check:mail --workspace @theu/web -- --send --ae
```

## 구조

```
apps/web/               Next.js — API + 관리자 페이지(Phase 5)
  app/api/products/     제품 검색·카탈로그·상세
  lib/hangul.ts         자모 분해·초성 추출
  lib/normalize.ts      문자열 정규화
  lib/similarity.ts     트라이그램 유사도 (pg_trgm 과 같은 계산식)
  lib/search.ts         매칭·랭킹·카탈로그
  lib/products-cache.ts 활성 제품 인메모리 캐시
  lib/http.ts           CORS·에러 응답 공통
  lib/ratelimit.ts      Upstash 기반 레이트리밋
  scripts/              운영 스크립트
supabase/migrations/    DB 스키마
apps/widget/            Preact 위젯 → apps/web/public/widget.js
  src/main.ts           Shadow DOM 마운트
  src/App.tsx           상태 머신 구동·메시지 렌더링
  src/scenario/flow.ts  시나리오 정의 (챗봇이 말할 수 있는 문구 전부)
  src/api.ts            서버 호출
  src/components/       제품검색·주소입력·불만양식
config/site.json        고객센터·게시판 URL·동의 문구 (서버·위젯 공용)
```

## 이용 통계

챗봇은 대화를 저장하지 않는다(§3). 통계를 내려면 이벤트를 남겨야 하므로
**무엇을 남기지 않을지**를 먼저 정하고 만들었다.

| | 항목 |
|---|---|
| 남긴다 | 위젯 열림, 분기 선택, 제품 선택, 취급처 검색 결과 수, 접수 완료 |
| 남긴다 | **0건으로 끝난 검색어만** (별칭 보강용) |
| 남기지 않는다 | 사용자 위치 좌표 — 테이블에 컬럼 자체가 없다 |
| 남기지 않는다 | IP·브라우저 정보, 대화 전문, 결과가 나온 검색어 |

세션 ID 는 대화마다 새로 만들고 브라우저에 저장하지 않는다. 재방문을 이어붙일 수 없으므로
"몇 명"이 아니라 **"몇 번의 대화"** 를 센다. 이 설계 덕분에 동의 문구를 건드리지 않아도 된다.

지역은 **주소로 검색한 건만** 시/도 단위로 남는다. 현재 위치로 찾은 건은 좌표에서 유도한
값이라 남기지 않는다.

집계는 DB 함수(`stats_*`)가 한다. 원시 이벤트를 브라우저로 내려보내지 않는다.
이벤트는 파기 배치가 2년 뒤 지운다.

## 위젯

```bash
npm run dev --workspace @theu/widget
```

`http://localhost:5173` 에 개발용 페이지가 뜬다. 이 페이지의 `button` 스타일을 일부러
요란하게 해두었으니, 위젯 버튼이 멀쩡하면 Shadow DOM 격리가 살아 있는 것이다.
API 는 `http://localhost:3000` 을 쓰므로 web 도 같이 띄워야 한다.

```bash
npm run build --workspace @theu/widget
```

빌드 결과는 `apps/web/public/widget.js` 로 떨어지고 Next.js 가 `/widget.js` 로 서빙한다.
번들 목표는 gzip 50KB 이하 (현재 13.4KB).

- **시나리오 문구는 `src/scenario/flow.ts` 에만 둔다.** 컴포넌트에서 문장을 만들지 말 것.
  제품 안내문·취급처 정보는 DB 에서 오고, 그 외 문구는 flow.ts 에 있는 것만 쓴다 (§13).
- 자유 입력은 제품검색·주소입력·불만양식 세 곳뿐이다. 나머지는 전부 버튼이다.
- 대화 내용은 메모리에만 있다. 서버로 보내지 않는다.

## 검색 구현 메모

제품 검색은 스펙의 pg_trgm DB 검색 대신 **활성 제품 전체를 메모리에 올려두고 TS 로 매칭**한다.
제품이 수십~수백 건 규모라 이쪽이 빠르고, DB 없이 단위 테스트로 완료 기준을 검증할 수 있다.
자세한 사유는 [lib/search.ts](apps/web/lib/search.ts) 상단 주석 참고.

유사도 계산식은 `pg_trgm.similarity()` 와 동일하게 맞춰 두었으므로, 제품 수가 수천 건을 넘어
DB 검색으로 옮기더라도 임계값(0.35)을 다시 튜닝할 필요가 없다.

매칭 우선순위 (높은 순): 완전일치 → 별칭 완전일치 → 전방일치 → 별칭 전방일치 →
부분일치 → 초성 → 자모 유사도.

## 테스트 규칙

- 검색·정규화 로직은 순수 함수로 두고 DB 없이 테스트한다.
- API 라우트 테스트는 `@/lib/products-cache` 와 `@/lib/ratelimit` 를 `vi.mock` 으로 대체한다.
- 오타 허용은 회귀가 잘 나는 영역이다. 새 오타 케이스를 발견하면
  [lib/search.test.ts](apps/web/lib/search.test.ts) 에 케이스를 추가한다.

## Supabase

프로젝트 ref: `qmwgrpfeqmspuxzpebcf` (Seoul)

초기 스키마는 대시보드 SQL Editor 에서 [supabase/apply-all.sql](supabase/apply-all.sql) 로 적용했다.
그래서 **CLI 의 마이그레이션 이력에는 적용 기록이 없다.** 앞으로 `supabase db push` 를 쓰려면
먼저 이력을 맞춰야 한다:

```bash
npx supabase migration repair --status applied 20260812000001 20260812000002
```

`apply-all.sql` 은 `supabase/migrations/` 를 합쳐 만든 파생 파일이다. 새 마이그레이션을 추가하면
다시 생성하거나, CLI 경로로 전환한다.

## 데이터 이관

원본 `취급처.xlsx` (5,483행) → CSV → 임포터 순으로 옮겼다. 원본과 CSV 는 개인정보는 아니지만
사업 데이터이므로 `data/raw/` 를 gitignore 에 두었다.

```bash
npm run import:pharmacies --workspace @theu/web -- ../../data/raw/pharmacies.csv --dry-run
```

`--dry-run` 은 DB 에 쓰지 않고 리포트만 낸다. `--no-geocode` 는 Kakao 호출을 막는다.
반려·경고는 `data/raw/import-report.csv` 에 원본 행 번호와 함께 남는다.

이관 결과: 제품 8 / 취급처 5,026 / 매핑 5,412, 반려 4건(주소·좌표를 끝내 확보 못 한 행).

제품 안내 문구(`제품정보.xlsx`)는 따로 넣는다. 예외 규칙은
[fixtures/product-info-rules.json](apps/web/fixtures/product-info-rules.json) 에 데이터로 둔다.

```bash
npm run import:product-info --workspace @theu/web -- ../../data/raw/product-info.csv --dry-run
```

### 제품이 두 갈래라는 점에 주의

| | 건수 | 용도 |
|---|---|---|
| 취급처 매핑이 있는 제품 | 8 | [약국찾기] 분기 |
| 안내 문구가 있는 제품 | 86 | [제품정보] 분기 |
| 전체 | 88 | |

겹치는 것은 6종뿐이다. **[약국찾기] 분기는 반드시 `?has_pharmacy=1` 을 붙여야 한다.**
안 붙이면 사용자가 취급처가 없는 제품을 고르고 "0곳" 막다른 길에 빠진다.
필터 근거는 `products_with_pharmacy` 뷰다.

안내 문구는 사전 승인된 텍스트다. **요약·재작성하지 말 것** (§13). 링크 줄만 버튼으로 분리한다.

## 현재 진행 상황

- **Phase 0 (데이터 실사)** — 취급처·제품 안내 문구·고객센터 정보·게시판 URL 확보 완료.
  **미확보**: 제품 카테고리(전부 "기타"로 묶임), 별칭, AE 키워드, 개인정보 동의 문구·보관기간
- **Phase 1 (데이터 계층)** — **완료**. 스키마·RLS·제품 API 실 DB 검증 완료
- **Phase 2 (취급처 찾기)** — **완료**. 지오코딩·거리검색 실 데이터 검증 완료
- **Phase 3 (시나리오 + 위젯)** — **완료**. 4개 분기 브라우저 검증 완료 (번들 13.4KB gzip)
- **Phase 4 (불만 접수 + 메일)** — **완료**. 다우오피스 SMTP(465/TLS) 실 발송 검증 완료.
  AE 감지·PV 라우팅 동작하나 키워드 목록은 PV 확정 전
- **Phase 5 (관리자 페이지)** — **완료**. 완료 기준(등록 즉시 반영·잘못된 주소 차단) 검증 완료.
  §9-2 의 지도 미리보기는 Kakao JS 키가 필요해 보류했고, 대신 저장 시 변환된 주소·좌표를 보여준다
- **Phase 6 (CSV 업로드 + 배포)** — CSV 업로드 화면·파기 배치 완료. **배포는 미완**
  (Vercel 계정 연결·환경변수·도메인 설정이 필요하다 — [DEPLOY.md](DEPLOY.md) 참고)

## ⚠️ 운영 배포 전 반드시 처리할 것

1. **개인정보 동의 문구** — `config/site.json` 의 `privacy.consentNotice` 가 법무 확인 전
   임시본이다. `privacy.reviewed` 를 true 로 바꾸기 전에는 실제 개인정보를 받으면 안 된다
2. **AE(이상사례) 키워드 목록 PV 확정** — `lib/ae-keywords.ts` 의 `REVIEWED_BY_PV` 가 false 다.
   지금 목록은 임의로 작성한 임시본이다. 제약회사는 이상사례 보고 의무가 있다 (§8-3)
3. **SMTP 실 발송 확인** — 환경변수가 비어 있으면 접수는 저장되지만 메일이 나가지 않는다
   (`email_error` 에 사유가 남는다)
4. **Vercel 발신 IP** — 서버리스는 발신 IP 가 고정되지 않는다. 사내 메일 서버가 IP 허용목록
   방식이면 배포 후 발송이 막힌다. 계정 인증만으로 외부 접속이 되는지 미리 확인할 것
5. **레이트리밋** — Upstash 환경변수가 비어 있으면 제한 없이 통과한다 (§7)
