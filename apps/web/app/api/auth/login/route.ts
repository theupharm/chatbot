/**
 * POST /api/auth/login — 관리자 로그인 (설계문서 §9)
 *
 * 서버에서 Supabase Auth 로 로그인하고 세션 쿠키를 심는다.
 * 이렇게 하면 브라우저 번들에 Supabase 키를 넣지 않아도 된다.
 *
 * `/api/admin/*` 이 아니라 `/api/auth/*` 에 두는 이유: 미들웨어가 관리자 경로를
 * 통째로 막기 때문에, 로그인 자체는 그 바깥에 있어야 한다.
 */

import { z } from 'zod'
import { apiError, clientIp, handleUnexpected, json } from '@/lib/http'
import { checkRateLimit } from '@/lib/ratelimit'
import { supabaseFromCookies } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
})

/** 무차별 대입 방어. 로그인은 조회보다 훨씬 빡빡하게 잡는다 */
const LOGIN_LIMIT = { requests: 10, windowSeconds: 300 }

export async function POST(request: Request): Promise<Response> {
  const rate = await checkRateLimit('auth-login', clientIp(request), LOGIN_LIMIT)
  if (!rate.allowed) {
    return apiError(request, 'RATE_LIMITED', {
      headers: { 'Retry-After': String(rate.retryAfterSeconds ?? 60) },
    })
  }

  try {
    const parsed = loginSchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(request, 'UNAUTHORIZED', {
        message: '이메일 또는 비밀번호가 올바르지 않습니다.',
      })
    }

    const supabase = await supabaseFromCookies()
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    })

    if (error) {
      // 계정 존재 여부를 알려주지 않는다. 사유를 구분하지 않고 같은 문구를 준다.
      return apiError(request, 'UNAUTHORIZED', {
        message: '이메일 또는 비밀번호가 올바르지 않습니다.',
      })
    }

    return json(request, { ok: true })
  } catch (error) {
    return handleUnexpected(request, error, 'auth/login')
  }
}
