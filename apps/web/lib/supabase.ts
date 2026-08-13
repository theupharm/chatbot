/**
 * Supabase 클라이언트 (설계문서 §2)
 *
 * 공개 조회에는 anon 키를 쓴다. RLS 가 is_active 행만 내주므로
 * 비활성 제품·취급처가 챗봇에 노출될 수 없다 (§4 공통 규칙).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import WebSocketImpl from 'ws'
import { env } from '@/lib/env'

/**
 * supabase-js 는 Realtime 클라이언트를 미리 만드는데, Node 22 미만에는 전역 WebSocket 이
 * 없어서 생성 단계에서 바로 실패한다. 이 앱은 Realtime 을 쓰지 않지만 클라이언트가
 * 만들어져야 하므로 `ws` 를 transport 로 넘겨준다. Node 22 이상으로 올리면 제거 가능.
 */
const CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocketImpl as unknown as undefined },
} as const

let anonClient: SupabaseClient | null = null
let serviceClient: SupabaseClient | null = null

/** 공개 조회용. RLS 적용 */
export function supabaseAnon(): SupabaseClient {
  if (!anonClient) {
    anonClient = createClient(env.supabaseUrl(), env.supabaseAnonKey(), CLIENT_OPTIONS)
  }
  return anonClient
}

/**
 * 쓰기·관리자 조회용. RLS 를 우회하므로 서버 라우트 안에서만 사용한다.
 * 호출부에서 반드시 인증을 먼저 검증할 것 (§7).
 */
export function supabaseService(): SupabaseClient {
  if (!serviceClient) {
    serviceClient = createClient(env.supabaseUrl(), env.supabaseServiceKey(), CLIENT_OPTIONS)
  }
  return serviceClient
}
