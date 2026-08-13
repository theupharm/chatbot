/**
 * 관리자 취급처 저장 (설계문서 §9-2)
 *
 * 핵심 규칙: **주소를 좌표로 바꾸지 못하면 저장하지 않는다.**
 * 잘못된 주소가 DB 에 들어가면 챗봇 거리 검색이 엉뚱한 결과를 내므로,
 * 입력 시점에 막는 것이 이 시스템의 데이터 품질 방어선이다.
 */

import { normalizeAddress, parseRegion } from '@/lib/address'
import { geocodeOne } from '@/lib/geocode'
import { normalizeText } from '@/lib/normalize'
import type { OrgType } from '@/lib/pharmacy-import'

export interface PharmacyInput {
  name: string
  orgType: OrgType
  address: string
  phone: string | null
  isActive: boolean
}

export interface PharmacyRow {
  name: string
  name_norm: string
  org_type: OrgType
  address: string
  address_norm: string
  sido: string | null
  sigungu: string | null
  phone: string | null
  lat: number
  lng: number
  is_active: boolean
  updated_by: string
}

export interface GeocodeFailure {
  ok: false
  message: string
}

export interface GeocodeSuccess {
  ok: true
  row: PharmacyRow
  /** 담당자에게 보여줄 확인 정보 */
  resolved: { address: string; lat: number; lng: number }
}

/**
 * 입력을 저장 가능한 행으로 만든다. 지오코딩에 실패하면 실패 사유를 돌려준다.
 *
 * 저장되는 주소는 **담당자가 입력한 원문**이다. 지오코딩이 돌려준 도로명주소로 덮어쓰지 않는다 —
 * 층·호수처럼 검색으로는 안 나오지만 사용자에게 필요한 정보가 사라지기 때문이다.
 */
export async function buildPharmacyRow(
  input: PharmacyInput,
  adminId: string,
): Promise<GeocodeSuccess | GeocodeFailure> {
  const nameNorm = normalizeText(input.name)
  if (!nameNorm) {
    return { ok: false, message: '상호명을 확인해주세요.' }
  }

  let geocoded: Awaited<ReturnType<typeof geocodeOne>> = null
  try {
    geocoded = await geocodeOne(input.address)
  } catch {
    return { ok: false, message: '주소 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }
  }

  if (!geocoded) {
    return {
      ok: false,
      message: '주소를 확인해주세요. 좌표를 찾지 못해 저장할 수 없습니다.',
    }
  }

  const { sido, sigungu } = parseRegion(input.address)

  return {
    ok: true,
    resolved: { address: geocoded.address, lat: geocoded.lat, lng: geocoded.lng },
    row: {
      name: input.name,
      name_norm: nameNorm,
      org_type: input.orgType,
      address: input.address,
      address_norm: normalizeAddress(input.address),
      // 주소에서 시/도를 못 뽑으면 지오코딩 결과 주소로 한 번 더 시도한다
      sido: sido ?? parseRegion(geocoded.address).sido,
      sigungu: sigungu ?? parseRegion(geocoded.address).sigungu,
      phone: input.phone,
      lat: geocoded.lat,
      lng: geocoded.lng,
      is_active: input.isActive,
      updated_by: adminId,
    },
  }
}
