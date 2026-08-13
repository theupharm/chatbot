/**
 * Supabase 연결·스키마·RLS 점검 스크립트
 *
 *   npm run check:db --workspace @theu/web
 *
 * .env.local 을 채운 뒤 실행하면 마이그레이션이 제대로 적용됐는지,
 * RLS 정책이 의도대로 동작하는지 한 번에 확인한다.
 * 비밀값은 출력하지 않는다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadEnvFile } from './_env'

loadEnvFile()

type Status = 'ok' | 'fail' | 'skip'

interface CheckResult {
  name: string
  status: Status
  detail: string
}

const results: CheckResult[] = []

function record(name: string, status: Status, detail: string): void {
  results.push({ name, status, detail })
}

function requireEnv(name: string): string | null {
  const value = process.env[name]
  if (!value) {
    record(name, 'fail', '설정되지 않음 — .env.local 을 확인하세요')
    return null
  }
  record(name, 'ok', name.includes('KEY') ? '설정됨 (값 미출력)' : value)
  return value
}

const TABLES = ['products', 'pharmacies', 'pharmacy_products', 'geocode_cache', 'complaints'] as const

/**
 * 테이블 존재 확인.
 * head 요청은 테이블이 없어도 에러 없이 돌아오는 경우가 있어 실제 행을 조회한다.
 */
async function tableExists(client: SupabaseClient, table: string): Promise<string | null> {
  const { error } = await client.from(table).select('*').limit(1)
  return error ? error.message : null
}

const PROBE = '__rls_probe__'

/**
 * 익명 키로 불만 접수가 읽히지 않는지 실제 행으로 확인한다.
 * 탐침 행은 어떤 경로로 끝나든 반드시 삭제한다.
 */
async function checkComplaintsRls(anon: SupabaseClient, service: SupabaseClient): Promise<void> {
  const label = 'RLS: 익명 불만접수 조회 차단'

  const { data: inserted, error: insertError } = await service
    .from('complaints')
    .insert({
      org_name: PROBE,
      region: PROBE,
      content: PROBE,
      contact: PROBE,
      consent_at: new Date().toISOString(),
    })
    .select('id, ticket_no')
    .single()

  if (insertError || !inserted) {
    record(label, 'skip', `탐침 행 생성 실패 — ${insertError?.message ?? '알 수 없음'}`)
    return
  }

  try {
    const { data: visible, error } = await anon
      .from('complaints')
      .select('id')
      .eq('id', inserted.id)

    const blocked = error !== null || (visible ?? []).length === 0
    record(
      label,
      blocked ? 'ok' : 'fail',
      blocked
        ? '차단됨 (실제 행으로 확인)'
        : '⚠️ 익명 키로 개인정보가 조회됩니다 — 정책을 확인하세요',
    )

    // 부수 확인: 접수번호 트리거가 C-YYYYMMDD-NNNN 형식으로 발번하는지 (§8-1)
    const ticketOk = /^C-\d{8}-\d{4}$/.test(String(inserted.ticket_no))
    record(
      'ticket_no 자동 발번',
      ticketOk ? 'ok' : 'fail',
      ticketOk ? String(inserted.ticket_no) : `형식 불일치: ${String(inserted.ticket_no)}`,
    )
  } finally {
    await service.from('complaints').delete().eq('id', inserted.id)
  }
}

