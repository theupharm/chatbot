/**
 * 트라이그램 유사도 (설계문서 §5-1)
 *
 * PostgreSQL `pg_trgm` 의 similarity() 와 같은 정의를 쓴다.
 *   similarity(a, b) = |trigrams(a) ∩ trigrams(b)| / |trigrams(a) ∪ trigrams(b)|
 *
 * 나중에 제품 수가 늘어 DB 쪽 pg_trgm 으로 검색을 옮기더라도
 * 임계값(0.35)의 의미가 달라지지 않도록 같은 계산식을 유지한다.
 */

/**
 * 문자열의 트라이그램 집합.
 * pg_trgm 과 동일하게 앞에 공백 2개, 뒤에 공백 1개를 덧대어
 * 문자열의 시작·끝 부분에 가중치가 실리게 한다.
 */
export function trigrams(input: string): Set<string> {
  const padded = `  ${input} `
  const set = new Set<string>()
  const chars = [...padded]
  for (let i = 0; i + 3 <= chars.length; i++) {
    set.add(chars.slice(i, i + 3).join(''))
  }
  return set
}

/** 두 문자열의 트라이그램 자카드 유사도. 0 ~ 1 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0

  const ta = trigrams(a)
  const tb = trigrams(b)

  let intersection = 0
  for (const t of ta) {
    if (tb.has(t)) intersection++
  }
  const union = ta.size + tb.size - intersection

  return union === 0 ? 0 : intersection / union
}
