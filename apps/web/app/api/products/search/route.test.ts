import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveProductFields, type SearchableProduct } from '@/lib/search'

/** DB·Redis 없이 라우트 로직만 검증한다 */
vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  PUBLIC_READ_LIMIT: { requests: 30, windowSeconds: 60 },
}))

const getActiveProducts = vi.fn<() => Promise<SearchableProduct[]>>()
vi.mock('@/lib/products-cache', () => ({
  getActiveProducts: () => getActiveProducts(),
  invalidateProductCache: vi.fn(),
}))

const { GET } = await import('@/app/api/products/search/route')

function product(
  id: number,
  name: string,
  category: string | null,
  hasPharmacy = false,
): SearchableProduct {
  const derived = deriveProductFields(name)
  return {
    id,
    name,
    nameNorm: derived.name_norm,
    nameJamo: derived.name_jamo,
    nameChosung: derived.name_chosung,
    aliases: [],
    category,
    packageSize: null,
    infoUrl: null,
    infoText: null,
    infoLinks: [],
    hasPharmacy,
  }
}

const PRODUCTS = [
  product(1, '닥터로반연고', '외용제', true),
  product(2, '베아제', '소화제'),
  product(3, '리프테크로션', null),
]

function call(query: string): Promise<Response> {
  return GET(new Request(`https://chatbot.example.com/api/products/search?${query}`))
}

beforeEach(() => {
  getActiveProducts.mockReset()
  getActiveProducts.mockResolvedValue(PRODUCTS)
})

describe('GET /api/products/search', () => {
  it('매칭된 제품을 반환한다', async () => {
    const response = await call('q=닥터로반')
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.results[0].name).toBe('닥터로반연고')
    expect(body.fallback).toBeNull()
  })

  it('오타가 있어도 찾는다', async () => {
    const body = await (await call('q=배아제')).json()
    expect(body.results[0].name).toBe('베아제')
  })

  it('0건이면 초성 인덱스 폴백을 함께 준다 (§13 빈 화면 금지)', async () => {
    const response = await call('q=아스피린')
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.results).toEqual([])
    // 닥터로반연고(ㄷ) · 리프테크로션(ㄹ) · 베아제(ㅂ)
    expect(body.fallback.index.map((g: { initial: string }) => g.initial)).toEqual(['ㄷ', 'ㄹ', 'ㅂ'])
  })

  it('빈 검색어는 400', async () => {
    const response = await call('q=')
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INVALID_INPUT')
  })

  it('40자를 넘는 검색어는 400', async () => {
    const response = await call(`q=${'가'.repeat(41)}`)
    expect(response.status).toBe(400)
  })

  it('limit 을 지킨다', async () => {
    const body = await (await call('q=닥터로반&limit=1')).json()
    expect(body.results).toHaveLength(1)
  })

  it('has_pharmacy=1 이면 취급처가 있는 제품만 준다 (§13 막다른 길 방지)', async () => {
    // 베아제는 취급처 매핑이 없다 → 결과도, 폴백 목록에서도 빠진다
    const body = await (await call('q=베아제&has_pharmacy=1')).json()
    expect(body.results).toEqual([])
    expect(body.fallback.index.flatMap((g: { products: unknown[] }) => g.products)).toHaveLength(1)
  })

  it('has_pharmacy 없으면 전체 제품을 대상으로 한다', async () => {
    const body = await (await call('q=베아제')).json()
    expect(body.results[0].name).toBe('베아제')
  })

  it('DB 조회 실패 시 내부 오류를 노출하지 않는다', async () => {
    getActiveProducts.mockRejectedValue(new Error('connection string: postgres://user:pw@host'))

    const response = await call('q=베아제')
    expect(response.status).toBe(500)

    const body = await response.json()
    expect(body.error.code).toBe('INTERNAL')
    expect(JSON.stringify(body)).not.toContain('postgres://')
  })
})
