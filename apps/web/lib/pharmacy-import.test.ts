import { describe, expect, it } from 'vitest'
import { normalizeAddress, parseRegion } from '@/lib/address'
import {
  buildProductLinks,
  classifyOrgType,
  dedupePharmacies,
  parseRows,
  stripRegionSuffix,
  type RawRow,
} from '@/lib/pharmacy-import'
import { splitProductName } from '@/lib/product-name'

/** 원본 시트에서 그대로 가져온 행 (D:\chatbot\취급처.xlsx) */
function raw(overrides: Partial<RawRow> = {}): RawRow {
  return {
    product: '닥터로반연고',
    name: '100세약국(인천 남동구)',
    address: '인천 남동구 남동대로 892',
    phone: '032-427-7585',
    lat: '37.4620832',
    lng: '126.7086607',
    ...overrides,
  }
}

describe('splitProductName', () => {
  it('용량·포장 표기를 분리한다', () => {
    expect(splitProductName('덱세릴MD크림 500g')).toEqual({
      name: '덱세릴MD크림',
      packageSize: '500g',
    })
    expect(splitProductName('센스지크림 30g')).toEqual({ name: '센스지크림', packageSize: '30g' })
    expect(splitProductName('치치렌정 30T')).toEqual({ name: '치치렌정', packageSize: '30T' })
    expect(splitProductName('브이멜라인 10T')).toEqual({ name: '브이멜라인', packageSize: '10T' })
    expect(splitProductName('케어모블캡슐 90c*2ea (1box)')).toEqual({
      name: '케어모블캡슐',
      packageSize: '90c*2ea (1box)',
    })
  })

  it('성분 농도는 제품 구분이므로 분리하지 않는다', () => {
    expect(splitProductName('마이모닉액 5%')).toEqual({ name: '마이모닉액 5%', packageSize: null })
    expect(splitProductName('마이모닉액 3%')).toEqual({ name: '마이모닉액 3%', packageSize: null })
  })

  it('규격이 없으면 그대로 둔다', () => {
    expect(splitProductName('닥터로반연고')).toEqual({ name: '닥터로반연고', packageSize: null })
  })

  it('이름 끝의 한글은 규격으로 오인하지 않는다', () => {
    // "치치렌정" 의 "정" 이 단위로 잘리면 안 된다
    expect(splitProductName('치치렌정').name).toBe('치치렌정')
  })
})

describe('classifyOrgType', () => {
  it('약국을 분류한다', () => {
    expect(classifyOrgType('100세약국')).toBe('pharmacy')
    expect(classifyOrgType('휴베이스반석봄약국')).toBe('pharmacy')
  })

  it('병원 안 약국은 약국으로 본다', () => {
    expect(classifyOrgType('성모병원약국')).toBe('pharmacy')
  })

  it('의원·전문과를 분류한다', () => {
    for (const name of [
      '광교퍼스트피부과',
      '뉘앙스성형외과',
      '구로끗한의원',
      '닥터에스의원',
      '박수경99이비인후과',
      '가나다소아청소년과',
      '검단성모산부인과',
      '굿모닝비뇨기과',
      '기쁨가정의학과',
      '고잔제일소아과',
      '미르피아여성병원',
    ]) {
      expect(classifyOrgType(name), name).toBe('clinic')
    }
  })

  it('판단할 수 없으면 other', () => {
    expect(classifyOrgType('더유헬스케어')).toBe('other')
  })
})

describe('stripRegionSuffix', () => {
  it('괄호 지역 접미사를 뗀다', () => {
    expect(stripRegionSuffix('100세약국(인천 남동구)')).toBe('100세약국')
    expect(stripRegionSuffix('이브산부인과(마포)')).toBe('이브산부인과')
  })

  it('괄호가 없으면 그대로 둔다', () => {
    expect(stripRegionSuffix('광교퍼스트피부과')).toBe('광교퍼스트피부과')
  })
})

describe('parseRegion', () => {
  it('광역시는 시/도 + 자치구', () => {
    expect(parseRegion('서울 중구 왕십리로 407 1층')).toEqual({ sido: '서울', sigungu: '중구' })
    expect(parseRegion('인천 남동구 남동대로 892')).toEqual({ sido: '인천', sigungu: '남동구' })
  })

  it('도는 시 + 구 두 토큰', () => {
    expect(parseRegion('경기 수원시 영통구 도청로66번길 6')).toEqual({
      sido: '경기',
      sigungu: '수원시 영통구',
    })
  })

  it('군 단위를 처리한다', () => {
    expect(parseRegion('충남 금산군 금산읍 인삼로 71')).toEqual({
      sido: '충남',
      sigungu: '금산군',
    })
  })

  it('시/도 표기 편차를 통일한다', () => {
    expect(parseRegion('강원도 원주시 능라동길 61').sido).toBe('강원')
    expect(parseRegion('서울특별시 중구 왕십리로 407').sido).toBe('서울')
    expect(parseRegion('전북특별자치도 익산시 무왕로 1').sido).toBe('전북')
    expect(parseRegion('세종특별자치시 한누리대로 1').sido).toBe('세종')
  })

  it('주소가 깨진 행은 null', () => {
    expect(parseRegion('9층 미앤미강남점 유화빌딩 9층 901호')).toEqual({
      sido: null,
      sigungu: null,
    })
    expect(parseRegion('202동 305호 2층 202호')).toEqual({ sido: null, sigungu: null })
    expect(parseRegion('')).toEqual({ sido: null, sigungu: null })
  })
})

