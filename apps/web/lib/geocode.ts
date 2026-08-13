/**
 * Kakao Local API 래퍼 (설계문서 §5-2, §7, §9-3)
 *
 * - REST 키는 서버에서만 쓴다. 클라이언트에 노출 금지 (§13)
 * - 단건 조회는 `geocode_cache` 를 먼저 본다. 같은 주소로 반복 호출하지 않는다 (§13)
 * - 대량 처리(CSV 이관)를 위해 동시 호출 수를 제한하고 429 에 지수 백오프한다
 */

import { normalizeText } from '@/lib/normalize'
import { isValidCoordinate } from '@/lib/address'
import { supabaseService } from '@/lib/supabase'

const KAKAO_BASE = 'https://dapi.kakao.com/v2/local/search'

/** 동시 호출 상한. Kakao 초당 제한에 여유를 두고 잡는다 */
const MAX_CONCURRENCY = 5
const MAX_RETRIES = 4

export interface GeocodeCandidate {
  lat: number
  lng: number
  /** 도로명 주소 우선, 없으면 지번 주소 */
  address: string
  /** 키워드 검색으로 찾은 경우의 장소명 */
  placeName?: string
}

function restKey(): string {
  const key = process.env.KAKAO_REST_KEY
  if (!key) throw new Error('환경변수 KAKAO_REST_KEY 가 설정되지 않았습니다.')
  return key
}

// ── 동시 실행 제한 ─────────────────────────────────────────────────────────
let active = 0
const queue: Array<() => void> = []

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => queue.push(resolve))
  }
  active++
  try {
    return await task()
  } finally {
    active--
    queue.shift()?.()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface KakaoDocument {
  x?: string
  y?: string
  address_name?: string
  place_name?: string
  road_address_name?: string
  road_address?: { address_name?: string } | null
  address?: { address_name?: string } | null
}

async function callKakao(path: string, query: string, size: number): Promise<KakaoDocument[]> {
  const url = `${KAKAO_BASE}/${path}.json?query=${encodeURIComponent(query)}&size=${size}`

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await withSlot(() =>
      fetch(url, { headers: { Authorization: `KakaoAK ${restKey()}` } }),
    )

    if (response.ok) {
      const body = (await response.json()) as { documents?: KakaoDocument[] }
      return body.documents ?? []
    }

    // 429(호출 제한)와 5xx 는 재시도, 그 외는 즉시 포기
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`Kakao ${path} 응답 ${response.status}`)
    }
    if (attempt === MAX_RETRIES) {
      throw new Error(`Kakao ${path} 재시도 초과 (${response.status})`)
    }
    await sleep(2 ** attempt * 500)
  }

  return []
}

function toCandidate(doc: KakaoDocument): GeocodeCandidate | null {
  const lat = Number.parseFloat(doc.y ?? '')
  const lng = Number.parseFloat(doc.x ?? '')
  if (!isValidCoordinate(lat, lng)) return null

  const address =
    doc.road_address?.address_name ??
    doc.road_address_name ??
    doc.address?.address_name ??
    doc.address_name ??
    ''

  const candidate: GeocodeCandidate = { lat, lng, address }
  if (doc.place_name) candidate.placeName = doc.place_name
  return candidate
}

/**
 * 주소 후보 목록. 사용자가 고르게 할 때 쓴다 (§5-2 경로 B).
 *
 * 주소 검색을 먼저 하고, 결과가 없으면 키워드 검색으로 넘어간다.
 * "수원 영통" 처럼 행정구역만 입력한 경우는 키워드 검색이 잡아준다.
 */
export async function geocodeCandidates(query: string, limit = 3): Promise<GeocodeCandidate[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const seen = new Set<string>()
  const results: GeocodeCandidate[] = []

  for (const path of ['address', 'keyword'] as const) {
    const documents = await callKakao(path, trimmed, Math.min(limit * 2, 15))

    for (const doc of documents) {
      const candidate = toCandidate(doc)
      if (!candidate) continue

      const key = `${candidate.lat.toFixed(6)},${candidate.lng.toFixed(6)}`
      if (seen.has(key)) continue

      seen.add(key)
      results.push(candidate)
      if (results.length >= limit) return results
    }
  }

  return results
}

/**
 * 단건 지오코딩. 캐시를 먼저 보고, 결과는 캐시에 남긴다.
 * 관리자 저장·CSV 이관처럼 "가장 그럴듯한 한 곳"만 필요할 때 쓴다.
 */
export async function geocodeOne(query: string): Promise<GeocodeCandidate | null> {
  const trimmed = query.trim()
  if (!trimmed) return null

  const cacheKey = normalizeText(trimmed)
  const db = supabaseService()

  const { data: cached } = await db
    .from('geocode_cache')
    .select('lat, lng, road_address')
    .eq('q', cacheKey)
    .maybeSingle()

  if (cached) {
    return {
      lat: cached.lat as number,
      lng: cached.lng as number,
      address: (cached.road_address as string | null) ?? trimmed,
    }
  }

  const [best] = await geocodeCandidates(trimmed, 1)
  if (!best) return null

  await db.from('geocode_cache').upsert(
    { q: cacheKey, lat: best.lat, lng: best.lng, road_address: best.address },
    { onConflict: 'q' },
  )

  return best
}
