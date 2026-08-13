/**
 * GET  /api/admin/products  — 목록 (검색·페이지네이션)
 * POST /api/admin/products  — 등록
 *
 * 설계문서 §7, §9-1
 */

import { requireAdmin } from '@/lib/admin-auth'
import { apiError, handleUnexpected, json, UNIQUE_VIOLATION } from '@/lib/http'
import { normalizeText } from '@/lib/normalize'
import { deriveProductFields } from '@/lib/search'
import { supabaseService } from '@/lib/supabase'
import { adminListQuerySchema, adminProductSchema } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COLUMNS =
  'id, name, name_norm, package_size, category, aliases, info_url, info_text, is_active, updated_at'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin()

    const url = new URL(request.url)
    const parsed = adminListQuerySchema.safeParse({
      q: url.searchParams.get('q') ?? undefined,
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    })
    if (!parsed.success) return apiError(request, 'INVALID_INPUT')

    const { q, page, pageSize } = parsed.data
    const from = (page - 1) * pageSize

    let query = supabaseService()
      .from('products')
      .select(COLUMNS, { count: 'exact' })
      .order('name', { ascending: true })
      .range(from, from + pageSize - 1)

    // 정규화한 값으로 찾아야 "닥터 로반" 같은 입력도 걸린다
    if (q) query = query.ilike('name_norm', `%${normalizeText(q)}%`)

    const { data, error, count } = await query
    if (error) throw new Error(error.message)

    return json(request, { items: data ?? [], total: count ?? 0, page, pageSize })
  } catch (error) {
    return handleUnexpected(request, error, 'admin/products GET')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const admin = await requireAdmin()

    const parsed = adminProductSchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(request, 'INVALID_INPUT', {
        message: parsed.error.issues[0]?.message ?? '입력값을 확인해주세요.',
      })
    }

    const input = parsed.data
    const { data, error } = await supabaseService()
      .from('products')
      // 파생 필드는 클라이언트 입력을 믿지 않고 서버에서 만든다 (§13)
      .insert({
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
      .select('id')
      .single()

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return apiError(request, 'CONFLICT', { message: '같은 이름의 제품이 이미 있습니다.' })
      }
      throw new Error(error.message)
    }

    return json(request, { id: data?.id }, { status: 201 })
  } catch (error) {
    return handleUnexpected(request, error, 'admin/products POST')
  }
}
