/**
 * 제품 검색 / 오타 허용 매칭 (설계문서 §5-1)
 *
 * ── 구현 방식에 대한 메모 ────────────────────────────────────────────────
 * 설계문서는 pg_trgm 기반 DB 검색을 전제로 했지만, 실제 제품 마스터는 수십~수백 건
 * 규모다. 이 크기에서는 활성 제품 전체를 메모리에 올려두고 TypeScript 로 매칭하는
 * 편이 낫다.
 *   - 키 입력마다 DB 왕복이 없어 자동완성이 즉각 반응한다
 *   - 매칭·랭킹 규칙이 순수 함수라 DB 없이 단위 테스트로 검증된다 (Phase 1 완료 기준)
 *   - 매칭 규칙을 SQL 재작성 없이 바꿀 수 있다
 *
 * pg_trgm 확장과 `name_jamo` GIN 인덱스는 스키마에 그대로 두었다. 제품 수가 수천 건을
 * 넘어가면 이 모듈의 `MatchTier` 를 SQL 로 옮기면 되고, 유사도 계산식이 동일하므로
 * (lib/similarity.ts) 임계값을 다시 튜닝할 필요가 없다.
 * ────────────────────────────────────────────────────────────────────────
 */

import { decomposeSyllable, looksLikeChosungQuery, toChosung, toJamo } from '@/lib/hangul'
import { normalizeProductName, normalizeText } from '@/lib/normalize'
import { similarity } from '@/lib/similarity'

/** 자모 유사도 매칭의 하한. 이 아래는 매칭으로 보지 않는다 (§5-1) */
export const FUZZY_THRESHOLD = 0.35

/** 자모 유사도 매칭을 시도할 최소 질의 길이. 1글자는 노이즈가 너무 많다 */
const MIN_FUZZY_LENGTH = 2

export const DEFAULT_SEARCH_LIMIT = 8

export interface ProductLink {
  label: string
  url: string
}

/** 검색에 필요한 제품 정보. DB 행에서 파생 필드까지 미리 계산해 둔 형태 */
export interface SearchableProduct {
  id: number
  name: string
  nameNorm: string
  nameJamo: string
  nameChosung: string
  aliases: string[]
  category: string | null
  packageSize: string | null
  infoUrl: string | null
  /** [제품정보] 분기에서 그대로 출력할 안내 문구 */
  infoText: string | null
  infoLinks: ProductLink[]
  /** 취급처 매핑이 있는 제품인지. [약국찾기] 분기는 이 제품만 대상으로 한다 */
  hasPharmacy: boolean
}

/** 어떤 규칙으로 매칭됐는지. 로그·디버깅·관리자 화면 설명용 */
export type MatchTier =
  | 'exact'
  | 'alias-exact'
  | 'prefix'
  | 'alias-prefix'
  | 'contains'
  | 'chosung'
  | 'fuzzy'

export interface ProductMatch {
  product: SearchableProduct
  tier: MatchTier
  score: number
  /** 자모 유사도로 매칭된 경우의 유사도 값 */
  similarity?: number
}

/** 티어별 기본 점수. 티어 간 순서가 뒤집히지 않도록 간격을 충분히 벌려둔다 */
const TIER_BASE: Record<MatchTier, number> = {
  exact: 1000,
  'alias-exact': 950,
  prefix: 900,
  'alias-prefix': 840,
  contains: 700,
  chosung: 600,
  fuzzy: 300,
}

/**
 * 이름이 길수록 감점한다. "베아제" 를 검색했을 때
 * "베아제" 가 "베아제플러스에프" 보다 앞에 오게 하기 위한 것.
 * 티어 간 순서가 뒤집히지 않도록 상한을 둔다.
 */
const MAX_LENGTH_PENALTY = 40

function lengthPenalty(nameNorm: string, queryNorm: string): number {
  return Math.min(Math.max(nameNorm.length - queryNorm.length, 0), MAX_LENGTH_PENALTY)
}

export interface ProductRow {
  id: number
  name: string
  name_norm: string
  name_jamo: string
  name_chosung: string
  aliases: string[] | null
  category: string | null
  package_size: string | null
  info_url: string | null
  info_text: string | null
  info_links: ProductLink[] | null
}

