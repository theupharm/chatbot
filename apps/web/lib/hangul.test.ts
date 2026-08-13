import { describe, expect, it } from 'vitest'
import {
  decomposeSyllable,
  isStandaloneJamo,
  isSyllable,
  looksLikeChosungQuery,
  toChosung,
  toJamo,
} from '@/lib/hangul'

describe('isSyllable', () => {
  it('완성형 한글 음절을 판별한다', () => {
    expect(isSyllable('가')).toBe(true)
    expect(isSyllable('힣')).toBe(true)
    expect(isSyllable('제')).toBe(true)
  })

  it('자모·영문·숫자는 음절이 아니다', () => {
    expect(isSyllable('ㄱ')).toBe(false)
    expect(isSyllable('ㅏ')).toBe(false)
    expect(isSyllable('a')).toBe(false)
    expect(isSyllable('1')).toBe(false)
  })
})

describe('decomposeSyllable', () => {
  it('받침 없는 음절을 분해한다', () => {
    expect(decomposeSyllable('가')).toEqual({ cho: 'ㄱ', jung: 'ㅏ', jong: '' })
    expect(decomposeSyllable('베')).toEqual({ cho: 'ㅂ', jung: 'ㅔ', jong: '' })
  })

  it('받침 있는 음절을 분해한다', () => {
    expect(decomposeSyllable('닥')).toEqual({ cho: 'ㄷ', jung: 'ㅏ', jong: 'ㄱ' })
    expect(decomposeSyllable('값')).toEqual({ cho: 'ㄱ', jung: 'ㅏ', jong: 'ㅄ' })
  })

  it('경계값을 분해한다', () => {
    expect(decomposeSyllable('가')).toEqual({ cho: 'ㄱ', jung: 'ㅏ', jong: '' })
    expect(decomposeSyllable('힣')).toEqual({ cho: 'ㅎ', jung: 'ㅣ', jong: 'ㅎ' })
  })

  it('한글 음절이 아니면 null', () => {
    expect(decomposeSyllable('a')).toBeNull()
    expect(decomposeSyllable('ㄱ')).toBeNull()
  })
})

describe('toJamo', () => {
  it('얕은 분해는 초성·중성·종성만 쪼갠다', () => {
    expect(toJamo('베아제', { deep: false })).toBe('ㅂㅔㅇㅏㅈㅔ')
    expect(toJamo('닥터', { deep: false })).toBe('ㄷㅏㄱㅌㅓ')
  })

  it('깊은 분해는 복합 자모까지 쪼갠다 (기본값)', () => {
    // ㅔ → ㅓㅣ
    expect(toJamo('베아제')).toBe('ㅂㅓㅣㅇㅏㅈㅓㅣ')
    // ㅄ → ㅂㅅ
    expect(toJamo('값')).toBe('ㄱㅏㅂㅅ')
    // ㄲ → ㄱㄱ, ㅘ → ㅗㅏ
    expect(toJamo('꽈')).toBe('ㄱㄱㅗㅏ')
  })

  it('한글이 아닌 문자는 그대로 통과시킨다', () => {
    expect(toJamo('dr로반')).toBe('drㄹㅗㅂㅏㄴ')
    expect(toJamo('100')).toBe('100')
  })

  it('빈 문자열은 빈 문자열', () => {
    expect(toJamo('')).toBe('')
  })

  it('오타와 정답의 자모가 대부분 겹친다 — 퍼지 검색의 전제', () => {
    const correct = toJamo('베아제')
    const typo = toJamo('배아제')
    expect(correct).not.toBe(typo)
    // ㅂ + (ㅓ|ㅏ) + ㅣ + ㅇㅏㅈㅓㅣ — 8자 중 7자가 같은 위치에서 일치
    expect(correct.length).toBe(typo.length)
    const sameCount = [...correct].filter((ch, i) => ch === typo[i]).length
    expect(sameCount).toBeGreaterThanOrEqual(7)
  })
})

describe('toChosung', () => {
  it('초성만 추출한다', () => {
    expect(toChosung('베아제')).toBe('ㅂㅇㅈ')
    expect(toChosung('닥터로반연고')).toBe('ㄷㅌㄹㅂㅇㄱ')
  })

  it('한글이 아닌 문자는 그대로 둔다', () => {
    expect(toChosung('dr로반')).toBe('drㄹㅂ')
  })
})

describe('looksLikeChosungQuery', () => {
  it('자음만 입력하면 초성 질의로 본다', () => {
    expect(looksLikeChosungQuery('ㅂㅇㅈ')).toBe(true)
    expect(looksLikeChosungQuery('ㄷㅌ')).toBe(true)
  })

  it('완성형 음절이 섞이면 초성 질의가 아니다', () => {
    expect(looksLikeChosungQuery('베아제')).toBe(false)
    expect(looksLikeChosungQuery('ㅂ아제')).toBe(false)
  })

  it('모음이 섞이면 초성 질의가 아니다', () => {
    expect(looksLikeChosungQuery('ㅂㅏㅈ')).toBe(false)
  })

  it('빈 문자열·영문은 초성 질의가 아니다', () => {
    expect(looksLikeChosungQuery('')).toBe(false)
    expect(looksLikeChosungQuery('abc')).toBe(false)
  })
})

describe('isStandaloneJamo', () => {
  it('단독 자모를 판별한다', () => {
    expect(isStandaloneJamo('ㄱ')).toBe(true)
    expect(isStandaloneJamo('ㅣ')).toBe(true)
    expect(isStandaloneJamo('가')).toBe(false)
  })
})
