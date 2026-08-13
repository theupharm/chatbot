import { describe, expect, it } from 'vitest'
import { detectAdverseEvent } from '@/lib/ae-keywords'
import { buildHtmlBody, buildSubject, buildTextBody, type ComplaintMail } from '@/lib/mail'

function mail(overrides: Partial<ComplaintMail> = {}): ComplaintMail {
  return {
    ticketNo: 'C-20260812-0007',
    orgName: '더유약국',
    region: '서울 강남구',
    content: '포장이 훼손된 채로 입고되었습니다.',
    contact: '02-123-4567',
    productName: '닥터로반연고',
    isAeSuspect: false,
    aeKeywords: [],
    createdAt: new Date('2026-08-12T04:30:00Z'),
    ...overrides,
  }
}

describe('detectAdverseEvent', () => {
  it('부작용 관련 단어를 잡는다', () => {
    const result = detectAdverseEvent('바른 뒤 발진이 생겼다고 합니다.')
    expect(result.isSuspect).toBe(true)
    expect(result.matched).toContain('발진')
  })

  it('활용형도 잡는다 — ㅂ불규칙 포함 (어간 기준)', () => {
    expect(detectAdverseEvent('너무 가려워요').isSuspect).toBe(true)
    expect(detectAdverseEvent('가려움증이 생겼습니다').isSuspect).toBe(true)
    expect(detectAdverseEvent('어지럽다고 하십니다').isSuspect).toBe(true)
    expect(detectAdverseEvent('어지러워서 앉아 계셨습니다').isSuspect).toBe(true)
    expect(detectAdverseEvent('얼굴이 붓더라구요').isSuspect).toBe(true)
    expect(detectAdverseEvent('눈이 부어서 오셨어요').isSuspect).toBe(true)
    expect(detectAdverseEvent('바른 자리가 따가워요').isSuspect).toBe(true)
  })

  it('중대한 결과를 잡는다', () => {
    for (const text of ['입원했습니다', '응급실에 갔습니다', '호흡곤란 증상']) {
      expect(detectAdverseEvent(text).isSuspect, text).toBe(true)
    }
  })

  it('띄어쓰기가 달라도 잡는다', () => {
    expect(detectAdverseEvent('이상 반응이 있었습니다').isSuspect).toBe(true)
  })

  it('감지된 키워드를 모두 돌려준다 — PV 검토 근거', () => {
    const result = detectAdverseEvent('발진과 가려움이 있었고 결국 입원했습니다.')
    // 어간으로 저장되므로 '가려움'이 아니라 '가려'로 기록된다
    expect(result.matched).toEqual(expect.arrayContaining(['발진', '가려', '입원']))
  })

  it('일반 불만은 의심으로 보지 않는다', () => {
    expect(detectAdverseEvent('포장이 훼손된 채로 입고되었습니다.').isSuspect).toBe(false)
    expect(detectAdverseEvent('배송이 너무 늦습니다').isSuspect).toBe(false)
  })

  it('빈 내용은 의심 아님', () => {
    expect(detectAdverseEvent('')).toEqual({ isSuspect: false, matched: [] })
  })
})

describe('buildSubject', () => {
  it('설계문서 §8-2 형식을 따른다', () => {
    expect(buildSubject(mail())).toBe('[챗봇 불만접수 C-20260812-0007] 더유약국 - 닥터로반연고')
  })

  it('제품 미선택 시에도 제목이 깨지지 않는다', () => {
    expect(buildSubject(mail({ productName: null }))).toContain('제품 미지정')
  })

  it('AE 의심 건은 제목 앞에 표시한다', () => {
    const subject = buildSubject(mail({ isAeSuspect: true, aeKeywords: ['발진'] }))
    expect(subject.startsWith('[이상사례 의심]')).toBe(true)
  })
})

describe('buildTextBody', () => {
  it('접수 정보를 모두 담는다', () => {
    const text = buildTextBody(mail())
    for (const value of ['C-20260812-0007', '더유약국', '서울 강남구', '닥터로반연고', '02-123-4567']) {
      expect(text).toContain(value)
    }
    expect(text).toContain('포장이 훼손된 채로 입고되었습니다.')
  })

  it('AE 의심 건은 키워드와 안내를 덧붙인다', () => {
    const text = buildTextBody(mail({ isAeSuspect: true, aeKeywords: ['발진', '입원'] }))
    expect(text).toContain('이상사례(AE) 의심')
    expect(text).toContain('발진, 입원')
    expect(text).toContain('약물감시')
  })

  it('일반 건에는 AE 문구가 없다', () => {
    expect(buildTextBody(mail())).not.toContain('이상사례')
  })
})

describe('buildHtmlBody', () => {
  it('HTML 특수문자를 이스케이프한다', () => {
    const html = buildHtmlBody(mail({ content: '<script>alert(1)</script> & "따옴표"' }))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;')
  })

  it('상호명도 이스케이프한다', () => {
    const html = buildHtmlBody(mail({ orgName: '<b>약국</b>' }))
    expect(html).toContain('&lt;b&gt;약국&lt;/b&gt;')
  })

  it('AE 의심 건은 경고 블록을 넣는다', () => {
    const html = buildHtmlBody(mail({ isAeSuspect: true, aeKeywords: ['발진'] }))
    expect(html).toContain('이상사례(AE) 의심 건')
  })

  it('줄바꿈을 보존한다', () => {
    expect(buildHtmlBody(mail())).toContain('white-space:pre-wrap')
  })
})
