/**
 * 관리자 권한 부여·조회 (설계문서 §9)
 *
 *   npm run admin:list  --workspace @theu/web
 *   npm run admin:grant --workspace @theu/web -- someone@theu.co.kr
 *   npm run admin:grant --workspace @theu/web -- someone@theu.co.kr --revoke
 *
 * 계정 자체는 Supabase 대시보드 > Authentication > Users 에서 만든다.
 * 이 스크립트는 만들어진 계정을 admin_users 에 등록/해제만 한다.
 * (비밀번호를 다루지 않는다)
 */

import { loadEnvFile } from './_env'

loadEnvFile()

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const listOnly = args.includes('--list')
  const revoke = args.includes('--revoke')
  const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase()

  const { supabaseService } = await import('../lib/supabase')
  const db = supabaseService()

  const { data: userList, error: listError } = await db.auth.admin.listUsers()
  if (listError) fail(`사용자 조회 실패: ${listError.message}`)

  const { data: admins, error: adminError } = await db
    .from('admin_users')
    .select('user_id, email, created_at')
  if (adminError) fail(`관리자 목록 조회 실패: ${adminError.message}`)

  const adminIds = new Set((admins ?? []).map((row) => String(row.user_id)))

  if (listOnly || !email) {
    console.log(`Supabase 계정 ${userList.users.length}개`)
    for (const user of userList.users) {
      const mark = adminIds.has(user.id) ? '관리자' : '  -   '
      console.log(`  [${mark}] ${user.email ?? '(이메일 없음)'}`)
    }
    if (!email) {
      console.log('')
      console.log('권한을 주려면: npm run admin:grant --workspace @theu/web -- 이메일주소')
    }
    return
  }

  const target = userList.users.find((user) => user.email?.toLowerCase() === email)
  if (!target) {
    fail(
      `Supabase 에 ${email} 계정이 없습니다.\n` +
        '  대시보드 > Authentication > Users > Add user 에서 먼저 계정을 만들어주세요.',
    )
  }

  if (revoke) {
    const { error } = await db.from('admin_users').delete().eq('user_id', target.id)
    if (error) fail(`권한 해제 실패: ${error.message}`)
    console.log(`✓ ${email} 관리자 권한을 해제했습니다.`)
    return
  }

  const { error } = await db
    .from('admin_users')
    .upsert({ user_id: target.id, email }, { onConflict: 'user_id' })
  if (error) fail(`권한 부여 실패: ${error.message}`)

  console.log(`✓ ${email} 를 관리자로 등록했습니다.`)
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
