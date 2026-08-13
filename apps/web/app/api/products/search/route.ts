/**
 * GET /api/products/search?q=&limit=
 * 제품명 자동완성 (설계문서 §5-1, §7)
 *
 * 결과가 0건이면 카테고리별 전체 목록을 함께 내려준다.
 * 위젯이 빈 화면으로 끝나는 상황을 API 계층에서 원천 차단한다 (§13).
 */

import { apiError, clientIp, handleUnexpected, json, preflight } from '@/lib/http'
import { getActiveProducts } from '@/lib/products-cache'
import { checkRateLimit } from '@/lib/ratelimit'
import { buildProductIndex, searchProducts } from '@/lib/search'
import { productSearchQuerySchema } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request): Response {
  return preflight(request)
}

export async function GET(request: Request): Promise<Response> {
  const rate = await checkRateLimit('products-search', clientIp(request))
  if (!rate.allowed) {
    return apiError(request, 'RATE_LIMITED', {
      headers: { 'Retry-After': String(rate.retryAfterSeconds ?? 60) },
    })
  }

  const url = new URL(request.url)
  const parsed = productSearchQuerySchema.safeParse({
    q: url.searchParams.get('q') ?? '',
    limit: url.searchParams.get('limit') ?? undefined,
    has_pharmacy: url.searchParams.get('has_pharmacy') ?? undefined,
  })

  if (!parsed.success) {
    return apiError(request, 'INVALID_INPUT', {
      message: parsed.error.issues[0]?.message ?? '검색어를 확인해주세요.',
    })
  }

  try {
    const all = await getActiveProducts()
    // [약국찾기] 분기는 취급처가 등록된 제품만 보여준다.
    // 그러지 않으면 제품을 고른 뒤 "취급처 0곳"이라는 막다른 길이 생긴다 (§13).
    const products = parsed.data.has_pharmacy ? all.filter((p) => p.hasPharmacy) : all

    const matches = searchProducts(products, parsed.data.q, { limit: parsed.data.limit })

    const results = matches.map((match) => ({
      id: match.product.id,
      name: match.product.name,
      packageSize: match.product.packageSize,
      category: match.product.category,
      hasPharmacy: match.product.hasPharmacy,
      hasInfo: match.product.infoText !== null,
      matchedBy: match.tier,
    }))

    return json(request, {
      query: parsed.data.q,
      results,
      // 0건일 때만 폴백을 채운다. 초성 인덱스로 전체 제품을 고를 수 있게 한다 (§5-1)
      fallback: results.length === 0 ? { index: buildProductIndex(products) } : null,
    })
  } catch (error) {
    return handleUnexpected(request, error, 'products/search')
  }
}
