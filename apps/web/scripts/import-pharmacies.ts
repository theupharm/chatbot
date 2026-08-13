/**
 * 취급처 CSV 일괄 이관 (설계문서 §4-1, §9-3, §12 Phase 6)
 *
 *   npm run import:pharmacies --workspace @theu/web -- ../../data/raw/pharmacies.csv --dry-run
 *   npm run import:pharmacies --workspace @theu/web -- ../../data/raw/pharmacies.csv
 *
 * 옵션
 *   --dry-run        DB 에 쓰지 않고 리포트만 낸다
 *   --no-geocode     좌표 없는 행을 지오코딩하지 않는다 (Kakao 호출 0회)
 *   --limit=N        앞의 N 행만 처리 (점검용)
 *
 * 원본 CSV 컬럼: product, name, address, phone, lat, lng
 * 좌표가 이미 있으므로 지오코딩은 좌표가 빈 행에만 발생한다.
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadEnvFile } from './_env'
import { headerIndex, parseCsv } from '../lib/csv'
import {
  buildProductLinks,
  dedupePharmacies,
  parseRows,
  type DedupedPharmacy,
  type RawRow,
  type RowIssue,
} from '../lib/pharmacy-import'
import { buildProductMaster } from '../lib/product-name'
import { deriveProductFields } from '../lib/search'
import { normalizeProductName } from '../lib/normalize'

loadEnvFile()

const UPSERT_CHUNK = 500

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const REQUIRED_COLUMNS = ['product', 'name', 'address', 'phone', 'lat', 'lng'] as const

function toRawRows(table: string[][]): RawRow[] {
  const header = table[0]
  if (!header) fail('CSV 가 비어 있습니다.')

  const index = headerIndex(header)
  const missing = REQUIRED_COLUMNS.filter((c) => index[c] === undefined)
  if (missing.length > 0) {
    fail(`CSV 컬럼이 없습니다: ${missing.join(', ')} (헤더: ${header.join(', ')})`)
  }

  return table.slice(1).map((cells) => ({
    product: cells[index.product!] ?? '',
    name: cells[index.name!] ?? '',
    address: cells[index.address!] ?? '',
    phone: cells[index.phone!] ?? '',
    lat: cells[index.lat!] ?? '',
    lng: cells[index.lng!] ?? '',
  }))
}

async function chunkedUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  const { supabaseService } = await import('../lib/supabase')
  const db = supabaseService()

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const slice = rows.slice(i, i + UPSERT_CHUNK)
    const { error } = await db.from(table).upsert(slice, { onConflict })
    if (error) fail(`${table} 업서트 실패 (${i}~${i + slice.length}행): ${error.message}`)
    process.stdout.write(`\r  ${table}: ${Math.min(i + slice.length, rows.length)}/${rows.length}`)
  }
  process.stdout.write('\n')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const noGeocode = args.includes('--no-geocode')
  const limitArg = args.find((a) => a.startsWith('--limit='))
  const limit = limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '', 10) : undefined
  const csvArg = args.find((a) => !a.startsWith('--'))

  if (!csvArg) fail('CSV 파일 경로를 인자로 넘겨주세요.')

  const csvPath = path.resolve(process.cwd(), csvArg)
  const text = await readFile(csvPath, 'utf8')
  let raws = toRawRows(parseCsv(text))
  if (limit && limit > 0) raws = raws.slice(0, limit)

  console.log(`CSV: ${csvPath}`)
  console.log(`원본 행수: ${raws.length}`)
  console.log('')

  // 1) 파싱·검증 -----------------------------------------------------------
  const { rows, rejected, warnings } = parseRows(raws)
  const pharmacies = dedupePharmacies(rows)
  const links = buildProductLinks(rows)

  console.log('── 파싱')
  console.log(`  유효 행        : ${rows.length}`)
  console.log(`  반려 행        : ${rejected.length}`)
  console.log(`  경고           : ${warnings.length}`)
  console.log(`  고유 취급처    : ${pharmacies.length}`)
  console.log(`  제품(원본 표기): ${links.size}`)
  console.log('')

  const byType = pharmacies.reduce<Record<string, number>>((acc, p) => {
    acc[p.orgType] = (acc[p.orgType] ?? 0) + 1
    return acc
  }, {})
  console.log('── 기관 유형')
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(10)} ${count}`)
  }
  console.log('')

  // 2) 제품 마스터 ---------------------------------------------------------
  const master = buildProductMaster([...links.keys()], normalizeProductName)
  console.log('── 제품 마스터')
  for (const product of master) {
    const size = product.packageSize ? ` [${product.packageSize}]` : ''
    const merged = product.sourceNames.length > 1 ? `  ← ${product.sourceNames.length}개 표기 통합` : ''
    console.log(`  ${product.name}${size}${merged}`)
  }
  console.log('')

  // 3) 좌표 없는 취급처 지오코딩 -------------------------------------------
  const needGeocode = pharmacies.filter((p) => p.lat === null)
  const geocodeFailures: RowIssue[] = []

  if (needGeocode.length > 0 && !noGeocode) {
    console.log(`── 지오코딩 (좌표 없는 취급처 ${needGeocode.length}곳)`)
    const { geocodeOne } = await import('../lib/geocode')

    let done = 0
    await Promise.all(
      needGeocode.map(async (pharmacy) => {
        // 주소가 있으면 주소로, 없으면 "지역 + 상호" 키워드로 찾는다
        const query = pharmacy.address || [pharmacy.regionHint, pharmacy.name].filter(Boolean).join(' ')
        try {
          const found = await geocodeOne(query)
          if (found) {
            pharmacy.lat = found.lat
            pharmacy.lng = found.lng
            if (!pharmacy.address) pharmacy.address = found.address
          }
        } catch (error) {
          geocodeFailures.push({
            rowNumber: pharmacy.rowNumbers[0] ?? 0,
            name: pharmacy.name,
            reason: `지오코딩 오류: ${error instanceof Error ? error.message : String(error)}`,
          })
        } finally {
          done++
          process.stdout.write(`\r  ${done}/${needGeocode.length}`)
        }
      }),
    )
    process.stdout.write('\n')

    const stillMissing = needGeocode.filter((p) => p.lat === null).length
    console.log(`  좌표 확보: ${needGeocode.length - stillMissing} / 실패: ${stillMissing}`)
    console.log('')
  } else if (needGeocode.length > 0) {
    console.log(`── 지오코딩 건너뜀 (--no-geocode). 좌표 없는 취급처 ${needGeocode.length}곳은 반려됩니다.`)
    console.log('')
  }

  // 4) 좌표 없는 취급처은 저장 불가 (DB lat/lng NOT NULL) -------------------
  const storable = pharmacies.filter((p) => p.lat !== null && p.lng !== null)
  const unstorable = pharmacies.filter((p) => p.lat === null || p.lng === null)

  for (const pharmacy of unstorable) {
    rejected.push({
      rowNumber: pharmacy.rowNumbers[0] ?? 0,
      name: pharmacy.name,
      reason: `좌표를 확보하지 못했습니다 (주소: ${pharmacy.address || '없음'})`,
    })
  }

  // 5) 리포트 파일 ---------------------------------------------------------
  const reportPath = path.resolve(path.dirname(csvPath), 'import-report.csv')
  const allIssues = [
    ...rejected.map((i) => ({ ...i, kind: '반려' })),
    ...geocodeFailures.map((i) => ({ ...i, kind: '반려' })),
    ...warnings.map((i) => ({ ...i, kind: '경고' })),
  ].sort((a, b) => a.rowNumber - b.rowNumber)

  if (allIssues.length > 0) {
    const csv = [
      '구분,원본행번호,취급처명,사유',
      ...allIssues.map(
        (i) => `${i.kind},${i.rowNumber},"${i.name.replace(/"/g, '""')}","${i.reason.replace(/"/g, '""')}"`,
      ),
    ].join('\n')
    await writeFile(reportPath, `﻿${csv}`, 'utf8')
    console.log(`── 리포트: ${reportPath} (반려 ${rejected.length + geocodeFailures.length} / 경고 ${warnings.length})`)
    console.log('')
  }

  console.log('── 저장 예정')
  console.log(`  제품          : ${master.length}`)
  console.log(`  취급처        : ${storable.length}`)
  console.log(`  제품-취급처 매핑: ${countLinks(links, storable)}`)
  console.log('')

  if (dryRun) {
    console.log('--dry-run 이므로 DB 에 반영하지 않았습니다.')
    return
  }

  // 6) 저장 ----------------------------------------------------------------
  const { supabaseService } = await import('../lib/supabase')
  const db = supabaseService()

  console.log('── DB 반영')

  await chunkedUpsert(
    'products',
    master.map((product) => ({
      name: product.name,
      ...deriveProductFields(product.name),
      package_size: product.packageSize,
      aliases: product.aliases,
      is_active: true,
    })),
    'name_norm',
  )

  await chunkedUpsert(
    'pharmacies',
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
    'name_norm,address_norm',
  )

  // id 조회 후 매핑 생성
  const productIdByNorm = await fetchIdMap(db, 'products', 'name_norm')
  const pharmacyIdByKey = await fetchPharmacyIdMap(db)

  const mappings: Array<{ pharmacy_id: number; product_id: number }> = []
  const storableKeys = new Set(storable.map((p) => p.key))

  for (const [rawProductName, keys] of links) {
    const product = master.find((m) => m.sourceNames.includes(rawProductName))
    const productId = product ? productIdByNorm.get(product.nameNorm) : undefined
    if (!productId) continue

    for (const key of keys) {
      if (!storableKeys.has(key)) continue
      const pharmacyId = pharmacyIdByKey.get(key)
      if (pharmacyId) mappings.push({ pharmacy_id: pharmacyId, product_id: productId })
    }
  }

  const uniqueMappings = [
    ...new Map(mappings.map((m) => [`${m.pharmacy_id}:${m.product_id}`, m])).values(),
  ]
  await chunkedUpsert('pharmacy_products', uniqueMappings, 'pharmacy_id,product_id')

  console.log('')
  console.log(`✓ 제품 ${master.length} / 취급처 ${storable.length} / 매핑 ${uniqueMappings.length} 반영 완료`)
}

function countLinks(links: Map<string, Set<string>>, storable: DedupedPharmacy[]): number {
  const keys = new Set(storable.map((p) => p.key))
  let total = 0
  for (const set of links.values()) {
    for (const key of set) if (keys.has(key)) total++
  }
  return total
}

/** 페이지네이션으로 전체 id 를 가져온다 (PostgREST 기본 1000건 제한 회피) */
async function fetchAll(
  db: Awaited<ReturnType<typeof import('../lib/supabase')['supabaseService']>>,
  table: string,
  columns: string,
): Promise<Record<string, unknown>[]> {
  const pageSize = 1000
  const all: Record<string, unknown>[] = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db.from(table).select(columns).range(from, from + pageSize - 1)
    if (error) fail(`${table} 조회 실패: ${error.message}`)
    const page = (data ?? []) as unknown as Record<string, unknown>[]
    all.push(...page)
    if (page.length < pageSize) break
  }

  return all
}

async function fetchIdMap(
  db: Awaited<ReturnType<typeof import('../lib/supabase')['supabaseService']>>,
  table: string,
  keyColumn: string,
): Promise<Map<string, number>> {
  const rows = await fetchAll(db, table, `id, ${keyColumn}`)
  return new Map(rows.map((r) => [String(r[keyColumn]), Number(r.id)]))
}

async function fetchPharmacyIdMap(
  db: Awaited<ReturnType<typeof import('../lib/supabase')['supabaseService']>>,
): Promise<Map<string, number>> {
  const rows = await fetchAll(db, 'pharmacies', 'id, name_norm, address_norm')
  return new Map(rows.map((r) => [`${String(r.name_norm)}|${String(r.address_norm)}`, Number(r.id)]))
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
