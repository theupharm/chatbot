/**
 * GET   /api/admin/pharmacies/:id — 상세 (취급 제품 포함)
 * PATCH /api/admin/pharmacies/:id — 수정 (저장 시 지오코딩 검증, 취급 제품 갱신)
 *
 * 설계문서 §7, §9-2
 */

import { requireAdmin } from '@/lib/admin-auth'
import { apiError, handleUnexpected, json, UNIQUE_VIOLATION } from '@/lib/http'
import { buildPharmacyRow } from '@/lib/pharmacy-admin'
import { supabaseService } from '@/lib/supabase'
import { adminPharmacySchema, productIdSchema } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireAdmin()

    const { id } = await context.params
    const parsedId = productIdSchema.safeParse(id)
    if (!parsedId.success) return apiError(request, 'INVALID_INPUT')

    const db = supabaseService()
    const [detail, links] = await Promise.all([
      db
        .from('pharmacies')
        .select('id, name, org_type, address, sido, sigungu, phone, lat, lng, is_active')
        .eq('id', parsedId.data)
        .maybeSingle(),
      db.from('pharmacy_products').select('product_id').eq('pharmacy_id', parsedId.data),
    ])

    if (detail.error) throw new Error(detail.error.message)
    if (links.error) throw new Error(links.error.message)
    if (!detail.data) return apiError(request, 'NOT_FOUND')

    return json(request, {
      ...detail.data,
      productIds: (links.data ?? []).map((row) => Number((row as { product_id: number }).product_id)),
    })
  } catch (error) {
    return handleUnexpected(request, error, 'admin/pharmacies GET one')
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const admin = await requireAdmin()

    const { id } = await context.params
    const parsedId = productIdSchema.safeParse(id)
    if (!parsedId.success) return apiError(request, 'INVALID_INPUT')

    const parsed = adminPharmacySchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(request, 'INVALID_INPUT', {
        message: parsed.error.issues[0]?.message ?? '입력값을 확인해주세요.',
      })
    }

    const input = parsed.data
    const built = await buildPharmacyRow(input, admin.id)
    if (!built.ok) return apiError(request, 'INVALID_INPUT', { message: built.message })

    const db = supabaseService()
    const pharmacyId = parsedId.data

    const { data, error } = await db
      .from('pharmacies')
      .update(built.row)
      .eq('id', pharmacyId)
      .select('id')
      .maybeSingle()

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return apiError(request, 'CONFLICT', {
          message: '같은 상호·주소의 취급처가 이미 등록되어 있습니다.',
        })
      }
      throw new Error(error.message)
    }
    if (!data) return apiError(request, 'NOT_FOUND')

    // 취급 제품은 통째로 교체한다. 체크박스 UI 라 부분 갱신이 의미가 없다.
    const { error: deleteError } = await db
      .from('pharmacy_products')
      .delete()
      .eq('pharmacy_id', pharmacyId)
    if (deleteError) throw new Error(deleteError.message)

    if (input.productIds.length > 0) {
      const { error: insertError } = await db
        .from('pharmacy_products')
        .insert(input.productIds.map((productId) => ({ pharmacy_id: pharmacyId, product_id: productId })))
      if (insertError) throw new Error(insertError.message)
    }

    return json(request, { id: pharmacyId, resolved: built.resolved })
  } catch (error) {
    return handleUnexpected(request, error, 'admin/pharmacies PATCH')
  }
}
