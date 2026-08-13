/**
 * GET /api/products/catalog
 * 카테고리별 활성 제품 전체 목록 (설계문서 §5-1 폴백, §7)
 *
 * 검색 0건 화면과 "전체 제품에서 고르기" 진입점에서 쓴다.
 */

import { apiError, clientIp, handleUnexpected, json, preflight } from '@/lib/http'
import { getActiveProducts } from '@/lib/products-cache'
import { checkRateLimit } from '@/lib/ratelimit'
import { buildProductIndex } from '@/lib/search'
import { productCatalogQuerySchema } from '@/lib/validation'

export const runtime = 'nodejs'

export function OPTIONS(request: Request): Response {
  return preflight(request)
}

export async function GET(request: Request): Promise<Response> {
  const rate = await checkRateLimit('products-catalog', clientIp(request))
  if (!rate.allowed) {
    return apiError(request, 'RATE_LIMITED', {
      headers: { 'Retry-After': String(rate.retryAfterSeconds ?? 60) },
    })
  }

  const url = new URL(request.url)
  const parsed = productCatalogQuerySchema.safeParse({
    has_pharmacy: url.searchParams.get('has_pharmacy') ?? undefined,
  })
  if (!parsed.success) return apiError(request, 'INVALID_INPUT')

  try {
    const all = await getActiveProducts()
    const products = parsed.data.has_pharmacy ? all.filter((p) => p.hasPharmacy) : all

    return json(
      request,
      { index: buildProductIndex(products), total: products.length },
      { cacheControl: 's-maxage=300, stale-while-revalidate=60' },
    )
  } catch (error) {
    return handleUnexpected(request, error, 'products/catalog')
  }
}