/** DB 행(snake_case)을 검색용 형태로 변환한다 */
export function toSearchable(row: ProductRow, hasPharmacy = false): SearchableProduct {
  return {
    id: row.id,
    name: row.name,
    nameNorm: row.name_norm,
    nameJamo: row.name_jamo,
    nameChosung: row.name_chosung,
    aliases: row.aliases ?? [],
    category: row.category,
    packageSize: row.package_size,
    infoUrl: row.info_url,
    infoText: row.info_text,
    infoLinks: row.info_links ?? [],
    hasPharmacy,
  }
}

/**
 * 제품 저장 시 서버가 생성하는 파생 필드.
 * 클라이언트가 보낸 값을 신뢰하지 않고 항상 여기서 다시 계산한다 (§13).
 */
export function deriveProductFields(name: string): {
  name_norm: string
  name_jamo: string
  name_chosung: string
} {
  const norm = normalizeProductName(name)
  return {
    name_norm: norm,
    name_jamo: toJamo(norm),
    name_chosung: toChosung(norm),
  }
}

interface QueryForms {
  norm: string
  jamo: string
  chosung: string
  isChosungQuery: boolean
}

function prepareQuery(raw: string): QueryForms {
  const norm = normalizeText(raw)
  return {
    norm,
    jamo: toJamo(norm),
    chosung: toChosung(norm),
    isChosungQuery: looksLikeChosungQuery(norm),
  }
}

/** 제품 하나에 대해 가장 좋은 매칭 티어를 찾는다. 매칭 없으면 null */
function matchProduct(product: SearchableProduct, q: QueryForms): ProductMatch | null {
  const { nameNorm } = product

  if (nameNorm === q.norm) {
    return { product, tier: 'exact', score: TIER_BASE.exact }
  }

  const aliasNorms = product.aliases.map(normalizeText).filter(Boolean)

  if (aliasNorms.includes(q.norm)) {
    return { product, tier: 'alias-exact', score: TIER_BASE['alias-exact'] }
  }

  if (nameNorm.startsWith(q.norm)) {
    return {
      product,
      tier: 'prefix',
      score: TIER_BASE.prefix - lengthPenalty(nameNorm, q.norm),
    }
  }

  const aliasPrefix = aliasNorms.find((alias) => alias.startsWith(q.norm))
  if (aliasPrefix !== undefined) {
    return {
      product,
      tier: 'alias-prefix',
      score: TIER_BASE['alias-prefix'] - lengthPenalty(aliasPrefix, q.norm),
    }
  }

  if (nameNorm.includes(q.norm)) {
    return {
      product,
      tier: 'contains',
      score: TIER_BASE.contains - lengthPenalty(nameNorm, q.norm),
    }
  }

  // 초성 검색: "ㄷㅌㄹㅂ" → "닥터로반연고"
  // 초성만 입력된 질의에만 적용한다. 그렇지 않으면 일반 검색어의 초성이
  // 엉뚱한 제품에 걸린다.
  if (q.isChosungQuery && q.chosung.length > 0) {
    if (product.nameChosung.startsWith(q.chosung)) {
      return {
        product,
        tier: 'chosung',
        score: TIER_BASE.chosung - lengthPenalty(product.nameChosung, q.chosung),
      }
    }
    // 초성 질의는 여기서 끝낸다. 자모 유사도까지 가면 의미 없는 매칭이 쏟아진다.
    return null
  }

  if (q.norm.length < MIN_FUZZY_LENGTH) return null

  // 자모 유사도: "배아제" → "베아제"
  const nameSim = similarity(product.nameJamo, q.jamo)
  const aliasSim = product.aliases.reduce((best, alias) => {
    const s = similarity(toJamo(normalizeText(alias)), q.jamo)
    return s > best ? s : best
  }, 0)
  const best = Math.max(nameSim, aliasSim)

  if (best >= FUZZY_THRESHOLD) {
    return {
      product,
      tier: 'fuzzy',
      // 유사도 0.35~1.0 을 300~600 점 구간에 매핑한다.
      // 상한이 contains(700) 아래이므로 부분일치가 항상 우선한다.
      score: TIER_BASE.fuzzy + best * 300,
      similarity: best,
    }
  }

  return null
}