async function main(): Promise<void> {
  const url = requireEnv('SUPABASE_URL')
  const anonKey = requireEnv('SUPABASE_ANON_KEY')
  const serviceKey = requireEnv('SUPABASE_SERVICE_KEY')

  if (!url || !anonKey || !serviceKey) {
    finish()
  }

  // 앱이 실제로 쓰는 클라이언트 생성 경로를 그대로 사용한다
  const { supabaseAnon, supabaseService } = await import('../lib/supabase')
  const anon = supabaseAnon()
  const service = supabaseService()

  // 1) 테이블 존재 (service key — RLS 우회)
  let missing = 0
  for (const table of TABLES) {
    const error = await tableExists(service, table)
    if (error) {
      missing++
      record(`table ${table}`, 'fail', error)
    } else {
      const { count } = await service.from(table).select('*', { count: 'exact', head: true })
      record(`table ${table}`, 'ok', `${count ?? 0}건`)
    }
  }

  if (missing > 0) {
    record('마이그레이션', 'fail', `테이블 ${missing}개 없음 — supabase/migrations 를 적용하세요`)
    for (const name of ['products 파생 컬럼', 'pharmacies.org_type', 'RLS 정책 3종']) {
      record(name, 'skip', '테이블이 없어 건너뜀')
    }
    finish()
  }

  // 2) 마이그레이션이 최신인지 (스펙 v1.1~v1.3 에서 추가된 컬럼)
  const { error: columnError } = await service
    .from('products')
    .select('id, name_norm, name_jamo, name_chosung, category, aliases, info_url')
    .limit(1)
  record(
    'products 파생 컬럼',
    columnError ? 'fail' : 'ok',
    columnError ? columnError.message : 'name_norm/name_jamo/name_chosung/category 존재',
  )

  const { error: orgTypeError } = await service.from('pharmacies').select('org_type').limit(1)
  record(
    'pharmacies.org_type',
    orgTypeError ? 'fail' : 'ok',
    orgTypeError ? orgTypeError.message : '존재 (취급처 유형 배지용)',
  )

  const { error: packageSizeError } = await service.from('products').select('package_size').limit(1)
  record(
    'products.package_size',
    packageSizeError ? 'fail' : 'ok',
    packageSizeError ? packageSizeError.message : '존재 (용량·규격 분리 저장)',
  )

  // 2-1) 거리 검색 함수 — 익명 키로 호출 가능해야 한다 (§5-2)
  const { error: rpcError } = await anon.rpc('search_pharmacies', {
    p_product_id: 0,
    p_lat: 37.5665,
    p_lng: 126.978,
    p_limit: 1,
    p_radius_km: 10,
  })
  record(
    'search_pharmacies()',
    rpcError ? 'fail' : 'ok',
    rpcError ? rpcError.message : '익명 키로 호출 가능',
  )

  // 3) RLS — 익명 키로 제품 조회는 되어야 한다
  const { error: anonReadError } = await anon.from('products').select('id').limit(1)
  record(
    'RLS: 익명 제품 조회 허용',
    anonReadError ? 'fail' : 'ok',
    anonReadError ? anonReadError.message : '허용됨',
  )

  // 4) RLS — 익명 키로 불만 접수 조회는 막혀야 한다.
  //    테이블이 비어 있으면 "0건 반환"과 "차단됨"을 구별할 수 없으므로
  //    service key 로 탐침 행을 넣고 익명으로 읽히는지 실제로 확인한 뒤 지운다.
  await checkComplaintsRls(anon, service)

  // 5) RLS — 익명 키로 제품 쓰기는 막혀야 한다
  const { error: anonWriteError } = await anon
    .from('products')
    .insert({ name: PROBE, name_norm: PROBE, name_jamo: 'x', name_chosung: 'x' })
  record(
    'RLS: 익명 제품 쓰기 차단',
    anonWriteError ? 'ok' : 'fail',
    anonWriteError ? '차단됨' : '⚠️ 익명 키로 쓰기가 가능합니다 — 정책을 확인하세요',
  )
  if (!anonWriteError) {
    await service.from('products').delete().eq('name_norm', PROBE)
  }

  finish()
}

const ICON: Record<Status, string> = { ok: '✓', fail: '✗', skip: '-' }

function finish(): never {
  console.log('')
  for (const r of results) {
    console.log(`${ICON[r.status]} ${r.name.padEnd(28)} ${r.detail}`)
  }

  const failed = results.filter((r) => r.status === 'fail').length
  const skipped = results.filter((r) => r.status === 'skip').length
  console.log('')
  console.log(
    failed === 0
      ? `전부 통과했습니다.${skipped ? ` (${skipped}건 건너뜀)` : ''}`
      : `${failed}건 실패했습니다.${skipped ? ` (${skipped}건 건너뜀)` : ''}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error: unknown) => {
  console.error('✗ 점검 중 오류:', error instanceof Error ? error.message : error)
  process.exit(1)
})
