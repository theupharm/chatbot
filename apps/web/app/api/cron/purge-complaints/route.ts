/**
 * 개인정보 파기 배치 (설계문서 §8 보관·파기 정책)
 *
 * ⚠️ **법무 확정 전에는 실행되지 않는다.**
 *    `config/site.json` 의 `privacy.reviewed` 가 true 가 되기 전까지 아무것도 지우지 않는다.
 *    보관기간이 확정되지 않은 상태에서 데이터를 지우면 되돌릴 수 없기 때문이다.
 *
 * 정책
 *   - 일반 불만: 처리 완료(status = done) 후 보관기간이 지나면 연락처 삭제·내용 마스킹
 *   - 이상사례 의심 건: **자동 파기 대상에서 제외**. 약물감시 규정에 따라 PV 팀이 판단한다
 *   - 통계용으로 행 자체는 남기고 개인정보 필드만 지운다
 *
 * 인증: Vercel Cron 이 붙여주는 CRON_SECRET 헤더로 확인한다.
 */

import { apiError, handleUnexpected, json } from '@/lib/http'
import { PRIVACY } from '@/lib/site-config'
import { supabaseService } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 일반 불만 보관기간(일). 법무 확정 시 config 로 옮긴다 */
const RETENTION_DAYS = 365 * 3

const PURGED_TEXT = '(보관기간 경과로 파기됨)'

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return apiError(request, 'UNAUTHORIZED')

  if (!PRIVACY.reviewed) {
    return json(request, {
      skipped: true,
      reason:
        '개인정보 보관·파기 정책이 법무 확인 전입니다. config/site.json 의 privacy.reviewed 가 true 가 되기 전에는 파기하지 않습니다.',
    })
  }

  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabaseService()
      .from('complaints')
      .update({ contact: '', content: PURGED_TEXT, purged_at: new Date().toISOString() })
      .eq('status', 'done')
      // 이상사례 의심 건은 건드리지 않는다 (§8)
      .eq('is_ae_suspect', false)
      .is('purged_at', null)
      .lt('created_at', cutoff)
      .select('id')

    if (error) throw new Error(error.message)

    const purged = data?.length ?? 0
    console.log(`[cron] 개인정보 파기 ${purged}건 (기준일 ${cutoff})`)

    return json(request, { skipped: false, purged, cutoff })
  } catch (error) {
    return handleUnexpected(request, error, 'cron/purge-complaints')
  }
}
