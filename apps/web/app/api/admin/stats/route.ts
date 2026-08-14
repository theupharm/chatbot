/**
 * GET /api/admin/stats?from=&to= — 이용 통계 (설계문서 §9-5)
 *
 * 집계는 DB 함수가 한다. 원시 이벤트를 브라우저로 내려보내지 않는다.
 */

import { requireAdmin } from '@/lib/admin-auth'
import { apiError, handleUnexpected, json } from '@/lib/http'
import { supabaseService } from '@/lib/supabase'
import { statsQuerySchema } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin()

    const url = new URL(request.url)
    const parsed = statsQuerySchema.safeParse({
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    })
    if (!parsed.success) {
      return apiError(request, 'INVALID_INPUT', { message: '조회 기간을 확인해주세요.' })
    }

    const { from, to } = parsed.data
    const range = { p_from: from, p_to: to }
    const db = supabaseService()

    const [daily, products, failed, pharmacy, regions] = await Promise.all([
      db.rpc('stats_daily', range),
      db.rpc('stats_top_products', { ...range, p_limit: 20 }),
      db.rpc('stats_failed_queries', { ...range, p_limit: 30 }),
      db.rpc('stats_pharmacy_search', range),
      db.rpc('stats_empty_regions', { ...range, p_limit: 20 }),
    ])

    for (const result of [daily, products, failed, pharmacy, regions]) {
      if (result.error) throw new Error(result.error.message)
    }

    return json(request, {
      from,
      to,
      daily: daily.data ?? [],
      topProducts: products.data ?? [],
      failedQueries: failed.data ?? [],
      pharmacySearch: pharmacy.data ?? [],
      emptyRegions: regions.data ?? [],
    })
  } catch (error) {
    return handleUnexpected(request, error, 'admin/stats')
  }
}
