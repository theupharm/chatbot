/**
 * GET /api/admin/import/template — 업로드용 CSV 템플릿 (설계문서 §9-3)
 *
 * 기존 스프레드시트 컬럼 구조를 그대로 쓴다. 담당자가 시트를 CSV 로 내보내
 * 헤더만 맞으면 바로 올릴 수 있게 하려는 것이다.
 */

import { requireAdmin } from '@/lib/admin-auth'
import { handleUnexpected } from '@/lib/http'
import { TEMPLATE_CSV } from '@/lib/import-mapping'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin()

    // 엑셀이 UTF-8 로 인식하도록 BOM 을 붙인다
    return new Response(`﻿${TEMPLATE_CSV}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="theu-chatbot-취급처-템플릿.csv"',
      },
    })
  } catch (error) {
    return handleUnexpected(request, error, 'admin/import/template')
  }
}
