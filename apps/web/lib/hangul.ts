/**
 * 한글 자모 분해 유틸 (설계문서 §5-1)
 *
 * 오타 허용 검색의 기반. 음절을 자모로 쪼개면 "배아제"와 "베아제"처럼
 * 한 글자만 다른 오타가 자모 수준에서는 대부분 일치하게 되어 유사도가 높아진다.
 *
 * 외부 라이브러리 없이 유니코드 규칙(0xAC00 기반)으로 직접 구현한다.
 */

const SYLLABLE_BASE = 0xac00
const SYLLABLE_LAST = 0xd7a3

const JUNG_COUNT = 21
const JONG_COUNT = 28

// prettier-ignore
const CHOSUNG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const

// prettier-ignore
const JUNGSUNG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
] as const

// prettier-ignore
const JONGSUNG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
  'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const

/**
 * 복합 자모를 단일 자모로 더 쪼갠다.
 *
 * 이렇게 하면 "과"/"고", "까"/"가" 처럼 복합 자모가 얽힌 오타의 유사도가 올라간다.
 * 예: "괴"(ㄱㅚ) vs "고"(ㄱㅗ) — 분해 전엔 겹치는 자모가 ㄱ 하나뿐이지만
 *     분해 후엔 ㄱㅗㅣ vs ㄱㅗ 로 두 개가 겹친다.
 */
const DEEP: Record<string, string> = {
  // 겹자음
  ㄲ: 'ㄱㄱ', ㄸ: 'ㄷㄷ', ㅃ: 'ㅂㅂ', ㅆ: 'ㅅㅅ', ㅉ: 'ㅈㅈ',
  // 겹받침
  ㄳ: 'ㄱㅅ', ㄵ: 'ㄴㅈ', ㄶ: 'ㄴㅎ', ㄺ: 'ㄹㄱ', ㄻ: 'ㄹㅁ',
  ㄼ: 'ㄹㅂ', ㄽ: 'ㄹㅅ', ㄾ: 'ㄹㅌ', ㄿ: 'ㄹㅍ', ㅀ: 'ㄹㅎ', ㅄ: 'ㅂㅅ',
  // 복합 모음
  ㅐ: 'ㅏㅣ', ㅒ: 'ㅑㅣ', ㅔ: 'ㅓㅣ', ㅖ: 'ㅕㅣ',
  ㅘ: 'ㅗㅏ', ㅙ: 'ㅗㅏㅣ', ㅚ: 'ㅗㅣ',
  ㅝ: 'ㅜㅓ', ㅞ: 'ㅜㅓㅣ', ㅟ: 'ㅜㅣ', ㅢ: 'ㅡㅣ',
}

function deepExpand(jamo: string): string {
  return DEEP[jamo] ?? jamo
}

/** 완성형 한글 음절인지 (가 ~ 힣) */
export function isSyllable(ch: string): boolean {
  const code = ch.codePointAt(0)
  return code !== undefined && code >= SYLLABLE_BASE && code <= SYLLABLE_LAST
}

/** 단독 자모인지 (ㄱ~ㅎ, ㅏ~ㅣ). 사용자가 "ㅂㅇㅈ" 처럼 초성만 입력하는 경우 */
export function isStandaloneJamo(ch: string): boolean {
  const code = ch.codePointAt(0)
  return code !== undefined && code >= 0x3131 && code <= 0x3163
}

export interface Syllable {
  cho: string
  jung: string
  jong: string
}

/** 음절 하나를 초성/중성/종성으로 분해한다. 한글 음절이 아니면 null */
export function decomposeSyllable(ch: string): Syllable | null {
  if (!isSyllable(ch)) return null
  const code = ch.codePointAt(0)! - SYLLABLE_BASE

  const choIndex = Math.floor(code / (JUNG_COUNT * JONG_COUNT))
  const jungIndex = Math.floor((code % (JUNG_COUNT * JONG_COUNT)) / JONG_COUNT)
  const jongIndex = code % JONG_COUNT

  return {
    cho: CHOSUNG[choIndex]!,
    jung: JUNGSUNG[jungIndex]!,
    jong: JONGSUNG[jongIndex]!,
  }
}

export interface JamoOptions {
  /**
   * 복합 자모를 단일 자모로 더 쪼갤지 여부. 기본 true.
   *
   * DB의 `products.name_jamo` 와 질의어는 반드시 같은 옵션으로 생성해야 한다.
   * 서로 다르면 유사도가 무의미해진다.
   */
  deep?: boolean
}

/**
 * 문자열 전체를 자모 문자열로 변환한다.
 *
 * 한글이 아닌 문자(영문·숫자)는 그대로 통과시킨다. 제품명에 "S" 나 "100" 이
 * 섞여 있어도 매칭에 쓸 수 있어야 하기 때문이다.
 *
 * @example toJamo('베아제') // 'ㅂㅓㅣㅇㅏㅈㅓㅣ'
 */
export function toJamo(text: string, options: JamoOptions = {}): string {
  const deep = options.deep ?? true
  let out = ''

  for (const ch of text) {
    const syllable = decomposeSyllable(ch)
    if (syllable) {
      const parts = syllable.cho + syllable.jung + syllable.jong
      out += deep ? [...parts].map(deepExpand).join('') : parts
      continue
    }
    if (isStandaloneJamo(ch)) {
      out += deep ? deepExpand(ch) : ch
      continue
    }
    out += ch
  }

  return out
}

/**
 * 초성만 뽑아낸다. 한글이 아닌 문자는 그대로 둔다.
 *
 * @example toChosung('베아제') // 'ㅂㅇㅈ'
 */
export function toChosung(text: string): string {
  let out = ''
  for (const ch of text) {
    const syllable = decomposeSyllable(ch)
    out += syllable ? syllable.cho : ch
  }
  return out
}

/**
 * 입력이 초성 검색으로 보이는지 판정한다.
 * (한글 음절이 하나도 없고, 단독 자음이 하나 이상 있을 때)
 *
 * "ㅂㅇㅈ" → true / "베아제" → false / "ㅂ아제" → false
 */
export function looksLikeChosungQuery(text: string): boolean {
  let hasConsonant = false
  for (const ch of text) {
    if (isSyllable(ch)) return false
    if (isStandaloneJamo(ch)) {
      const code = ch.codePointAt(0)!
      if (code > 0x314e) return false // 모음(ㅏ~ㅣ)이 섞이면 초성 검색이 아니다
      hasConsonant = true
    }
  }
  return hasConsonant
}
