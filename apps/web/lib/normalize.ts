/**
 * 문자열 정규화 (설계문서 §5-1)
 *
 * 검색어와 저장값에 같은 규칙을 적용해서 띄어쓰기·특수문자·대소문자 차이를 없앤다.
 * "베 아 제", "베아제", "베아제(정)" 이 모두 같은 값이 되게 하는 것이 목적이다.
 */

/** 정규화 후에도 남길 문자: 숫자, 영소문자, 한글 음절, 단독 자모 */
const KEEP = /[^0-9a-zㄱ-ㅣ가-힣]/gu

/**
 * 공백·특수문자를 제거하고 소문자로 통일한다.
 *
 * @example normalizeText('베 아 제 (정)') // '베아제정'
 * @example normalizeText('Dr.로반 연고')  // 'dr로반연고'
 */
export function normalizeText(input: string): string {
  return input.normalize('NFC').toLowerCase().replace(KEEP, '')
}

/**
 * 제품명 정규화. 현재는 normalizeText 와 동일하지만,
 * 제품 고유의 규칙(예: 용량 표기 제거)이 생길 자리를 분리해 둔다.
 */
export function normalizeProductName(input: string): string {
  return normalizeText(input)
}