export interface SearchOptions {
  limit?: number
}

/**
 * 제품 검색. 매칭 결과를 점수 내림차순으로 반환한다.
 * 매칭이 하나도 없으면 빈 배열 — 호출부는 반드시 폴백을 제공해야 한다 (§13).
 */
export function searchProducts(
  products: readonly SearchableProduct[],
  rawQuery: string,
  options: SearchOptions = {},
): ProductMatch[] {
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT
  const q = prepareQuery(rawQuery)
  if (q.norm.length === 0) return []

  const matches: ProductMatch[] = []
  for (const product of products) {
    const match = matchProduct(product, q)
    if (match) matches.push(match)
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // 점수가 같으면 짧은 이름 → 가나다순으로 안정 정렬
    if (a.product.nameNorm.length !== b.product.nameNorm.length) {
      return a.product.nameNorm.length - b.product.nameNorm.length
    }
    return a.product.name.localeCompare(b.product.name, 'ko')
  })

  return matches.slice(0, limit)
}

/**
 * 검색 0건일 때 보여줄 제품 목록 (§5-1 폴백).
 *
 * 원래 설계는 카테고리별 그룹이었지만 제품 마스터에 카테고리 정보가 없어
 * **초성 인덱스**로 대체한다. 88종을 한 덩어리로 늘어놓지 않고
 * `ㄱ ㄴ ㄷ …` 버튼 → 해당 초성 제품 목록의 2단계로 고르게 한다.
 *
 * 카테고리가 확보되면 buildCatalog 로 되돌릴 수 있게 둘 다 남겨둔다.
 */
export const UNCATEGORIZED_LABEL = '기타'

/** 인덱스 버튼에 쓸 기본 자음 14개. 쌍자음은 대응하는 기본 자음으로 접는다 */
const INITIAL_FOLD: Record<string, string> = {
  ㄲ: 'ㄱ', ㄸ: 'ㄷ', ㅃ: 'ㅂ', ㅆ: 'ㅅ', ㅉ: 'ㅈ',
}

const INITIAL_ORDER = [
  'ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
]

/** 한글이 아닌 이름을 묶을 그룹 */
export const NON_HANGUL_LABEL = 'A-Z'

export interface IndexGroup {
  initial: string
  products: Array<{ id: number; name: string; packageSize: string | null }>
}

function initialOf(name: string): string {
  const first = [...name.trim()][0] ?? ''
  const syllable = decomposeSyllable(first)
  if (!syllable) return NON_HANGUL_LABEL
  return INITIAL_FOLD[syllable.cho] ?? syllable.cho
}

export function buildProductIndex(products: readonly SearchableProduct[]): IndexGroup[] {
  const groups = new Map<string, IndexGroup['products']>()

  for (const product of products) {
    const key = initialOf(product.name)
    const list = groups.get(key) ?? []
    list.push({ id: product.id, name: product.name, packageSize: product.packageSize })
    groups.set(key, list)
  }

  const rank = (initial: string): number => {
    const index = INITIAL_ORDER.indexOf(initial)
    return index === -1 ? INITIAL_ORDER.length : index
  }

  return [...groups.entries()]
    .map(([initial, list]) => ({
      initial,
      products: list.sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    }))
    .sort((a, b) => rank(a.initial) - rank(b.initial) || a.initial.localeCompare(b.initial, 'ko'))
}

export interface CatalogGroup {
  category: string
  products: Array<{ id: number; name: string; packageSize: string | null }>
}

export function buildCatalog(products: readonly SearchableProduct[]): CatalogGroup[] {
  const groups = new Map<string, CatalogGroup['products']>()

  for (const product of products) {
    const key = product.category?.trim() || UNCATEGORIZED_LABEL
    const list = groups.get(key) ?? []
    list.push({ id: product.id, name: product.name, packageSize: product.packageSize })
    groups.set(key, list)
  }

  const result = [...groups.entries()].map(([category, list]) => ({
    category,
    products: list.sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  }))

  // "기타" 는 항상 마지막
  return result.sort((a, b) => {
    if (a.category === UNCATEGORIZED_LABEL) return 1
    if (b.category === UNCATEGORIZED_LABEL) return -1
    return a.category.localeCompare(b.category, 'ko')
  })
}
