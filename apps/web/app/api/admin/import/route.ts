/**
 * POST /api/admin/import — CSV 청크 업로드 (설계문서 §7, §9-3)
 *
 * 브라우저가 CSV 를 파싱해 200행 단위로 나눠 보낸다. 서버 함수 실행시간 제한 안에
 * 수천 행을 한 번에 처리할 수 없기 때문이다.
 *
 * 처리 순서
 *   1. 행 검증·정규화 (이관 스크립트와 같은 lib/pharmacy-import 사용)
 *   2. 청크 안에서 취급처 중복 제거
 *   3. 좌표가 빈 행만 지오코딩 (원본에 좌표가 있으면 Kakao 호출 0회)
 *   4. upsert — 청크 경계를 넘는 중복은 unique 제약이 흡수한다
 *   5. 제품-취급처 매핑 upsert
 *   6. 행 번호가 붙은 리포트 반환
 */

import { requireAdmin } from '@/lib/admin-auth'
import { apiError, handleUnexpected, json } from '@/lib/http'
import {
  dedupePharmacies,
  parseRows,
  type RawRow,
  type RowIssue,
} from '@/lib/pharmacy-import'
import { supabaseService } from '@/lib/supabase'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_ROWS = 200

const rowSchema = z.object({
  product: z.string().max(200),
  name: z.string().max(200),
  address: z.string().max(300),
  phone: z.string().max(60),
  lat: z.string().max(40),
  lng: z.string().max(40),
})

const chunkSchema = z.object({
  /** 이 청크 첫 행의 원본 행 번호 (헤더 제외, 1부터). 리포트에 그대로 쓴다 */
  startRow: z.coerce.number().int().min(1),
  rows: z.array(rowSchema).min(1).max(MAX_ROWS),
  /** true 면 검증만 하고 저장하지 않는다 */
  dryRun: z.boolean().default(false),
})

export interface ImportChunkResult {
  saved: number
  mappings: number
  rejected: RowIssue[]
  warnings: RowIssue[]
  geocoded: number
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdmin()

    const parsed = chunkSchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(request, 'INVALID_INPUT', {
        message: `업로드 형식이 올바르지 않습니다. 한 번에 최대 ${MAX_ROWS}행까지 보낼 수 있습니다.`,
      })
    }

    const { startRow, rows: rawRows, dryRun } = parsed.data

    // 1~2) 검증·정규화·중복 제거
    const { rows, rejected, warnings } = parseRows(rawRows as RawRow[])
    const pharmacies = dedupePharmacies(rows)

    // 리포트의 행 번호를 원본 기준으로 되돌린다
    const offset = startRow - 1
    const shift = (issue: RowIssue): RowIssue => ({ ...issue, rowNumber: issue.rowNumber + offset })

    // 3) 좌표 없는 곳만 지오코딩
    let geocoded = 0
    const needGeocode = pharmacies.filter((p) => p.lat === null)
    if (needGeocode.length > 0) {
      const { geocodeOne } = await import('@/lib/geocode')
      await Promise.all(
        needGeocode.map(async (pharmacy) => {
          const query =
            pharmacy.address || [pharmacy.regionHint, pharmacy.name].filter(Boolean).join(' ')
          try {
            const found = await geocodeOne(query)
            if (found) {
              pharmacy.lat = found.lat
              pharmacy.lng = found.lng
              if (!pharmacy.address) pharmacy.address = found.address
              geocoded++
            }
          } catch {
            // 개별 실패는 아래에서 "좌표 없음"으로 반려된다
          }
        }),
      )
    }

    const storable = pharmacies.filter((p) => p.lat !== null && p.lng !== null)
    for (const pharmacy of pharmacies) {
      if (pharmacy.lat === null || pharmacy.lng === null) {
        rejected.push({
          rowNumber: pharmacy.rowNumbers[0] ?? 0,
          name: pharmacy.name,
          reason: `좌표를 확보하지 못했습니다 (주소: ${pharmacy.address || '없음'})`,
        })
      }
    }

    const result: ImportChunkResult = {
      saved: storable.length,
      mappings: 0,
      rejected: rejected.map(shift),
      warnings: warnings.map(shift),
      geocoded,
    }

    if (dryRun || storable.length === 0) {
      return json(request, result)
    }

    // 4) 취급처 upsert
    const db = supabaseService()
    const { error: upsertError } = await db.from('pharmacies').upsert(
      storable.map((pharmacy) => ({
        name: pharmacy.name,
        name_norm: pharmacy.nameNorm,
        org_type: pharmacy.orgType,
        address: pharmacy.address,
        address_norm: pharmacy.addressNorm,
        sido: pharmacy.sido,
        sigungu: pharmacy.sigungu,
        phone: pharmacy.phone,
        lat: pharmacy.lat,
        lng: pharmacy.lng,
        is_active: true,
      })),
      { onConflict: 'name_norm,address_norm' },
    )
    if (upsertError) throw new Error(upsertError.message)

    // 5) 제품-취급처 매핑
    const productNames = [...new Set(rows.map((row) => row.productName))]
    const { data: products, error: productError } = await db
      .from('products')
      .select('id, name')
      .in('name', productNames)
    if (productError) throw new Error(productError.message)

    const productIdByName = new Map(
      (products ?? []).map((p) => [String(p.name), Number(p.id)] as const),
    )

    // 이름이 안 맞는 제품은 매핑을 만들 수 없다. 담당자가 알아야 하므로 경고로 남긴다.
    for (const name of productNames) {
      if (!productIdByName.has(name)) {
        const row = rows.find((r) => r.productName === name)
        result.warnings.push({
          rowNumber: (row?.rowNumber ?? 0) + offset,
          name,
          reason: `등록되지 않은 제품명이라 취급 제품 연결을 건너뜁니다: ${name}`,
        })
      }
    }

    const keys = storable.map((p) => p.key)
    const { data: saved, error: idError } = await db
      .from('pharmacies')
      .select('id, name_norm, address_norm')
      .in(
        'name_norm',
        [...new Set(storable.map((p) => p.nameNorm))],
      )
    if (idError) throw new Error(idError.message)

    const idByKey = new Map<string, number>(
      (saved ?? []).map((row) => [
        `${String(row.name_norm)}|${String(row.address_norm)}`,
        Number(row.id),
      ]),
    )

    const mappings: Array<{ pharmacy_id: number; product_id: number }> = []
    for (const row of rows) {
      if (!keys.includes(row.key)) continue
      const pharmacyId = idByKey.get(row.key)
      const productId = productIdByName.get(row.productName)
      if (pharmacyId && productId) mappings.push({ pharmacy_id: pharmacyId, product_id: productId })
    }

    const unique = [
      ...new Map(mappings.map((m) => [`${m.pharmacy_id}:${m.product_id}`, m])).values(),
    ]

    if (unique.length > 0) {
      const { error: mapError } = await db
        .from('pharmacy_products')
        .upsert(unique, { onConflict: 'pharmacy_id,product_id' })
      if (mapError) throw new Error(mapError.message)
    }

    result.mappings = unique.length
    return json(request, result)
  } catch (error) {
    return handleUnexpected(request, error, 'admin/import')
  }
}
