import { describe, expect, it } from 'vitest'
import { parseCsv } from '@/lib/csv'
import { mapHeaders, toRawRow, TEMPLATE_CSV } from '@/lib/import-mapping'

describe('mapHeaders', () => {
  it('기존 시트의 한글 헤더를 인식한다', () => {
    const { index, missing } = mapHeaders(['제품명', '약국명', '주소', '전화번호', '위도', '경도'])
    expect(missing).toEqual([])
    expect(index).toEqual({ product: 0, name: 1, address: 2, phone: 3, lat: 4, lng: 5 })
  })

  it('이관 스크립트의 영문 헤더도 인식한다', () => {
    const { index, missing } = mapHeaders(['product', 'name', 'address', 'phone', 'lat', 'lng'])
    expect(missing).toEqual([])
    expect(index.lat).toBe(4)
  })

  it('컬럼 순서가 달라도 인식한다', () => {
    const { index } = mapHeaders(['주소', '제품명', '경도', '위도', '약국명'])
    expect(index.address).toBe(0)
    expect(index.product).toBe(1)
    expect(index.lng).toBe(2)
    expect(index.lat).toBe(3)
  })

  it('공백·대소문자 차이를 무시한다', () => {
    const { missing } = mapHeaders([' 제품명 ', 'Name', ' ADDRESS'])
    expect(missing).toEqual([])
  })

  it('BOM 이 붙은 첫 헤더도 인식한다', () => {
    const { index } = mapHeaders(['﻿제품명', '약국명', '주소'])
    expect(index.product).toBe(0)
  })

  it('좌표는 없어도 된다 — 주소로 찾을 수 있기 때문', () => {
    const { missing, index } = mapHeaders(['제품명', '약국명', '주소'])
    expect(missing).toEqual([])
    expect(index.lat).toBe(-1)
    expect(index.lng).toBe(-1)
  })

  it('필수 컬럼이 없으면 알려준다', () => {
    const { missing } = mapHeaders(['약국명', '전화번호'])
    expect(missing).toEqual(['product', 'address'])
  })

  it('대체 이름(상호명·연락처)도 받는다', () => {
    const { missing } = mapHeaders(['제품', '상호명', '소재지', '연락처'])
    expect(missing).toEqual([])
  })
})

describe('toRawRow', () => {
  it('행을 컬럼에 맞춰 뽑는다', () => {
    const { index } = mapHeaders(['제품명', '약국명', '주소', '전화번호', '위도', '경도'])
    const row = toRawRow(
      ['닥터로반연고', '100세약국(인천 남동구)', '인천 남동구 남동대로 892', '032-427-7585', '37.46', '126.70'],
      index,
    )
    expect(row).toEqual({
      product: '닥터로반연고',
      name: '100세약국(인천 남동구)',
      address: '인천 남동구 남동대로 892',
      phone: '032-427-7585',
      lat: '37.46',
      lng: '126.70',
    })
  })

  it('없는 컬럼은 빈 문자열로 채운다', () => {
    const { index } = mapHeaders(['제품명', '약국명', '주소'])
    const row = toRawRow(['닥터로반연고', '테스트약국', '서울 중구 세종대로 110'], index)
    expect(row.lat).toBe('')
    expect(row.phone).toBe('')
  })

  it('짧은 행도 깨지지 않는다', () => {
    const { index } = mapHeaders(['제품명', '약국명', '주소', '전화번호', '위도', '경도'])
    expect(toRawRow(['닥터로반연고', '테스트약국'], index).address).toBe('')
  })
})

describe('TEMPLATE_CSV', () => {
  it('스스로 파싱·매핑된다', () => {
    const table = parseCsv(TEMPLATE_CSV)
    const { missing, index } = mapHeaders(table[0]!)
    expect(missing).toEqual([])

    const first = toRawRow(table[1]!, index)
    expect(first.product).toBe('닥터로반연고')
    expect(first.lat).toBe('37.4620832')

    // 좌표를 비워둔 예시 행도 들어 있다
    const second = toRawRow(table[2]!, index)
    expect(second.lat).toBe('')
    expect(second.address).toBe('서울 강남구 테헤란로 152')
  })
})