describe('normalizeAddress', () => {
  it('공백·특수문자를 제거한다', () => {
    expect(normalizeAddress('인천 미추홀구 소성로 150 고일약국')).toBe('인천미추홀구소성로150고일약국')
    expect(normalizeAddress('경기 성남시 분당구 성남대로331번길 7 4층 402-1호')).toBe(
      '경기성남시분당구성남대로331번길74층4021호',
    )
  })
})

describe('parseRows', () => {
  it('정상 행을 파싱한다', () => {
    const { rows, rejected, warnings } = parseRows([raw()])
    expect(rejected).toEqual([])
    expect(warnings).toEqual([])
    expect(rows).toHaveLength(1)

    const row = rows[0]!
    expect(row.pharmacy.name).toBe('100세약국')
    expect(row.pharmacy.orgType).toBe('pharmacy')
    expect(row.pharmacy.sido).toBe('인천')
    expect(row.pharmacy.sigungu).toBe('남동구')
    expect(row.pharmacy.lat).toBeCloseTo(37.4620832)
    expect(row.productName).toBe('닥터로반연고')
  })

  it('취급처명이 없으면 반려한다', () => {
    const { rows, rejected } = parseRows([raw({ name: '   ' })])
    expect(rows).toEqual([])
    expect(rejected[0]?.reason).toContain('취급처명이 없습니다')
  })

  it('제품명이 없으면 반려한다', () => {
    const { rejected } = parseRows([raw({ product: '' })])
    expect(rejected[0]?.reason).toContain('제품명이 없습니다')
  })

  it('좌표가 없어도 통과시킨다 (지오코딩 기회를 준다)', () => {
    const { rows, rejected } = parseRows([raw({ lat: '', lng: '', address: '' })])
    expect(rejected).toEqual([])
    expect(rows[0]?.pharmacy.lat).toBeNull()
  })

  it('범위를 벗어난 좌표는 무시하고 경고한다', () => {
    const { rows, warnings } = parseRows([raw({ lat: '99', lng: '999' })])
    expect(rows[0]?.pharmacy.lat).toBeNull()
    expect(warnings[0]?.reason).toContain('대한민국 범위를 벗어나')
  })

  it('형식이 틀린 전화번호는 비우고 경고한다', () => {
    const { rows, warnings } = parseRows([raw({ phone: '12345-12345-12' })])
    expect(rows[0]?.pharmacy.phone).toBeNull()
    expect(warnings[0]?.reason).toContain('전화번호 형식')
  })

  it('시/도를 인식 못 하면 경고하되 통과시킨다', () => {
    const { rows, warnings } = parseRows([raw({ address: '202동 305호 2층 202호' })])
    expect(rows).toHaveLength(1)
    expect(warnings[0]?.reason).toContain('시/도를 인식하지 못했습니다')
  })
})

describe('dedupePharmacies', () => {
  it('같은 이름+주소를 하나로 합친다', () => {
    const { rows } = parseRows([
      raw({ product: '닥터로반연고' }),
      raw({ product: '마이모닉액 5%' }),
    ])
    const deduped = dedupePharmacies(rows)
    expect(deduped).toHaveLength(1)
    expect(deduped[0]?.rowNumbers).toEqual([1, 2])
  })

  it('같은 주소·다른 상호는 따로 유지한다', () => {
    // 경기 고양시 덕양구 화정로 47 — 다나온누리약국 / 동원텔약국
    const { rows } = parseRows([
      raw({ name: '다나온누리약국(경기 고양시)', address: '경기 고양시 덕양구 화정로 47' }),
      raw({ name: '동원텔약국(경기 고양시)', address: '경기 고양시 덕양구 화정로 47' }),
    ])
    expect(dedupePharmacies(rows)).toHaveLength(2)
  })

  it('정보가 더 많은 행의 값을 채택한다', () => {
    const { rows } = parseRows([
      raw({ phone: '', lat: '', lng: '' }),
      raw({ phone: '032-427-7585' }),
    ])
    const merged = dedupePharmacies(rows)[0]!
    expect(merged.phone).toBe('032-427-7585')
    expect(merged.lat).toBeCloseTo(37.4620832)
  })
})

describe('buildProductLinks', () => {
  it('제품별 취급처 집합을 만든다', () => {
    const { rows } = parseRows([
      raw({ product: '닥터로반연고' }),
      raw({ product: '마이모닉액 5%' }),
      raw({ product: '마이모닉액 5%', name: '4층약국(인천 서구)', address: '인천 서구 가정로 375' }),
    ])
    const links = buildProductLinks(rows)
    expect(links.get('닥터로반연고')?.size).toBe(1)
    expect(links.get('마이모닉액 5%')?.size).toBe(2)
  })
})
