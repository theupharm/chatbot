/**
 * POST /api/complaints
 * 의료인 불만 접수 (설계문서 §8, §7)
 *
 * 처리 순서 (§8-1)
 *   1. AE(이상사례) 의심 키워드 판정
 *   2. DB 저장 — 메일이 실패해도 접수 데이터는 남아야 하므로 저장이 먼저다
 *   3. 메일 발송. AE 의심이면 PV 담당에게도 함께 보낸다
 *   4. 발송 결과를 email_sent / email_error 에 기록
 *   5. 접수번호 반환 — 메일이 실패해도 사용자에게는 접수 완료로 안내한다
 *
 * 개인정보
 *   - 연락처·불만 내용을 로그에 남기지 않는다 (§13)
 *   - 동의(consent) 없이는 저장하지 않는다. 동의 시각을 consent_at 에 기록한다
 */

import { apiError, clientIp, handleUnexpected, json, preflight } from '@/lib/http'
import { detectAdverseEvent } from '@/lib/ae-keywords'
import { sendComplaintMail } from '@/lib/mail'
import { checkRateLimit, SUBMIT_LIMIT } from '@/lib/ratelimit'
import { supabaseService } from '@/lib/supabase'
import { complaintSchema } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 접수번호 충돌(동시 접수) 시 재시도 횟수. 트리거가 당일 일련번호를 세므로 경합이 가능하다 */
const TICKET_RETRIES = 3
const UNIQUE_VIOLATION = '23505'

interface InsertedComplaint {
  id: number
  ticket_no: string
  created_at: string
}

export function OPTIONS(request: Request): Response {
  return preflight(request)
}

export async function POST(request: Request): Promise<Response> {
  const rate = await checkRateLimit('complaints', clientIp(request), SUBMIT_LIMIT)
  if (!rate.allowed) {
    return apiError(request, 'RATE_LIMITED', {
      headers: { 'Retry-After': String(rate.retryAfterSeconds ?? 60) },
    })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError(request, 'INVALID_INPUT')
  }

  const parsed = complaintSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(request, 'INVALID_INPUT', {
      message: parsed.error.issues[0]?.message ?? '입력값을 확인해주세요.',
    })
  }

  const input = parsed.data

  try {
    const db = supabaseService()
    const ae = detectAdverseEvent(input.content)

    // ── 1) 저장 ─────────────────────────────────────────────────────────
    let saved: InsertedComplaint | null = null

    for (let attempt = 0; attempt < TICKET_RETRIES && !saved; attempt++) {
      const { data, error } = await db
        .from('complaints')
        .insert({
          org_name: input.orgName,
          region: input.region,
          content: input.content,
          contact: input.contact,
          product_id: input.productId ?? null,
          is_ae_suspect: ae.isSuspect,
          ae_keywords: ae.matched,
          consent_at: new Date().toISOString(),
        })
        .select('id, ticket_no, created_at')
        .single()

      if (!error) {
        saved = data as InsertedComplaint
        break
      }
      // 접수번호 경합이면 다시 시도, 그 외 오류는 즉시 실패
      if (error.code !== UNIQUE_VIOLATION) throw new Error(error.message)
    }

    if (!saved) throw new Error('접수번호 발번 재시도 초과')

    // ── 2) 메일 발송 ────────────────────────────────────────────────────
    // 제품명은 메일 제목에 쓰인다. 조회 실패는 발송을 막을 이유가 아니다.
    let productName: string | null = null
    if (input.productId) {
      const { data } = await db
        .from('products')
        .select('name')
        .eq('id', input.productId)
        .maybeSingle()
      productName = (data?.name as string | undefined) ?? null
    }

    const mail = await sendComplaintMail({
      ticketNo: saved.ticket_no,
      orgName: input.orgName,
      region: input.region,
      content: input.content,
      contact: input.contact,
      productName,
      isAeSuspect: ae.isSuspect,
      aeKeywords: ae.matched,
      createdAt: new Date(saved.created_at),
    })

    // ── 3) 발송 결과 기록 ───────────────────────────────────────────────
    await db
      .from('complaints')
      .update({ email_sent: mail.sent, email_error: mail.error ?? null })
      .eq('id', saved.id)

    if (!mail.sent) {
      // 주소·사유만 남긴다. 접수 내용은 로그에 넣지 않는다 (§13)
      console.error(`[complaints] ${saved.ticket_no} 메일 발송 실패: ${mail.error}`)
    }

    // 메일 실패는 사용자에게 알리지 않는다. 접수는 완료된 것이고 재발송은 관리자 몫이다 (§8-2)
    return json(request, { ticketNo: saved.ticket_no }, { status: 201 })
  } catch (error) {
    return handleUnexpected(request, error, 'complaints')
  }
}
