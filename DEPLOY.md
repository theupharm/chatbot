# 배포 가이드

설계문서 §10, §12 Phase 6.

Vercel 계정 연결과 DNS 설정은 계정 권한이 필요해 직접 하셔야 합니다.
아래 순서대로 진행하시면 됩니다.

---

## 1. 위젯 빌드 확인

위젯은 `apps/web/public/widget.js` 로 떨어지고 Next.js 가 `/widget.js` 로 서빙합니다.
배포 전에 최신 상태인지 확인하세요.

```bash
npm run build --workspace @theu/widget
```

```bash
npm run build --workspace @theu/web
```

> 위젯 소스를 고친 뒤 web 만 배포하면 예전 번들이 나갑니다. **항상 위젯 → web 순서로 빌드**하세요.

---

## 2. Vercel 프로젝트 생성

이 저장소는 아직 git 저장소가 아닙니다. 먼저 원격 저장소에 올려야 Vercel 이 연결할 수 있습니다.

```bash
git init
```

```bash
git add . && git commit -m "더유제약 챗봇 초기 구현"
```

그 뒤 GitHub 등에 올리고 Vercel 에 연결합니다.

> `.gitignore` 에 `.env.local`, `data/raw/`, `*.xlsx` 가 들어 있어 **비밀값과 원본 데이터는
> 커밋되지 않습니다.** 커밋 전에 `git status` 로 한 번 확인하세요.

1. [vercel.com](https://vercel.com) → Add New → Project → 저장소 연결
2. **Root Directory 를 `apps/web` 으로 지정** (모노레포라 기본값으로는 빌드가 안 됩니다)
3. Framework Preset: Next.js (자동 인식)

### 모노레포 주의점

`config/site.json` 이 `apps/web` 바깥에 있습니다. Root Directory 를 `apps/web` 으로 잡아도
빌드에 포함되도록 `next.config.mjs` 에 `outputFileTracingRoot` 를 저장소 루트로 지정해
두었습니다. **이 설정을 지우면 배포 후 고객센터 안내 문구가 깨집니다.**

로컬에서 프로덕션 빌드로 확인한 결과, 고객센터 번호와 동의 문구가 서버 번들과 `widget.js`
양쪽에 정상 포함됩니다.

---

## 3. 환경변수 등록

Vercel → Settings → Environment Variables 에 아래를 넣습니다.
`.env.local` 과 같은 값이되, **테스트용으로 넣어둔 값은 운영 값으로 바꿔야 합니다.**

| 변수 | 비고 |
|---|---|
| `SUPABASE_URL` | |
| `SUPABASE_ANON_KEY` | |
| `SUPABASE_SERVICE_KEY` | **서버 전용.** 절대 `NEXT_PUBLIC_` 붙이지 말 것 |
| `KAKAO_REST_KEY` | |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | 다우오피스 |
| `MAIL_FROM` | |
| `COMPLAINT_MAIL_TO` | ⚠️ 실제 고객센터 주소로 교체 |
| `PV_MAIL_TO` | ⚠️ 실제 약물감시 담당 주소로 교체 |
| `ALLOWED_ORIGINS` | ⚠️ 홈페이지 origin (예: `https://www.theu.co.kr`) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | ⚠️ 비우면 레이트리밋이 동작하지 않음 |
| `CRON_SECRET` | 파기 배치 인증용. 긴 임의 문자열 |
| `PRODUCT_CACHE_TTL_SECONDS` | 선택. 기본 300 |

---

## 4. 배포 후 확인할 것

### 4-1. 발신 IP

**가장 막히기 쉬운 지점입니다.** Vercel 서버리스는 발신 IP 가 고정되지 않습니다.
다우오피스 SMTP 가 IP 허용목록 방식이면 로컬에서는 되던 메일이 배포 후 실패합니다.

배포 직후 관리자 페이지에서 테스트 접수를 넣고 메일이 오는지 확인하세요.
실패하면 불만 접수 내역의 "메일 실패" 필터에 잡히고, 재발송 버튼으로 다시 보낼 수 있습니다.

### 4-2. Kakao 플랫폼 등록

Kakao Developers → 앱 설정 → 플랫폼 → Web 에 배포 도메인을 추가합니다.

### 4-3. CORS

`ALLOWED_ORIGINS` 에 홈페이지 origin 이 정확히 들어가야 위젯이 API 를 호출할 수 있습니다.
`https://` 포함, 끝에 슬래시 없이 적습니다. 여러 개면 쉼표로 구분합니다.

---

## 5. 홈페이지에 위젯 심기

홈페이지 HTML 의 `</body>` 직전에 한 줄 넣습니다.

```html
<script src="https://챗봇도메인/widget.js" async></script>
```

- 위젯은 iframe 이 아니라 Shadow DOM 이라 홈페이지 CSS 와 서로 간섭하지 않습니다
- **홈페이지가 HTTPS 여야** 현재 위치 찾기(Geolocation)가 동작합니다
- 별도의 `allow` 속성은 필요 없습니다

---

## 6. 개인정보 파기 배치

`vercel.json` 에 매일 03:00(KST) 실행으로 등록돼 있습니다. (cron 표기는 UTC `0 18 * * *`)

**다만 `config/site.json` 의 `privacy.reviewed` 가 `false` 인 동안에는 아무것도 지우지 않고
건너뜁니다.** 법무에서 보관기간을 확정한 뒤 아래를 하세요.

1. `config/site.json` 의 `privacy.consentNotice` 를 확정본으로 교체
2. `privacy.reviewed` 를 `true` 로 변경
3. 보관기간이 3년이 아니라면 `app/api/cron/purge-complaints/route.ts` 의 `RETENTION_DAYS` 수정
4. 재배포

---

## ⚠️ 운영 시작 전 체크리스트

- [ ] `config/site.json` 의 개인정보 동의 문구 — 법무 확정본으로 교체, `reviewed: true`
- [ ] `lib/ae-keywords.ts` 의 이상사례 키워드 — PV 팀 확정, `REVIEWED_BY_PV = true`
- [ ] `COMPLAINT_MAIL_TO` / `PV_MAIL_TO` — 실제 담당 주소로 교체
- [ ] SMTP 계정 — 개인 계정이 아닌 **발송 전용 계정**으로 교체
- [ ] Upstash 환경변수 — 레이트리밋 활성화
- [ ] Supabase 회원가입 끄기 (Authentication → Sign In/Providers → Email)
- [ ] 관리자 계정 등록 (`npm run admin:grant`)
- [ ] 배포 후 실제 메일 수신 확인
