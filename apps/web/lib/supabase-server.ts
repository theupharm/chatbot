/**
 * 관리자 세션용 Supabase 클라이언트 (설계문서 §9)
 *
 * 쿠키 기반 세션을 읽고 갱신한다. 조회 권한은 authenticated 역할의 RLS 를 따르고,
 * 쓰기는 API 라우트가 인증을 확인한 뒤 service key 로 수행한다 (§7).
 */

import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

/** 서버 컴포넌트·라우트 핸들러에서 쓰는 세션 클라이언트 */
export async function supabaseFromCookies(): Promise<SupabaseClient> {
  const cookieStore = await cookies()

  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(list) {
        try {
          for (const { name, value, options } of list) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 갱신은 미들웨어가 담당하므로 무시해도 된다.
        }
      },
    },
  })
}
