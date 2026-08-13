/**
 * 관리자 영역 인증 (설계문서 §7, §9)
 *
 * `/admin/*` 과 `/api/admin/*` 은 Supabase Auth 세션이 있어야 통과한다.
 * 세션 쿠키 갱신도 여기서 한다 — 서버 컴포넌트에서는 쿠키를 쓸 수 없기 때문이다.
 *
 * CORS·레이트리밋은 공개 API 쪽 관심사라 각 라우트 핸들러에서 처리한다.
 * 관리자 API 는 동일 출처 전용이므로 CORS 를 열지 않는다.
 */

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const LOGIN_PATH = '/admin/login'

export async function middleware(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request })

  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY

  // 환경변수가 없으면 인증을 확인할 수 없다. 열어주지 않고 막는다.
  if (!url || !anonKey) {
    return deny(request, '서버 설정이 완료되지 않았습니다.')
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(list) {
        for (const { name, value } of list) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // getUser() 는 토큰을 서버에서 검증한다. getSession() 은 쿠키를 그대로 믿으므로 쓰지 않는다.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (pathname === LOGIN_PATH) {
    // 이미 로그인했으면 로그인 화면 대신 관리자 첫 화면으로 보낸다
    if (user) {
      const target = request.nextUrl.clone()
      target.pathname = '/admin/complaints'
      target.search = ''
      return NextResponse.redirect(target)
    }
    return response
  }

  if (!user) return deny(request)

  return response
}

function deny(request: NextRequest, message = '로그인이 필요합니다.'): NextResponse {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message } }, { status: 401 })
  }

  const target = request.nextUrl.clone()
  target.pathname = LOGIN_PATH
  target.search = ''
  return NextResponse.redirect(target)
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}
