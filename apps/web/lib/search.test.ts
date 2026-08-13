import { describe, expect, it } from 'vitest'
import {
  buildCatalog,
  deriveProductFields,
  searchProducts,
  UNCATEGORIZED_LABEL,
  type SearchableProduct,
} from '@/lib/search'

/**
 * 테스트용 제품 마스터.
 *
 * "닥터로반연고" 만 기존 스프레드시트에서 확인된 실제 제품이고,
 * 나머지는 매칭 규칙 검증용 더미다. Phase 0 에서 실제 제품 목록을 확보하면
 * 이 목록과 별칭을 실제 데이터로 교체한다.
 */
function makeProduct(
  id: number,
  name: string,
  extra: {
    aliases?: string[]
    category?: string | null
    infoUrl?: string | null
    hasPharmacy?: boolean
  } = {},
): SearchableProduct {
  const derived = deriveProductFields(name)
  return {
    id,
    name,
    nameNorm: derived.name_norm,
    nameJamo: derived.name_jamo,
    nameChosung: derived.name_chosung,
    aliases: extra.aliases ?? [],
    category: extra.category ?? null,
    packageSize: null,
    infoUrl: extra.infoUrl ?? null,
    infoText: null,
    infoLinks: [],
    hasPharmacy: extra.hasPharmacy ?? false,
  }
}

const PRODUCTS: SearchableProduct[] = [
  makeProduct(1, '닥터로반연고', {
    aliases: ['로반연고', '닥터로반'],
    category: '외용제',
    infoUrl: 'https://example.com/1',
  }),
  makeProduct(2, '닥터로반크림', { category: '외용제' }),
  makeProduct(3, '베아제', { category: '소화제' }),
  makeProduct(4, '베아제플러스에프', { category: '소화제' }),
  makeProduct(5, '위더유정', { category: '소화제' }),
  makeProduct(6, '리프테크로션', {}),
]

/** 1순위로 나온 제품의 이름 */
function top(query: string): string | undefined {
  return searchProducts(PRODUCTS, query)[0]?.product.name
}

describe('searchProducts — 기본 매칭', () => {
  it('정확히 일치하면 1순위', () => {
    expect(top('베아제')).toBe('베아제')
  })

  it('전방일치로 후보를 찾는다', () => {
    const results = searchProducts(PRODUCTS, '닥터로반')
    expect(results.map((r) => r.product.name)).toEqual(
      expect.arrayContaining(['닥터로반연고', '닥터로반크림']),
    )
  })

  it('짧은 이름이 긴 이름보다 앞선다', () => {
    // "베아제" 검색 시 "베아제플러스에프" 보다 "베아제" 가 먼저
    const results = searchProducts(PRODUCTS, '베아제')
    expect(results[0]?.product.name).toBe('베아제')
    expect(results[1]?.product.name).toBe('베아제플러스에프')
  })

  it('띄어쓰기와 특수문자를 무시한다', () => {
    expect(top('닥터 로반 연고')).toBe('닥터로반연고')
    expect(top('베 아 제')).toBe('베아제')
    expect(top('(베아제)')).toBe('베아제')
  })

  it('별칭으로 찾는다', () => {
    expect(top('로반연고')).toBe('닥터로반연고')
  })

  it('부분일치로 찾는다', () => {
    expect(top('플러스에프')).toBe('베아제플러스에프')
  })
})

/**
 * Phase 1 완료 기준: 오타 3종 케이스에서 올바른 제품이 1순위로 반환된다.
 */
