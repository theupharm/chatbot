/**
 * 제품 마스터 시드 스크립트
 *
 *   npm run seed:products --workspace @theu/web -- fixtures/products.sample.json
 *   npm run seed:products --workspace @theu/web -- fixtures/products.sample.json --dry-run
 *
 * name_norm / name_jamo / name_chosung 은 여기서 서버 로직으로 생성한다.
 * 관리자 페이지(Phase 5)와 CSV 임포트(Phase 6)도 같은 deriveProductFields 를 쓴다 (§13).
 *
 * 주의: SUPABASE_SERVICE_KEY 를 사용하므로 로컬에서만 실행할 것.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { deriveProductFields } from '../lib/search'
import { loadEnvFile } from './_env'

interface ProductInput {
  name: string
  category?: string | null
  infoUrl?: string | null
  aliases?: string[]
}

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const fixtureArg = args.find((a) => !a.startsWith('--'))

  if (!fixtureArg) {
    fail('제품 JSON 파일 경로를 인자로 넘겨주세요. 예: fixtures/products.sample.json')
  }

  loadEnvFile()

  const raw = await readFile(path.resolve(process.cwd(), fixtureArg), 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) fail('JSON 최상위는 배열이어야 합니다.')

  const rows = (parsed as ProductInput[]).map((item) => {
    if (!item.name || typeof item.name !== 'string') {
      fail(`name 이 없는 항목이 있습니다: ${JSON.stringify(item)}`)
    }
    return {
      name: item.name.trim(),
      ...deriveProductFields(item.name),
      aliases: item.aliases ?? [],
      category: item.category ?? null,
      info_url: item.infoUrl ?? null,
      is_active: true,
    }
  })

  // name_norm 중복은 DB unique 제약에 걸리기 전에 여기서 잡아준다
  const seen = new Map<string, string>()
  for (const row of rows) {
    const previous = seen.get(row.name_norm)
    if (previous) {
      fail(`정규화 후 이름이 중복됩니다: "${previous}" 와 "${row.name}" → ${row.name_norm}`)
    }
    seen.set(row.name_norm, row.name)
  }

  console.log(`제품 ${rows.length}건:`)
  for (const row of rows) {
    console.log(`  ${row.name}  →  norm=${row.name_norm}  초성=${row.name_chosung}`)
  }

  if (dryRun) {
    console.log('\n--dry-run 이므로 DB 에 반영하지 않았습니다.')
    return
  }

  const { supabaseService } = await import('../lib/supabase')
  const { error } = await supabaseService()
    .from('products')
    .upsert(rows, { onConflict: 'name_norm' })

  if (error) fail(`업서트 실패: ${error.message}`)

  console.log(`\n✓ ${rows.length}건 반영 완료`)
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
