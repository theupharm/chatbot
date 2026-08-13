/**
 * 취급처 데이터 임포트 (설계문서 §4-1, §9-3)
 *
 * 원본 시트는 (제품 × 취급처) 롱 포맷이다. 같은 취급처가 제품 수만큼 반복된다.
 * 여기서는 행을 검증·정규화하고, 취급처를 중복 제거해 매핑과 분리한다.
 *
 * 순수 함수만 둔다. DB 접근·지오코딩은 호출부(스크립트, Phase 6 관리자 업로드)의 몫이다.
 */

import { isValidCoordinate, normalizeAddress, parseRegion } from '@/lib/address'
import { normalizeText } from '@/lib/normalize'

export type OrgType = 'pharmacy' | 'clinic' | 'other'

/**
 * 상호 접미사로 기관 유형을 추정한다.
 * 약국을 먼저 보므로 "○○병원약국" 은 약국으로 분류된다.
 */
const CLINIC_KEYWORDS = [
  '의원', '병원', '한의원', '치과', '의료원', '클리닉',
  '피부과', '성형외과', '이비인후과', '산부인과', '소아청소년과', '소아과',
  '비뇨기과', '가정의학과', '정형외과', '신경외과', '흉부외과', '안과',
  '내과', '외과', '신경과', '정신건강의학과', '재활의학과',
  '마취통증의학과', '영상의학과', '진단검사의학과', '응급의학과',
]

export function classifyOrgType(name: string): OrgType {
  if (name.includes('약국')) return 'pharmacy'
  if (CLINIC_KEYWORDS.some((keyword) => name.includes(keyword))) return 'clinic'
  return 'other'
}

/** 상호에서 괄호 지역 접미사를 뗀다. `100세약국(인천 남동구)` → `100세약국` */
export function stripRegionSuffix(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * 상호의 괄호 안 지역 표기를 꺼낸다. `100세약국(인천 남동구)` → `인천 남동구`
 *
 * 주소가 아예 비어 있는 행(29건)의 지오코딩 단서로 쓴다.
 * 괄호 안이 지역이 아닌 경우(`(마포)` 처럼 구 이름만 있는 경우 포함)도 그대로 돌려주고,
 * 쓸 만한지는 지오코딩 결과로 판단한다.
 */
export function extractRegionHint(rawName: string): string | null {
  const matches = [...rawName.matchAll(/\(([^)]*)\)/g)]
  const last = matches[matches.length - 1]?.[1]?.trim()
  return last ? last : null
}

/** CSV 원본 행 (컬럼명은 임포터가 매핑해서 넘긴다) */
export interface RawRow {
  product: string
  name: string
  address: string
  phone: string
  lat: string
  lng: string
}

export interface ParsedPharmacy {
  name: string
  nameNorm: string
  orgType: OrgType
  address: string
  addressNorm: string
  sido: string | null
  sigungu: string | null
  phone: string | null
  lat: number | null
  lng: number | null
  /** 상호 괄호 안 지역 표기. 주소가 없는 행의 지오코딩 단서 */
  regionHint: string | null
}

export interface ParsedRow {
  /** 1부터 시작하는 원본 행 번호 (헤더 제외). 실패 리포트에 쓴다 */
  rowNumber: number
  productName: string
  pharmacy: ParsedPharmacy
  /** 취급처 중복 판정 키 */
  key: string
}

export interface RowIssue {
  rowNumber: number
  name: string
  reason: string
}

export interface ParseOutcome {
  rows: ParsedRow[]
  /** 저장할 수 없는 행 */
  rejected: RowIssue[]
  /** 저장은 하되 사람이 봐야 할 행 */
  warnings: RowIssue[]
}

/** 전화번호로 인정할 형식. 벗어나면 경고만 남기고 값은 버린다 */
const PHONE_PATTERN = /^0\d{1,2}-\d{3,4}-\d{4}$/

function cleanPhone(raw: string): { phone: string | null; warn: string | null } {
  const value = raw.trim()
  if (!value) return { phone: null, warn: null }
  if (PHONE_PATTERN.test(value)) return { phone: value, warn: null }
  return { phone: null, warn: `전화번호 형식이 올바르지 않아 비웁니다: ${value}` }
}

/**
 * 원본 행들을 검증·정규화한다.
 *
 * 좌표가 없는 행은 여기서 반려하지 않고 `lat/lng = null` 로 통과시킨다.
 * 지오코딩으로 채울 기회를 준 뒤, 그래도 못 채우면 호출부가 반려한다.
 */
