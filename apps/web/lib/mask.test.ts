import { describe, expect, it } from 'vitest'
import { maskContact } from '@/lib/mask'

describe('maskContact', () => {
  it('이메일은 아이디 앞 2자만 남긴다', () => {
    expect(maskContact('online@theu.co.kr')).toBe('on****@theu.co.kr')
    expect(maskContact('ldh1007@theu.co.kr')).toBe('ld*****@theu.co.kr')
  })

  it('짧은 아이디도 최소 한 글자는 가린다', () => {
    expect(maskContact('ab@x.com')).toBe('ab*@x.com')
    expect(maskContact('a@x.com')).toBe('a*@x.com')
  })

  it('전화번호는 뒤 4자리만 남긴다', () => {
    // 숫자 9자리 → 앞 5자리를 가린다
    expect(maskContact('02-123-4567')).toBe('*****4567')
    expect(maskContact('010-1234-5678')).toBe('*******5678')
  })

  it('원문 전체가 노출되지 않는다', () => {
    for (const value of ['online@theu.co.kr', '02-123-4567', '010-9999-8888']) {
      expect(maskContact(value)).not.toBe(value)
      expect(maskContact(value)).toContain('*')
    }
  })

  it('빈 값은 빈 문자열', () => {
    expect(maskContact('')).toBe('')
    expect(maskContact('   ')).toBe('')
  })
})
