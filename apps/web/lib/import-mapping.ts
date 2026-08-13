/**
 * CSV 헤더 매핑 (설계문서 §9-3)
 *
 * 운영 담당자는 기존 스프레드시트를 그대로 내보내 올린다. 그 파일의 헤더는 한글이다.
 * 이관 스크립트가 쓰는 영문 헤더도 함께 받아준다.
 */

import type { RawRow } from '@/lib/pharmacy-import'

/** 컬럼별로 인정하는 헤더 이름들 (소문자·공백 제거해서 비교) */
const ALIASES: Record<keyof RawRow, string[]> = {
  product: ['제품명', '제품', 'product', 'productname'],
  name: ['약국명', '취급처명', '상호명', '상호', 'name', 'pharmacy'],
  address: ['주소', '소재지', 'address'],
  phone: ['전화번호', '연락처', '전화', 'phone', 'tel'],
  lat: ['위도', 'lat', 'latitude'],
  lng: ['경도', 'lng', 'lon', 'longitude'],
}

/** 필수 컬럼. 좌표는 없으면 지오코딩으로 채우므로 필수가 아니다 */
export const REQUIRED_COLUMNS: Array<keyof RawRow> = ['product', 'name', 'address']

const normalizeHeader = (value: string): string =>
  value.replace(/^﻿/, '').replace(/\s/g, '').toLowerCase()

export interface HeaderMap {
  /** 컬럼 → CSV 열 인덱스. 없는 컬럼은 -1 */
  index: Record<keyof RawRow, number>
  missing: Array<keyof RawRow>
}

export function mapHeaders(header: readonly string[]): HeaderMap {
  const normalized = header.map(normalizeHeader)

  const index = {} as Record<keyof RawRow, number>
  for (const [column, names] of Object.entries(ALIASES) as Array<[keyof RawRow, string[]]>) {
    index[column] = normalized.findIndex((cell) => names.includes(cell))
  }

  return {
    index,
    missing: REQUIRED_COLUMNS.filter((column) => index[column] === -1),
  }
}

/** CSV 한 줄을 RawRow 로 뽑는다 */
export function toRawRow(cells: readonly string[], map: HeaderMap['index']): RawRow {
  const at = (column: keyof RawRow): string =>
    map[column] === -1 ? '' : (cells[map[column]] ?? '')

  return {
    product: at('product'),
    name: at('name'),
    address: at('address'),
    phone: at('phone'),
    lat: at('lat'),
    lng: at('lng'),
  }
}

/** 템플릿 CSV. 기존 시트 컬럼 구조에 맞춘다 */
export const TEMPLATE_CSV = [
  '제품명,약국명,주소,전화번호,위도,경도',
  '닥터로반연고,100세약국(인천 남동구),인천 남동구 남동대로 892,032-427-7585,37.4620832,126.7086607',
  '닥터로반연고,예시의원,서울 강남구 테헤란로 152,02-000-0000,,',
].join('\r\n')