export function parseRows(raws: readonly RawRow[]): ParseOutcome {
  const rows: ParsedRow[] = []
  const rejected: RowIssue[] = []
  const warnings: RowIssue[] = []

  raws.forEach((raw, index) => {
    const rowNumber = index + 1
    const rawName = raw.name.trim()
    const productName = raw.product.trim()

    if (!rawName) {
      rejected.push({ rowNumber, name: '(빈 값)', reason: '취급처명이 없습니다' })
      return
    }
    if (!productName) {
      rejected.push({ rowNumber, name: rawName, reason: '제품명이 없습니다' })
      return
    }

    const name = stripRegionSuffix(rawName)
    const nameNorm = normalizeText(name)
    if (!nameNorm) {
      rejected.push({ rowNumber, name: rawName, reason: '정규화 후 취급처명이 비었습니다' })
      return
    }

    const address = raw.address.trim()
    const { sido, sigungu } = parseRegion(address)

    if (address && !sido) {
      warnings.push({
        rowNumber,
        name: rawName,
        reason: `주소에서 시/도를 인식하지 못했습니다: ${address}`,
      })
    }

    const { phone, warn } = cleanPhone(raw.phone)
    if (warn) warnings.push({ rowNumber, name: rawName, reason: warn })

    const latNum = Number.parseFloat(raw.lat)
    const lngNum = Number.parseFloat(raw.lng)
    const hasCoordinate = isValidCoordinate(latNum, lngNum)

    if ((raw.lat.trim() || raw.lng.trim()) && !hasCoordinate) {
      warnings.push({
        rowNumber,
        name: rawName,
        reason: `좌표가 대한민국 범위를 벗어나 무시합니다: ${raw.lat}, ${raw.lng}`,
      })
    }

    const addressNorm = normalizeAddress(address)

    rows.push({
      rowNumber,
      productName,
      key: `${nameNorm}|${addressNorm}`,
      pharmacy: {
        name,
        nameNorm,
        orgType: classifyOrgType(name),
        address,
        addressNorm,
        sido,
        sigungu,
        phone,
        lat: hasCoordinate ? latNum : null,
        lng: hasCoordinate ? lngNum : null,
        regionHint: extractRegionHint(rawName),
      },
    })
  })

  return { rows, rejected, warnings }
}

export interface DedupedPharmacy extends ParsedPharmacy {
  key: string
  /** 이 취급처가 등장한 원본 행 번호들 */
  rowNumbers: number[]
}

/**
 * 취급처를 `(name_norm, address_norm)` 기준으로 중복 제거한다.
 *
 * 같은 취급처의 행들 사이에 값이 갈리면 **정보가 더 많은 쪽을 채택**한다.
 * (좌표·전화번호가 일부 행에만 있는 경우가 있다)
 */
export function dedupePharmacies(rows: readonly ParsedRow[]): DedupedPharmacy[] {
  const map = new Map<string, DedupedPharmacy>()

  for (const row of rows) {
    const existing = map.get(row.key)
    if (!existing) {
      map.set(row.key, { ...row.pharmacy, key: row.key, rowNumbers: [row.rowNumber] })
      continue
    }

    existing.rowNumbers.push(row.rowNumber)
    if (existing.lat === null && row.pharmacy.lat !== null) {
      existing.lat = row.pharmacy.lat
      existing.lng = row.pharmacy.lng
    }
    if (!existing.phone && row.pharmacy.phone) existing.phone = row.pharmacy.phone
    if (!existing.sido && row.pharmacy.sido) {
      existing.sido = row.pharmacy.sido
      existing.sigungu = row.pharmacy.sigungu
    }
    if (!existing.address && row.pharmacy.address) existing.address = row.pharmacy.address
    if (!existing.regionHint && row.pharmacy.regionHint) {
      existing.regionHint = row.pharmacy.regionHint
    }
  }

  return [...map.values()]
}

/** 제품명 → 취급처 키 집합 */
export function buildProductLinks(rows: readonly ParsedRow[]): Map<string, Set<string>> {
  const links = new Map<string, Set<string>>()
  for (const row of rows) {
    const set = links.get(row.productName) ?? new Set<string>()
    set.add(row.key)
    links.set(row.productName, set)
  }
  return links
}
