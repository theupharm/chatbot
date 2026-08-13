/**
 * 관리자 API 인증 (설계문서 §7)
 *
 * 미들웨어가 이미 걸러주지만, 라우트에서 한 번 더 확인한다.
 * 미들웨어 matcher 설정이 바뀌었을 때 조용히 뚫리는 일을 막기 위한 이중 방어이고,
 * 감사 컬럼(`updated_by`)에 넣을 사용자 id 도 여기서 가져온다 (§9 구현 노트).
 */

import { supabaseFromCookies } from '@/lib/supabase-server'

export interface AdminUser {
  id: string
  email: string | null
}

export type AdminCheck =
  | { state: 'anonymous' }
  /** 로그인은 했지만 admin_users 에 없는 사용자 */
  | { state: 'not-allowed'; email: string | null }
  | { state: 'ok'; admin: AdminUser }

/**
 * 세션과 권한을 함께 확인한다.
 *
 * 로그인했다는 것만으로 관리자로 보지 않는다. `admin_users` 에 등록된 사용자만 통과시킨다.
 * (Supabase 프로젝트에 회원가입이 열려 있어도 관리자 페이지가 뚫리지 않게 하기 위함)
 */
export async function checkAdmin(): Promise<AdminCheck> {
  const supabase = await supabaseFromCookies()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { state: 'anonymous' }

  // RLS 로 본인 행만 보이므로 anon/authenticated 클라이언트로 조회해도 안전하다
  const { data } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data) return { state: 'not-allowed', email: user.email ?? null }

  return { state: 'ok', admin: { id: user.id, email: user.email ?? null } }
}

/** 로그인 + 관리자 등록까지 끝난 사용자. 아니면 null */
export async function currentAdmin(): Promise<AdminUser | null> {
  const result = await checkAdmin()
  return result.state === 'ok' ? result.admin : null
}

export class UnauthorizedError extends Error {
  constructor() {
    super('로그인이 필요합니다.')
    this.name = 'UnauthorizedError'
  }
}

/** 로그인하지 않았으면 던진다. 라우트의 catch 에서 401 로 변환한다 */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await currentAdmin()
  if (!admin) throw new UnauthorizedError()
  return admin
}
