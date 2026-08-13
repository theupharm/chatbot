/**
 * 주소 정규화·파싱 (설계문서 §4-1)
 *
 * 원본 주소는 도로명·지번이 섞여 있고 층·호수·상호가 꼬리에 붙어 있다.
 * 완벽한 파싱은 목표가 아니다. 정규화는 중복 판정 보조 수단이고,
 * 최종 판단은 관리자 페이지의 중복 경고로 사람이 한다.
 */

import { normalizeText } from '@/lib/normalize'

/**
 * 시/도 표기 통일. 원본에 `서울`/`서울특별시`/`서울시`,
 * `전북`/`전라북도`/`전북특별자치도` 가 섞여 있다.
 */
const SIDO_CANONICAL: Record<string, string> = {
  서울: '서울', 서울시: '서울', 서울특별시: '서울',
  부산: '부산', 부산시: '부산', 부산광역시: '부산',
  대구: '대구', 대구시: '대구', 대구광역시: '대구',
  인천: '인천', 인천시: '인천', 인천광역시: '인천',
  광주: '광주', 광주시: '광주', 광주광역시: '광주',
  대전: '대전', 대전시: '대전', 대전광역시: '대전',
  울산: '울산', 울산시: '울산', 울산광역시: '울산',
  세종: '세종', 세종시: '세종', 세종특별자치시: '세종',
  경기: '경기', 경기도: '경기',
  강원: '강원', 강원도: '강원', 강원특별자치도: '강원',
  충북: '충북', 충청북도: '충북',
  충남: '충남', 충청남도: '충남',
  전북: '전북', 전라북도: '전북', 전북특별자치도: '전북',
  전남: '전남', 전라남도: '전남',
  경북: '경북', 경상북도: '경북',
  경남: '경남', 경상남도: '경남',
  제주: '제주', 제주도: '제주', 제주특별자치도: '제주',
}

export const SIDO_LIST = [...new Set(Object.values(SIDO_CANONICAL))]

/** 주소 정규화. 공백·특수문자를 제거해 중복 판정에 쓴다 */
export function normalizeAddress(address: string): string {
  return normalizeText(address)
}

export interface ParsedRegion {
  sido: string | null
  sigungu: string | null
}

/**
 * 주소 앞부분에서 시/도와 시군구를 뽑는다.
 *
 * `경기 수원시 영통구 ...` → { sido: '경기', sigungu: '수원시 영통구' }
 * `서울 중구 왕십리로 407` → { sido: '서울', sigungu: '중구' }
 *
 * 첫 토큰이 시/도로 인식되지 않으면(주소가 깨진 행) 둘 다 null 을 준다.
 */
export function parseRegion(address: string): ParsedRegion {
  const tokens = address.trim().split(/\s+/).filter(Boolean)
  const first = tokens[0]
  if (!first) return { sido: null, sigungu: null }

  const sido = SIDO_CANONICAL[first]
  if (!sido) return { sido: null, sigungu: null }

  // 광역시 아래 자치구는 1토큰, 도 아래 `수원시 영통구` 는 2토큰이다.
  const second = tokens[1]
  if (!second) return { sido, sigungu: null }

  const third = tokens[2]
  if (second.endsWith('시') && third && (third.endsWith('구') || third.endsWith('군'))) {
    return { sido, sigungu: `${second} ${third}` }
  }

  if (/[시군구]$/.test(second)) return { sido, sigungu: second }

  return { sido, sigungu: null }
}

/** 대한민국 좌표 범위. DB 의 chk_pharmacies_lat/lng 제약과 같은 값 */
const LAT_RANGE = [32.0, 39.5] as const
const LNG_RANGE = [124.0, 132.0] as const

export function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= LAT_RANGE[0] &&
    lat <= LAT_RANGE[1] &&
    lng >= LNG_RANGE[0] &&
    lng <= LNG_RANGE[1]
  )
}
