/**
 * GET /api/geocode?q=
 * Kakao Local API 프록시 (설계문서 §5-2 경로 B, §7)
 *
 * REST 키를 서버에만 두기 위한 프록시다. 주소 후보를 최대 3건 돌려주고,
 * 여러 건이면 위젯이 사용자에게 선택지를 보여준다.
 */

import { apiError, clientIp, handleUnexpected, json, preflight } from '@/lib/http'
import { geocodeCandidates } from '@/lib/geocode'
import { checkRateLimit } from '@/lib/ratelimit'
import { geocodeQuerySchema } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_CANDIDATES = 3

export function OPTIONS(request: Request): Response {
  return preflight(request)
}

export async function GET(request: Request): Promise<Response> {
  const rate = await checkRateLimit('geocode', clientIp(request))
  if (!rate.allowed) {
    return apiError(request, 'RATE_LIMITED', {
      headers: { 'Retry-After': String(rate.retryAfterSeconds ?? 60) },
    })
  }

  const url = new URL(request.url)
  const parsed = geocodeQuerySchema.safeParse({ q: url.searchParams.get('q') ?? '' })
  if (!parsed.success) {
    return apiError(request, 'INVALID_INPUT', {
      message: parsed.error.issues[0]?.message ?? '주소를 확인해주세요.',
    })
  }

  try {
    const candidates = await geocodeCandidates(parsed.data.q, MAX_CANDIDATES)

    return json(request, {
      query: parsed.data.q,
      candidates: candidates.map((c) => ({
        lat: c.lat,
        lng: c.lng,
        address: c.address,
        placeName: c.placeName ?? null,
      })),
      // 0건이어도 에러가 아니다. 위젯이 재입력을 안내한다 (§13)
      found: candidates.length > 0,
    })
  } catch (error) {
    return handleUnexpected(request, error, 'geocode')
  }
}
