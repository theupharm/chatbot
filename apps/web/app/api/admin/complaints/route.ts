/**
 * GET /api/admin/complaints — 불만 접수 목록
 *
 * 설계문서 §7, §9-4
 * 필터: status(new|in_progress|done), ae=1(이상사례 의심만), failed=1(메일 실패만)
 *
 * 목록에는 연락처를 마스킹해서 내려준다. 전체 값은 상세 조회에서만 준다 (§9-4).
 */

import { requireAdmin } from '@/lib/admin-auth'
import { apiError, handleUnexpected, json } from '@/lib/http'
import { maskContact } from '@/lib/mask'
import { supabaseService } from '@/lib/supabase'
import { adminListQuerySchema } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COLUMNS =
  'id, ticket_no, org_name, region, contact, content, product_id, is_ae_suspect, ae_keywords, status, email_sent, email_error, created_at'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin()

    const url = new URL(request.url)
    const parsed = adminListQuerySchema.safeParse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    })
    if (!parsed.success) return apiError(request, 'INVALID_INPUT')

    const { page, pageSize } = parsed.data
    const from = (page - 1) * pageSize
    const status = url.searchParams.get('status')
    const aeOnly = url.searchParams.get('ae') === '1'
    const failedOnly = url.searchParams.get('failed') === '1'

    let query = supabaseService()
      .from('complaints')
      .select(COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)

    if (status && ['new', 'in_progress', 'done'].includes(status)) {
      query = query.eq('status', status)
    }
    if (aeOnly) query = query.eq('is_ae_suspect', true)
    if (failedOnly) query = query.eq('email_sent', false)

    const { data, error, count } = await query
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as Array<Record<string, unknown>>

    // 제품명을 붙여준다 (목록에서 매번 상세를 열지 않아도 되게)
    const productIds = [...new Set(rows.map((r) => r.product_id).filter(Boolean))] as number[]
    const productNames = new Map<number, string>()
    if (productIds.length > 0) {
      const { data: products } = await supabaseService()
        .from('products')
        .select('id, name')
        .in('id', productIds)
      for (const product of products ?? []) {
        productNames.set(Number(product.id), String(product.name))
      }
    }

    return json(request, {
      items: rows.map((row) => ({
        ...row,
        contact: maskContact(String(row.contact ?? '')),
        productName: row.product_id ? (productNames.get(Number(row.product_id)) ?? null) : null,
      })),
      total: count ?? 0,
      page,
      pageSize,
    })
  } catch (error) {
    return handleUnexpected(request, error, 'admin/complaints GET')
  }
}
