/**
 * POST /api/auth/logout — 관리자 로그아웃 (설계문서 §9)
 * 세션 쿠키를 지우고 로그인 화면으로 보낸다.
 */

import { NextResponse } from 'next/server'
import { supabaseFromCookies } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const supabase = await supabaseFromCookies()
  await supabase.auth.signOut()

  return NextResponse.redirect(new URL('/admin/login', request.url), { status: 303 })
}
