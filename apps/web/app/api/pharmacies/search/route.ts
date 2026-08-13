/**
 * GET /api/pharmacies/search?product_id=&lat=&lng=
 * 취급처 거리순 검색 (설계문서 §5-2, §7)
 *
 * 하버사인 계산은 DB 함수 search_pharmacies() 가 수행한다.
 * 사용자 좌표는 이 요청 처리에만 쓰고 저장하지 않는다 (§13).
 */

import { apiError, clientIp, handleUnexpected, json, preflight } from '@/lib/http'
import { checkRateLimit } from '@/lib/ratelimit'
import { supabaseAnon } from '@/lib/supabase'
import { pharmacySearchQuerySchema } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 5
const DEFAULT_RADIUS_KM = 10

/** 결과 카드에 붙일 유형 배지 (§5-2 확정안). other 는 배지를 달지 않는다 */
const ORG_TYPE_LABEL: Record<string, string | null> = {
  pharmacy: '약국',
  clinic: '의원',
  other: null,
}

interface SearchRow {
  id: number
  name: string
  address: string
  phone: string | null
  org_type: string
  lat: number
  lng: number
  distance_km: number
}

export function OPTIONS(request: Request): Response {
  return preflight(request)
}

export async function GET(request: Request): Promise<Response> {
  const rate = await checkRateLimit('pharmacies-search', clientIp(request))
  if (!rate.allowed) {
    return apiError(request, 'RATE_LIMITED', {
      headers: { 'Retry-After': String(rate.retryAfterSeconds ?? 60) },
    })
  }

  const url = new URL(request.url)
  const parsed = pharmacySearchQuerySchema.safeParse({
    product_id: url.searchParams.get('product_id'),
    lat: url.searchParams.get('lat'),
    lng: url.searchParams.get('lng'),
    limit: url.searchParams.get('limit') ?? undefined,
    radius_km: url.searchParams.get('radius_km') ?? undefined,
  })

  if (!parsed.success) {
    return apiError(request, 'INVALID_INPUT', { message: '위치 정보를 확인해주세요.' })
  }

  const { product_id, lat, lng } = parsed.data
  const limit = parsed.data.limit ?? DEFAULT_LIMIT
  const radiusKm = parsed.data.radius_km ?? DEFAULT_RADIUS_KM

  try {
    const { data, error } = await supabaseAnon().rpc('search_pharmacies', {
      p_product_id: product_id,
      p_lat: lat,
      p_lng: lng,
      p_limit: limit,
      p_radius_km: radiusKm,
    })

    if (error) throw new Error(error.message)

    const rows = (data ?? []) as SearchRow[]

    return json(request, {
      productId: product_id,
      radiusKm,
      results: rows.map((row) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        phone: row.phone,
        orgType: row.org_type,
        orgLabel: ORG_TYPE_LABEL[row.org_type] ?? null,
        distanceKm: Number(row.distance_km),
        // 지도 링크를 만들기 위해 내려준다. 사업장 위치라 공개 정보다.
        lat: Number(row.lat),
        lng: Number(row.lng),
      })),
      // 0건이어도 200 이다. 위젯이 고객센터 안내를 띄운다 (§5-2, §13)
      found: rows.length > 0,
    })
  } catch (error) {
    return handleUnexpected(request, error, 'pharmacies/search')
  }
}
