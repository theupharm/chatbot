/**
 * 개인정보 마스킹 (설계문서 §9-4)
 *
 * 불만 접수 목록에서 연락처를 가린다. 담당자가 목록을 훑는 것만으로
 * 전체 연락처가 노출되지 않게 하려는 것이고, 원문은 상세 조회에서만 준다.
 */

/**
 * @example maskContact('online@theu.co.kr') // 'on********@theu.co.kr'
 * @example maskContact('02-123-4567')       // '*******4567'
 */
export function maskContact(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) return ''

  if (trimmed.includes('@')) {
    const at = trimmed.indexOf('@')
    const local = trimmed.slice(0, at)
    const domain = trimmed.slice(at + 1)
    const head = local.slice(0, 2)
    return `${head}${'*'.repeat(Math.max(local.length - head.length, 1))}@${domain}`
  }

  const digits = trimmed.replace(/\D/g, '')
  if (digits.length >= 4) {
    return `${'*'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`
  }
  return '*'.repeat(trimmed.length)
}
