/**
 * PATCH /api/admin/products/:id — 수정 (비활성화 포함)
 * 설계문서 §7, §9-1
 */

import { requireAdmin } from '@/lib/admin-auth'
import { apiError, handleUnexpected, json, UNIQUE_VIOLATION } from '@/lib/http'
import { deriveProductFields } from '@/lib/search'
import { supabaseService } from '@/lib/supabase'
import { adminProductSchema, productIdSchema } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const admin = await requireAdmin()

    const { id } = await context.params
    const parsedId = productIdSchema.safeParse(id)
    if (!parsedId.success) return apiError(request, 'INVALID_INPUT')

    const parsed = adminProductSchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(request, 'INVALID_INPUT', {
        message: parsed.error.issues[0]?.message ?? '입력값을 확인해주세요.',
      })
    }

    const input = parsed.data
    const { data, error } = await supabaseService()
      .from('products')
      .update({
        name: input.name,
        ...deriveProductFields(input.name),
        package_size: input.packageSize,
        category: input.category,
        info_url: input.infoUrl ?? null,
        info_text: input.infoText,
        aliases: input.aliases,
        is_active: input.isActive,
        updated_by: admin.id,
      })
      .eq('id', parsedId.data)
      .select('id')
      .maybeSingle()

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return apiError(request, 'CONFLICT', { message: '같은 이름의 제품이 이미 있습니다.' })
      }
      throw new Error(error.message)
    }
    if (!data) return apiError(request, 'NOT_FOUND')

    return json(request, { id: data.id })
  } catch (error) {
    return handleUnexpected(request, error, 'admin/products PATCH')
  }
}
