/**
 * GET  /api/admin/pharmacies  — 목록 (검색·지역 필터·페이지네이션)
 * POST /api/admin/pharmacies  — 등록 (저장 시 지오코딩 검증)
 *
 * 설계문서 §7, §9-2
 */

import { requireAdmin } from '@/lib/admin-auth'
import { apiError, handleUnexpected, json, UNIQUE_VIOLATION } from '@/lib/http'
import { normalizeText } from '@/lib/normalize'
import { buildPharmacyRow } from '@/lib/pharmacy-admin'
import { supabaseService } from '@/lib/supabase'
import { adminListQuerySchema, adminPharmacySchema } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COLUMNS = 'id, name, org_type, address, sido, sigungu, phone, lat, lng, is_active, updated_at'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin()

    const url = new URL(request.url)
    const parsed = adminListQuerySchema.safeParse({
      q: url.searchParams.get('q') ?? undefined,
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    })
    if (!parsed.success) return apiError(request, 'INVALID_INPUT')

    const sido = url.searchParams.get('sido')?.trim()
    const { q, page, pageSize } = parsed.data
    const from = (page - 1) * pageSize

    let query = supabaseService()
      .from('pharmacies')
      .select(COLUMNS, { count: 'exact' })
      .order('name', { ascending: true })
      .range(from, from + pageSize - 1)

    if (q) query = query.ilike('name_norm', `%${normalizeText(q)}%`)
    if (sido) query = query.eq('sido', sido)

    const { data, error, count } = await query
    if (error) throw new Error(error.message)

    return json(request, { items: data ?? [], total: count ?? 0, page, pageSize })
  } catch (error) {
    return handleUnexpected(request, error, 'admin/pharmacies GET')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const admin = await requireAdmin()

    const parsed = adminPharmacySchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(request, 'INVALID_INPUT', {
        message: parsed.error.issues[0]?.message ?? '입력값을 확인해주세요.',
      })
    }

    const input = parsed.data
    const built = await buildPharmacyRow(input, admin.id)

    // 지오코딩 실패 = 저장 차단 (§9-2). 잘못된 주소는 DB 에 들어갈 수 없다.
    if (!built.ok) return apiError(request, 'INVALID_INPUT', { message: built.message })

    const db = supabaseService()
    const { data, error } = await db.from('pharmacies').insert(built.row).select('id').single()

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return apiError(request, 'CONFLICT', {
          message: '같은 상호·주소의 취급처가 이미 등록되어 있습니다.',
        })
      }
      throw new Error(error.message)
    }

    const pharmacyId = data.id as number
    if (input.productIds.length > 0) {
      const { error: linkError } = await db
        .from('pharmacy_products')
        .insert(input.productIds.map((productId) => ({ pharmacy_id: pharmacyId, product_id: productId })))
      if (linkError) throw new Error(linkError.message)
    }

    return json(request, { id: pharmacyId, resolved: built.resolved }, { status: 201 })
  } catch (error) {
    return handleUnexpected(request, error, 'admin/pharmacies POST')
  }
}
