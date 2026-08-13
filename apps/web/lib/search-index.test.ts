import { describe, expect, it } from 'vitest'
import {
  buildProductIndex,
  deriveProductFields,
  NON_HANGUL_LABEL,
  type SearchableProduct,
} from '@/lib/search'

function product(id: number, name: string): SearchableProduct {
  const derived = deriveProductFields(name)
  return {
    id,
    name,
    nameNorm: derived.name_norm,
    nameJamo: derived.name_jamo,
    nameChosung: derived.name_chosung,
    aliases: [],
    category: null,
    packageSize: null,
    infoUrl: null,
    infoText: null,
    infoLinks: [],
    hasPharmacy: false,
  }
}

/** 실제 제품 마스터에서 뽑은 이름들 */
const PRODUCTS = [
  product(1, '멜라녹스캡슐'),
  product(2, '닥터로반연고'),
  product(3, '바르토벤외용액'),
  product(4, '케어모블캡슐'),
  product(5, '치치렌정'),
  product(6, '브이멜라인'),
  product(7, '야미즈정'),
]

describe('buildProductIndex', () => {
  it('첫 글자 초성으로 묶는다', () => {
    const index = buildProductIndex(PRODUCTS)
    const initials = index.map((g) => g.initial)

    expect(initials).toContain('ㄷ') // 닥터로반연고
    expect(initials).toContain('ㅁ') // 멜라녹스캡슐
    expect(initials).toContain('ㅂ') // 바르토벤외용액, 브이멜라인
    expect(initials).toContain('ㅋ') // 케어모블캡슐
  })

  it('같은 초성 제품을 한 그룹에 모으고 가나다순으로 정렬한다', () => {
    const group = buildProductIndex(PRODUCTS).find((g) => g.initial === 'ㅂ')
    expect(group?.products.map((p) => p.name)).toEqual(['바르토벤외용액', '브이멜라인'])
  })

  it('자음 순서대로 그룹을 정렬한다', () => {
    const initials = buildProductIndex(PRODUCTS).map((g) => g.initial)
    expect(initials).toEqual(['ㄷ', 'ㅁ', 'ㅂ', 'ㅇ', 'ㅋ', 'ㅊ'].sort((a, b) => {
      const order = ['ㄱ','ㄴ','ㄷ','ㄹ','ㅁ','ㅂ','ㅅ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ']
      return order.indexOf(a) - order.indexOf(b)
    }))
  })

  it('쌍자음은 기본 자음으로 접는다', () => {
    const index = buildProductIndex([product(10, '까치정')])
    expect(index[0]?.initial).toBe('ㄱ')
  })

  it('한글이 아닌 이름은 별도 그룹으로 묶는다', () => {
    const index = buildProductIndex([product(11, 'MD크림'), product(12, '100세정')])
    expect(index).toHaveLength(1)
    expect(index[0]?.initial).toBe(NON_HANGUL_LABEL)
    expect(index[0]?.products).toHaveLength(2)
  })

  it('빈 목록은 빈 배열', () => {
    expect(buildProductIndex([])).toEqual([])
  })

  it('모든 제품이 정확히 한 번씩 들어간다', () => {
    const total = buildProductIndex(PRODUCTS).reduce((sum, g) => sum + g.products.length, 0)
    expect(total).toBe(PRODUCTS.length)
  })
})
