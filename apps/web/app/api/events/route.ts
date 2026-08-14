/**
 * POST /api/events — 이용 통계 이벤트 수집 (설계문서 §9-5)
 *
 * 위젯이 분기 선택·제품 검색 같은 동작을 알려준다.
 *
 * 남기지 않는 것 (§13)
 *   · 사용자 위치 좌표 — 스키마에 아예 없다
 *   · IP·브라우저 정보 — 레이트리밋 판정에만 쓰고 저장하지 않는다
 *   · 검색어 — **결과가 0건인 경우에만** 남긴다. 별칭을 무엇으로 넣을지 알기 위한 것이고,
 *     결과가 나온 검색어는 통계상 가치가 낮아 버린다
 *
 * 통계 때문에 챗봇이 느려지면 안 되므로, 실패해도 위젯은 신경 쓰지 않는다.
 * 여기서는 항상 202 를 돌려주고 오류는 서버 로그로만 남긴다.
 */

import { apiError, clientIp, json, preflight } from '@/lib/http'
import { normalizeText } from '@/lib/normalize'
import { checkRateLimit } from '@/lib/ratelimit'
import { supabaseService } from '@/lib/supabase'
import { usageEventBatchSchema } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 이벤트는 조회보다 자주 들어온다. 한 대화에서 나올 만한 양보다 넉넉히 잡는다 */
const EVENT_LIMIT = { requests: 120, windowSeconds: 60 }

export function OPTIONS(request: Request): Response {
  return preflight(request)
}

export async function POST(request: Request): Promise<Response> {
  const rate = await checkRateLimit('events', clientIp(request), EVENT_LIMIT)
  if (!rate.allowed) {
    // 통계는 유실돼도 서비스에 지장이 없다. 조용히 넘긴다.
    return json(request, { accepted: 0 }, { status: 202 })
  }

  try {
    const parsed = usageEventBatchSchema.safeParse(await request.json())
    if (!parsed.success) return apiError(request, 'INVALID_INPUT')

    const rows = parsed.data.events.map((event) => ({
      session_id: event.sessionId,
      event_type: event.type,
      branch: event.branch ?? null,
      product_id: event.productId ?? null,
      // 0건 검색어만 저장한다. 그 외에는 버린다.
      query:
        event.type === 'product_search' && event.resultCount === 0 && event.query
          ? normalizeText(event.query).slice(0, 40) || null
          : null,
      sido: event.sido ?? null,
      result_count: event.resultCount ?? null,
    }))

    const { error } = await supabaseService().from('usage_events').insert(rows)
    if (error) throw new Error(error.message)

    return json(request, { accepted: rows.length }, { status: 202 })
  } catch (error) {
    // 통계 실패가 사용자 경험을 건드리면 안 된다
    console.error('[events] 기록 실패:', error instanceof Error ? error.message : error)
    return json(request, { accepted: 0 }, { status: 202 })
  }
}
