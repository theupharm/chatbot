import { describe, expect, it } from 'vitest'
import { parseCsv, headerIndex } from '@/lib/csv'
import { parseProductAnswer } from '@/lib/product-info'

/** 제품정보.xlsx 의 실제 답변 원문 */
const REAL_ANSWER = [
  '안녕하세요 더유제약입니다.',
  '멜라녹스캡슐은 전문의약품으로 챗봇으로 안내가 어렵습니다.',
  '용법용량 및 주의사항은 아래 링크에서 확인 부탁드립니다.',
  '의약품상세정보(https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetailCache?cacheSeq=202402986aupdateTs2025-04-09%2012:29:15.0b)',
  '부작용 및 불량품은 처방받은 병원이나 약국으로 문의해주세요.',
  '감사합니다.',
].join('\n')

describe('parseProductAnswer', () => {
  it('링크를 본문에서 분리한다', () => {
    const { text, links } = parseProductAnswer(REAL_ANSWER)

    expect(links).toHaveLength(1)
    expect(links[0]?.label).toBe('의약품상세정보')
    expect(links[0]?.url).toContain('nedrug.mfds.go.kr')
    expect(text).not.toContain('http')
  })

  it('본문 문구를 그대로 보존한다 — 요약·재작성 금지 (§13)', () => {
    const { text } = parseProductAnswer(REAL_ANSWER)

    expect(text).toBe(
      [
        '안녕하세요 더유제약입니다.',
        '멜라녹스캡슐은 전문의약품으로 챗봇으로 안내가 어렵습니다.',
        '용법용량 및 주의사항은 아래 링크에서 확인 부탁드립니다.',
        '부작용 및 불량품은 처방받은 병원이나 약국으로 문의해주세요.',
        '감사합니다.',
      ].join('\n'),
    )
  })

  it('링크가 여러 개면 모두 뽑는다', () => {
    const answer = [
      '안내 문구',
      '의약품상세정보(https://example.com/a)',
      '추가 안내',
      '허가사항(https://example.com/b)',
    ].join('\n')

    const { links, text } = parseProductAnswer(answer)
    expect(links.map((l) => l.label)).toEqual(['의약품상세정보', '허가사항'])
    expect(text).toBe('안내 문구\n추가 안내')
  })

  it('라벨이 없으면 기본 문구를 쓴다', () => {
    const { links } = parseProductAnswer('안내\n(https://example.com/a)')
    expect(links[0]?.label).toBe('자세히 보기')
  })

  it('링크가 없으면 본문만 돌려준다', () => {
    const { text, links } = parseProductAnswer('안녕하세요 더유제약입니다.\n감사합니다.')
    expect(links).toEqual([])
    expect(text).toBe('안녕하세요 더유제약입니다.\n감사합니다.')
  })

  it('빈 줄이 연달아 나와도 두 줄까지만 남긴다', () => {
    const { text } = parseProductAnswer('첫줄\n\n\n\n끝줄')
    expect(text).toBe('첫줄\n\n끝줄')
  })

  it('CRLF 를 처리한다', () => {
    const { links } = parseProductAnswer('안내\r\n상세정보(https://example.com/a)\r\n끝')
    expect(links).toHaveLength(1)
  })
})

describe('parseCsv', () => {
  it('기본 CSV 를 파싱한다', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('BOM 을 제거한다', () => {
    expect(parseCsv('﻿a,b\n1,2')[0]).toEqual(['a', 'b'])
  })

  it('따옴표 안의 쉼표를 필드 구분자로 보지 않는다', () => {
    expect(parseCsv('name,address\n"약국","서울 중구, 1층"')[1]).toEqual([
      '약국',
      '서울 중구, 1층',
    ])
  })

  it('따옴표 안의 줄바꿈을 보존한다', () => {
    const rows = parseCsv('name,answer\n"제품","첫줄\n둘째줄"')
    expect(rows[1]?.[1]).toBe('첫줄\n둘째줄')
  })

  it('이스케이프된 따옴표를 처리한다', () => {
    expect(parseCsv('a\n"큰 ""따옴표"" 안"')[1]?.[0]).toBe('큰 "따옴표" 안')
  })

  it('빈 줄을 버린다', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toHaveLength(2)
  })
})

describe('headerIndex', () => {
  it('컬럼 인덱스를 소문자 기준으로 만든다', () => {
    expect(headerIndex([' Name ', 'ANSWER'])).toEqual({ name: 0, answer: 1 })
  })
})
