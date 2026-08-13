/**
 * GET   /api/admin/complaints/:id — 상세 (연락처 원문 포함)
 * PATCH /api/admin/complaints/:id — 처리 상태 변경
 *
 * 설계문서 §7, §9-4
 */

import { requireAdmin } from '@/lib/admin-auth'
import { apiError, handleUnexpected, json } from '@/lib/http'
import { supabaseService } from '@/lib/supabase'
import { complaintStatusSchema, productIdSchema } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireAdmin()

    const { id } = await context.params
    const parsedId = productIdSchema.safeParse(id)
    if (!parsedId.success) return apiError(request, 'INVALID_INPUT')

    const { data, error } = await supabaseService()
      .from('complaints')
      .select(
        'id, ticket_no, org_name, region, content, contact, product_id, is_ae_suspect, ae_keywords, status, email_sent, email_error, consent_at, created_at',
      )
      .eq('id', parsedId.data)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!data) return apiError(request, 'NOT_FOUND')

    return json(request, data)
  } catch (error) {
    return handleUnexpected(request, error, 'admin/complaints GET one')
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const admin = await requireAdmin()

    const { id } = await context.params
    const parsedId = productIdSchema.safeParse(id)
    if (!parsedId.success) return apiError(request, 'INVALID_INPUT')

    const parsed = complaintStatusSchema.safeParse(await request.json())
    if (!parsed.success) return apiError(request, 'INVALID_INPUT')

    const { data, error } = await supabaseService()
      .from('complaints')
      .update({ status: parsed.data.status, updated_by: admin.id })
      .eq('id', parsedId.data)
      .select('id, status')
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!data) return apiError(request, 'NOT_FOUND')

    return json(request, data)
  } catch (error) {
    return handleUnexpected(request, error, 'admin/complaints PATCH')
  }
}
