/**
 * 서버 API 클라이언트 (설계문서 §7)
 *
 * 위젯은 상태 머신을 직접 돌리고 서버에서는 데이터만 받아온다 (§3).
 */

import { API_BASE, SEARCH_RADIUS_KM } from '@/config'

export interface ProductSummary {
  id: number
  name: string
  packageSize: string | null
  hasPharmacy: boolean
  hasInfo: boolean
}

export interface IndexGroup {
  initial: string
  products: Array<{ id: number; name: string; packageSize: string | null }>
}

export interface ProductSearchResult {
  results: ProductSummary[]
  fallback: { index: IndexGroup[] } | null
}

export interface ProductDetail {
  id: number
  name: string
  packageSize: string | null
  hasPharmacy: boolean
  hasInfo: boolean
  infoText: string
  infoLinks: Array<{ label: string; url: string }>
}

export interface AddressCandidate {
  lat: number
  lng: number
  address: string
  placeName: string | null
}

export interface Pharmacy {
  id: number
  name: string
  address: string
  phone: string | null
  orgType: string
  orgLabel: string | null
  distanceKm: number
  /** 카카오맵 링크를 만들 때만 쓴다 */
  lat: number
  lng: number
}

/** 서버가 내려준 사용자 노출용 메시지를 담은 오류 */
export class ApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

const GENERIC_ERROR = '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'

async function get<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
  } catch {
    throw new ApiError('연결에 실패했습니다. 네트워크 상태를 확인해주세요.')
  }

  const body = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null

  if (!response.ok || !body) {
    throw new ApiError(body?.error?.message ?? GENERIC_ERROR)
  }
  return body
}

export function searchProducts(query: string, onlyWithPharmacy: boolean): Promise<ProductSearchResult> {
  return get<ProductSearchResult>('/api/products/search', {
    q: query,
    ...(onlyWithPharmacy ? { has_pharmacy: 1 } : {}),
  })
}

export function fetchProductIndex(onlyWithPharmacy: boolean): Promise<{ index: IndexGroup[] }> {
  return get<{ index: IndexGroup[] }>(
    '/api/products/catalog',
    onlyWithPharmacy ? { has_pharmacy: 1 } : {},
  )
}

export function fetchProduct(id: number): Promise<ProductDetail> {
  return get<ProductDetail>(`/api/products/${id}`, {})
}

export function geocode(query: string): Promise<{ candidates: AddressCandidate[]; found: boolean }> {
  return get<{ candidates: AddressCandidate[]; found: boolean }>('/api/geocode', { q: query })
}

export function searchPharmacies(
  productId: number,
  lat: number,
  lng: number,
): Promise<{ results: Pharmacy[]; found: boolean; radiusKm: number }> {
  return get<{ results: Pharmacy[]; found: boolean; radiusKm: number }>('/api/pharmacies/search', {
    product_id: productId,
    lat,
    lng,
    radius_km: SEARCH_RADIUS_KM,
  })
}

export interface ComplaintPayload {
  orgName: string
  region: string
  content: string
  contact: string
  productId: number | null
  consent: true
}

export async function submitComplaint(payload: ComplaintPayload): Promise<{ ticketNo: string }> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}/api/complaints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new ApiError('연결에 실패했습니다. 네트워크 상태를 확인해주세요.')
  }

  const body = (await response.json().catch(() => null)) as
    | { ticketNo?: string; error?: { message?: string } }
    | null

  if (!response.ok || !body?.ticketNo) {
    throw new ApiError(body?.error?.message ?? GENERIC_ERROR)
  }
  return { ticketNo: body.ticketNo }
}

/**
 * 브라우저 Geolocation (§5-2 경로 A).
 * 실패 사유를 구분하지 않고 null 을 준다 — 어떤 실패든 주소 입력으로 넘어가면 되기 때문이다.
 */
export function getCurrentPosition(timeoutMs = 8000): Promise<{ lat: number; lng: number } | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null)

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}
