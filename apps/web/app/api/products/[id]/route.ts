/**
 * GET /api/products/:id
 * 제품 상세 (설계문서 §7). [제품정보] 분기에서 info_url 링크 버튼을 만들 때 쓴다.
 */

import { apiError, clientIp, handleUnexpected, json, preflight } from '@/lib/http'
import { getActiveProducts } from '@/lib/products-cache'
import { checkRateLimit } from '@/lib/ratelimit'
import { customerServiceNotice } from '@/lib/site-config'
import { productIdSchema } from '@/lib/validation'

export const runtime = 'nodejs'

export function OPTIONS(request: Request): Response {
  return preflight(request)
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rate = await checkRateLimit('products-detail', clientIp(request))
  if (!rate.allowed) {
    return apiError(request, 'RATE_LIMITED', {
      headers: { 'Retry-After': String(rate.retryAfterSeconds ?? 60) },
    })
  }

  const { id } = await context.params
  const parsed = productIdSchema.safeParse(id)
  if (!parsed.success) {
    return apiError(request, 'INVALID_INPUT')
  }

  try {
    const products = await getActiveProducts()
    const product = products.find((p) => p.id === parsed.data)

    if (!product) {
      return apiError(request, 'NOT_FOUND', { message: '제품 정보를 찾을 수 없습니다.' })
    }

    // 안내 문구가 없는 제품(덱세릴MD크림·브이멜라인)도 막다른 길로 두지 않는다.
    // 준비 중 안내 + 고객센터 연락처를 대신 내려준다 (§13).
    const hasInfo = product.infoText !== null && product.infoText.length > 0

    return json(request, {
      id: product.id,
      name: product.name,
      packageSize: product.packageSize,
      category: product.category,
      hasPharmacy: product.hasPharmacy,
      hasInfo,
      infoText: hasInfo
        ? product.infoText
        : `${product.name} 안내 문구는 준비 중입니다.\n아래 고객센터로 문의해주세요.\n\n${customerServiceNotice()}`,
      infoLinks: product.infoLinks,
      infoUrl: product.infoUrl,
    })
  } catch (error) {
    return handleUnexpected(request, error, 'products/detail')
  }
}
