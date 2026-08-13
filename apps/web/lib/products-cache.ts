/**
 * 활성 제품 인메모리 캐시 (설계문서 §5-1 구현 메모 참고)
 *
 * 제품 마스터는 수십~수백 건이고 변경 빈도가 낮다. 자동완성 키 입력마다 DB 를
 * 왕복하는 대신 전체를 메모리에 올려두고 TTL 로 갱신한다.
 *
 * 서버리스 인스턴스마다 캐시가 따로 존재하므로, 관리자 페이지에서 제품을 수정하면
 * 최대 TTL(기본 300초) 만큼 반영이 늦어질 수 있다. 취급처(약국) 데이터는 캐시하지
 * 않으므로 §9-5 의 "즉시 반영" 요건에는 영향이 없다.
 */

import { env } from '@/lib/env'
import { toSearchable, type ProductRow, type SearchableProduct } from '@/lib/search'
import { supabaseAnon } from '@/lib/supabase'

const COLUMNS =
  'id, name, name_norm, name_jamo, name_chosung, aliases, category, package_size, info_url, info_text, info_links'

interface CacheEntry {
  products: SearchableProduct[]
  expiresAt: number
}

let cache: CacheEntry | null = null
/** 동시 요청이 같은 쿼리를 중복 실행하지 않도록 진행 중인 조회를 공유한다 */
let inflight: Promise<SearchableProduct[]> | null = null

async function fetchActiveProducts(): Promise<SearchableProduct[]> {
  const db = supabaseAnon()

  const [products, mapped] = await Promise.all([
    db.from('products').select(COLUMNS).eq('is_active', true).order('name', { ascending: true }),
    // 취급처 매핑이 있는 제품 id 만 추린 뷰.
    // pharmacy_products 를 직접 읽으면 5천 건이 넘어 PostgREST 기본 상한에 걸린다.
    db.from('products_with_pharmacy').select('product_id'),
  ])

  if (products.error) throw new Error(`제품 목록 조회 실패: ${products.error.message}`)
  if (mapped.error) throw new Error(`취급처 매핑 조회 실패: ${mapped.error.message}`)

  const withPharmacy = new Set(
    (mapped.data ?? []).map((row) => Number((row as { product_id: number }).product_id)),
  )

  return (products.data ?? []).map((row) => {
    const product = row as unknown as ProductRow
    return toSearchable(product, withPharmacy.has(Number(product.id)))
  })
}

/** 활성 제품 전체. TTL 이 지나면 다시 조회한다 */
export async function getActiveProducts(): Promise<SearchableProduct[]> {
  const now = Date.now()

  if (cache && cache.expiresAt > now) {
    return cache.products
  }

  if (inflight) return inflight

  inflight = fetchActiveProducts()
    .then((products) => {
      cache = { products, expiresAt: Date.now() + env.productCacheTtlSeconds() * 1000 }
      return products
    })
    .catch((error: unknown) => {
      // 조회에 실패했는데 만료된 캐시가 남아 있으면 그것이라도 내준다.
      // 빈 화면으로 끝내지 않는다는 원칙(§13)을 캐시 계층에서도 지킨다.
      if (cache) return cache.products
      throw error
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}

/** 테스트·관리자 저장 직후 강제 갱신용 */
export function invalidateProductCache(): void {
  cache = null
  inflight = null
}