describe('searchProducts — 오타 허용 (Phase 1 완료 기준)', () => {
  it('오타 ① 모음 오타: 닥터루반연고 → 닥터로반연고', () => {
    expect(top('닥터루반연고')).toBe('닥터로반연고')
  })

  it('오타 ② 받침 누락: 닥터로바연고 → 닥터로반연고', () => {
    expect(top('닥터로바연고')).toBe('닥터로반연고')
  })

  it('오타 ③ 자음 오타: 닥터로반연코 → 닥터로반연고', () => {
    expect(top('닥터로반연코')).toBe('닥터로반연고')
  })

  it('설계문서에 명시된 케이스: 배아제 → 베아제', () => {
    expect(top('배아제')).toBe('베아제')
  })

  it('오타가 있어도 무관한 제품은 끼지 않는다', () => {
    const results = searchProducts(PRODUCTS, '배아제')
    expect(results.map((r) => r.product.name)).not.toContain('리프테크로션')
  })

  it('오타 매칭은 전방일치보다 뒤에 온다', () => {
    // "닥터로반" 은 두 제품의 전방일치 — 오타 유사도로 걸린 제품보다 앞서야 한다
    const results = searchProducts(PRODUCTS, '닥터로반')
    const tiers = results.map((r) => r.tier)
    const firstFuzzy = tiers.indexOf('fuzzy')
    const lastPrefix = tiers.lastIndexOf('prefix')
    if (firstFuzzy !== -1 && lastPrefix !== -1) {
      expect(lastPrefix).toBeLessThan(firstFuzzy)
    }
  })
})

describe('searchProducts — 초성 검색', () => {
  it('초성으로 찾는다', () => {
    expect(top('ㄷㅌㄹㅂㅇㄱ')).toBe('닥터로반연고')
  })

  it('초성 일부로도 찾는다', () => {
    const names = searchProducts(PRODUCTS, 'ㅂㅇㅈ').map((r) => r.product.name)
    expect(names).toContain('베아제')
    expect(names).toContain('베아제플러스에프')
  })

  it('초성 질의에는 자모 유사도를 적용하지 않는다', () => {
    // 무관한 초성은 결과가 없어야 한다 (노이즈 방지)
    expect(searchProducts(PRODUCTS, 'ㅋㅋㅋ')).toHaveLength(0)
  })
})

describe('searchProducts — 경계 조건', () => {
  it('빈 질의는 빈 배열', () => {
    expect(searchProducts(PRODUCTS, '')).toEqual([])
    expect(searchProducts(PRODUCTS, '   ')).toEqual([])
  })

  it('매칭이 없으면 빈 배열 — 호출부가 폴백을 제공해야 한다', () => {
    expect(searchProducts(PRODUCTS, '아스피린')).toEqual([])
  })

  it('limit 을 지킨다', () => {
    expect(searchProducts(PRODUCTS, '닥터로반', { limit: 1 })).toHaveLength(1)
  })

  it('같은 제품이 중복으로 나오지 않는다', () => {
    // 이름·별칭 모두에 걸리는 질의
    const results = searchProducts(PRODUCTS, '닥터로반')
    const ids = results.map((r) => r.product.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('1글자 질의에는 자모 유사도를 적용하지 않는다', () => {
    // "베" 는 전방일치로만 걸려야 한다
    const results = searchProducts(PRODUCTS, '베')
    expect(results.every((r) => r.tier !== 'fuzzy')).toBe(true)
  })
})

describe('deriveProductFields', () => {
  it('저장용 파생 필드를 만든다', () => {
    expect(deriveProductFields('닥터 로반 연고')).toEqual({
      name_norm: '닥터로반연고',
      name_jamo: 'ㄷㅏㄱㅌㅓㄹㅗㅂㅏㄴㅇㅕㄴㄱㅗ',
      name_chosung: 'ㄷㅌㄹㅂㅇㄱ',
    })
  })
})

describe('buildCatalog', () => {
  it('카테고리별로 묶는다', () => {
    const catalog = buildCatalog(PRODUCTS)
    const 소화제 = catalog.find((g) => g.category === '소화제')
    expect(소화제?.products.map((p) => p.name)).toEqual([
      '베아제',
      '베아제플러스에프',
      '위더유정',
    ])
  })

  it('카테고리가 없는 제품은 기타로 묶고 맨 뒤에 둔다', () => {
    const catalog = buildCatalog(PRODUCTS)
    expect(catalog[catalog.length - 1]?.category).toBe(UNCATEGORIZED_LABEL)
    expect(catalog[catalog.length - 1]?.products.map((p) => p.name)).toEqual(['리프테크로션'])
  })

  it('규격을 함께 내려준다', () => {
    const withSize: SearchableProduct = { ...makeProduct(99, '덱세릴MD크림'), packageSize: '500g' }
    const group = buildCatalog([withSize])[0]
    expect(group?.products[0]?.packageSize).toBe('500g')
  })

  it('빈 목록은 빈 배열', () => {
    expect(buildCatalog([])).toEqual([])
  })
})
