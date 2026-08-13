/**
 * 제품 안내 문구 이관 (설계문서 §6 [제품정보] 분기)
 *
 *   npm run import:product-info --workspace @theu/web -- ../../data/raw/product-info.csv --dry-run
 *   npm run import:product-info --workspace @theu/web -- ../../data/raw/product-info.csv
 *
 * 원본 CSV 컬럼: name, answer
 * 예외 처리 규칙은 fixtures/product-info-rules.json 에 있다.
 *
 * 안내 문구는 사전 승인된 텍스트다. 요약·재작성 없이 원문 그대로 옮긴다 (§13).
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadEnvFile } from './_env'
import { parseCsv } from '../lib/csv'
import { parseProductAnswer, type ProductLink } from '../lib/product-info'
import { normalizeProductName } from '../lib/normalize'
import { deriveProductFields } from '../lib/search'
import rules from '../fixtures/product-info-rules.json'

loadEnvFile()

const UPSERT_CHUNK = 200

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

interface InfoRow {
  /** products.name 으로 쓸 표시명 */
  name: string
  nameNorm: string
  text: string
  links: ProductLink[]
}

interface Issue {
  rowNumber: number
  name: string
  reason: string
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const csvArg = args.find((a) => !a.startsWith('--'))
  if (!csvArg) fail('CSV 파일 경로를 인자로 넘겨주세요.')

  const csvPath = path.resolve(process.cwd(), csvArg)
  const table = parseCsv(await readFile(csvPath, 'utf8'))
  const header = table[0]
  if (!header) fail('CSV 가 비어 있습니다.')

  const nameIdx = header.findIndex((c) => c.trim().toLowerCase() === 'name')
  const answerIdx = header.findIndex((c) => c.trim().toLowerCase() === 'answer')
  if (nameIdx === -1 || answerIdx === -1) {
    fail(`CSV 에 name/answer 컬럼이 필요합니다. (헤더: ${header.join(', ')})`)
  }

  console.log(`CSV: ${csvPath}`)
  console.log(`원본 행수: ${table.length - 1}`)
  console.log('')

  const skip = new Set<string>((rules.skip as string[]).map(normalizeProductName))
  const applyTo = rules.applyTo as Record<string, string[]>

  const byNorm = new Map<string, InfoRow>()
  const issues: Issue[] = []

  table.slice(1).forEach((cells, index) => {
    const rowNumber = index + 1
    const rawName = (cells[nameIdx] ?? '').trim()
    const answer = cells[answerIdx] ?? ''

    if (!rawName) {
      issues.push({ rowNumber, name: '(빈 값)', reason: '제품명이 없습니다' })
      return
    }
    if (!answer.trim()) {
      issues.push({ rowNumber, name: rawName, reason: '안내 문구가 비어 있습니다' })
      return
    }

    const norm = normalizeProductName(rawName)
    if (skip.has(norm)) {
      issues.push({ rowNumber, name: rawName, reason: '통칭 항목이라 제외 (개별 용량 항목이 존재)' })
      return
    }

    const { text, links } = parseProductAnswer(answer)
    if (links.length === 0) {
      issues.push({ rowNumber, name: rawName, reason: '안내 문구에 링크가 없습니다 (본문만 저장)' })
    }

    // 이름 하나를 여러 제품에 적용하는 규칙 (예: 마이모닉액 → 3%/5%)
    const targets = applyTo[rawName] ?? [rawName]

    for (const target of targets) {
      const targetNorm = normalizeProductName(target)
      if (byNorm.has(targetNorm)) {
        issues.push({
          rowNumber,
          name: rawName,
          reason: `이름이 중복되어 건너뜁니다 (먼저 나온 항목을 사용): ${target}`,
        })
        continue
      }
      byNorm.set(targetNorm, { name: target, nameNorm: targetNorm, text, links })
    }
  })

  const rows = [...byNorm.values()]

  console.log('── 파싱')
  console.log(`  저장 대상 : ${rows.length}`)
  console.log(`  건너뜀·경고: ${issues.length}`)
  console.log('')

  const linkCount = rows.reduce((sum, r) => sum + r.links.length, 0)
  console.log(`  링크 총계 : ${linkCount}`)
  console.log(`  링크 없는 제품: ${rows.filter((r) => r.links.length === 0).length}`)
  console.log('')

  console.log('── 샘플')
  const sample = rows[0]
  if (sample) {
    console.log(`  [${sample.name}]`)
    for (const line of sample.text.split('\n')) console.log(`    ${line}`)
    for (const link of sample.links) console.log(`    → ${link.label}: ${link.url.slice(0, 60)}...`)
  }
  console.log('')

  if (issues.length > 0) {
    const reportPath = path.resolve(path.dirname(csvPath), 'product-info-report.csv')
    const csv = [
      '원본행번호,제품명,사유',
      ...issues.map(
        (i) => `${i.rowNumber},"${i.name.replace(/"/g, '""')}","${i.reason.replace(/"/g, '""')}"`,
      ),
    ].join('\n')
    await writeFile(reportPath, `﻿${csv}`, 'utf8')
    console.log(`── 리포트: ${reportPath}`)
    for (const issue of issues) {
      console.log(`  ${issue.rowNumber}행 ${issue.name} — ${issue.reason}`)
    }
    console.log('')
  }

  // 취급처에는 있는데 안내 문구가 없는 제품 확인
  const knownMissing = (rules.knownMissing as string[]) ?? []
  if (knownMissing.length > 0) {
    console.log(`── 안내 문구 없는 제품: ${knownMissing.join(', ')}`)
    console.log('   [제품정보] 분기에서 고객센터 안내로 대체됩니다.')
    console.log('')
  }

  if (dryRun) {
    console.log('--dry-run 이므로 DB 에 반영하지 않았습니다.')
    return
  }

  const { supabaseService } = await import('../lib/supabase')
  const db = supabaseService()

  console.log('── DB 반영')
  const payload = rows.map((row) => ({
    name: row.name,
    ...deriveProductFields(row.name),
    info_text: row.text,
    info_links: row.links,
    info_url: row.links[0]?.url ?? null,
    is_active: true,
  }))

  for (let i = 0; i < payload.length; i += UPSERT_CHUNK) {
    const slice = payload.slice(i, i + UPSERT_CHUNK)
    const { error } = await db.from('products').upsert(slice, { onConflict: 'name_norm' })
    if (error) fail(`products 업서트 실패 (${i}~${i + slice.length}): ${error.message}`)
    process.stdout.write(`\r  products: ${Math.min(i + slice.length, payload.length)}/${payload.length}`)
  }
  process.stdout.write('\n')

  console.log('')
  console.log(`✓ 제품 안내 문구 ${payload.length}건 반영 완료`)
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
