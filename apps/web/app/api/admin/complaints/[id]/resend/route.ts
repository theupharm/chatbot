/**
 * POST /api/admin/complaints/:id/resend — 접수 메일 재발송
 *
 * 설계문서 §9-4. 메일이 실패한 건(`email_sent = false`)을 담당자가 다시 보낼 수 있게 한다.
 * 이미 성공한 건도 재발송할 수 있다 — 수신자가 메일을 못 찾는 경우가 있기 때문이다.
 */

import { requireAdmin } from '@/lib/admin-auth'
import { apiError, handleUnexpected, json } from '@/lib/http'
import { sendComplaintMail } from '@/lib/mail'
import { supabaseService } from '@/lib/supabase'
import { productIdSchema } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const admin = await requireAdmin()

    const { id } = await context.params
    const parsedId = productIdSchema.safeParse(id)
    if (!parsedId.success) return apiError(request, 'INVALID_INPUT')

    const db = supabaseService()
    const { data, error } = await db
      .from('complaints')
      .select(
        'id, ticket_no, org_name, region, content, contact, product_id, is_ae_suspect, ae_keywords, created_at, purged_at',
      )
      .eq('id', parsedId.data)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!data) return apiError(request, 'NOT_FOUND')

    // 개인정보가 파기된 건은 다시 보낼 내용이 없다 (§8 보관·파기 정책)
    if (data.purged_at) {
      return apiError(request, 'INVALID_INPUT', {
        message: '개인정보가 파기된 건이라 재발송할 수 없습니다.',
      })
    }

    let productName: string | null = null
    if (data.product_id) {
      const { data: product } = await db
        .from('products')
        .select('name')
        .eq('id', data.product_id)
        .maybeSingle()
      productName = (product?.name as string | undefined) ?? null
    }

    const result = await sendComplaintMail({
      ticketNo: String(data.ticket_no),
      orgName: String(data.org_name),
      region: String(data.region),
      content: String(data.content),
      contact: String(data.contact),
      productName,
      isAeSuspect: Boolean(data.is_ae_suspect),
      aeKeywords: (data.ae_keywords as string[] | null) ?? [],
      createdAt: new Date(String(data.created_at)),
    })

    await db
      .from('complaints')
      .update({ email_sent: result.sent, email_error: result.error ?? null, updated_by: admin.id })
      .eq('id', data.id)

    if (!result.sent) {
      // 접수 내용은 로그에 남기지 않는다 (§13)
      console.error(`[admin] ${String(data.ticket_no)} 재발송 실패: ${result.error}`)
      return apiError(request, 'INTERNAL', {
        message: `재발송에 실패했습니다: ${result.error ?? '알 수 없는 오류'}`,
      })
    }

    return json(request, { sent: true, to: result.to ?? [] })
  } catch (error) {
    return handleUnexpected(request, error, 'admin/complaints resend')
  }
}
