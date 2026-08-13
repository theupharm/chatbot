/**
 * 제품명에서 용량·포장 규격 분리 (설계문서 §4-1)
 *
 * 원본 시트의 제품명에는 규격이 붙어 있다 ("덱세릴MD크림 500g").
 * 챗봇 표시명은 규격을 뗀 쪽이 검색·안내에 자연스러우므로 분리해 저장하고,
 * 원본 표기는 별칭(aliases)에 남겨 그대로 검색해도 찾히게 한다.
 *
 * 성분 농도는 규격이 아니라 제품 구분이므로 분리하지 않는다.
 * "마이모닉액 3%" 와 "마이모닉액 5%" 는 서로 다른 제품이다.
 */

/**
 * 뒤에 붙은 규격 표기를 잡는다.
 * 공백 뒤 숫자로 시작하고 단위가 이어지는 지점부터 문자열 끝까지.
 * 긴 단위를 먼저 시도해야 "500mg" 이 "500m" + "g" 로 잘리지 않는다.
 */
const PACKAGE_SUFFIX = /\s+(\d[\d.]*\s*(?:mg|kg|ml|캡슐|정|g|l|t|c|포|매|병).*)$/i

export interface SplitProductName {
  /** 챗봇에 표시할 이름 */
  name: string
  /** 용량·포장 규격. 없으면 null */
  packageSize: string | null
}

export function splitProductName(raw: string): SplitProductName {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  const match = PACKAGE_SUFFIX.exec(trimmed)

  if (!match || !match[1]) {
    return { name: trimmed, packageSize: null }
  }

  const name = trimmed.slice(0, match.index).trim()
  // 규격만 남고 이름이 사라지는 경우는 원본을 그대로 둔다
  if (name.length === 0) return { name: trimmed, packageSize: null }

  return { name, packageSize: match[1].trim() }
}

export interface ProductMaster {
  /** 표시명 */
  name: string
  /** 중복 판정 키. products.name_norm 과 같은 값 */
  nameNorm: string
  packageSize: string | null
  /** 원본 표기 등 검색으로 찾히게 할 이름들 */
  aliases: string[]
  /** 이 제품으로 합쳐진 원본 제품명들 */
  sourceNames: string[]
}

/**
 * 원본 제품명 목록에서 제품 마스터를 만든다.
 *
 * 규격을 뗀 이름이 같으면 하나의 제품으로 합친다.
 * "케어모블캡슐 90c*2ea (1box)" 와 "케어모블캡슐" 이 여기서 한 제품이 된다.
 *
 * @param normalize `products.name_norm` 생성 함수 (서버 정규화 로직을 주입한다)
 */
export function buildProductMaster(
  rawNames: readonly string[],
  normalize: (value: string) => string,
): ProductMaster[] {
  const byNorm = new Map<string, ProductMaster>()

  for (const rawName of rawNames) {
    const trimmed = rawName.trim()
    if (!trimmed) continue

    const { name, packageSize } = splitProductName(trimmed)
    const nameNorm = normalize(name)
    if (!nameNorm) continue

    const existing = byNorm.get(nameNorm)
    if (!existing) {
      byNorm.set(nameNorm, {
        name,
        nameNorm,
        packageSize,
        aliases: trimmed === name ? [] : [trimmed],
        sourceNames: [trimmed],
      })
      continue
    }

    existing.sourceNames.push(trimmed)
    // 규격은 값이 있는 쪽을 채택한다 (합쳐진 제품 중 하나만 규격을 갖는 경우)
    if (!existing.packageSize && packageSize) existing.packageSize = packageSize
    if (trimmed !== existing.name && !existing.aliases.includes(trimmed)) {
      existing.aliases.push(trimmed)
    }
  }

  return [...byNorm.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}
