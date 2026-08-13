/**
 * 이상사례(AE) 의심 키워드 (설계문서 §8-3)
 *
 * ⚠️ 이 목록은 **PV(약물감시)팀 확정 전 임시본**이다.
 *    PV 팀 검토를 거쳐 `REVIEWED_BY_PV` 를 true 로 바꾸기 전까지 §8-3 은 완료가 아니다.
 *
 * 판정은 **넓게** 잡는다. 제약회사는 이상사례 보고 의무가 있어서
 * 누락(false negative)이 오탐(false positive)보다 훨씬 위험하다.
 * 오탐은 담당자가 메일 한 통 더 받고 끝나지만, 누락은 보고 의무 위반이 된다.
 */

export const REVIEWED_BY_PV = false

/**
 * 불만 내용에서 찾을 키워드. 정규화(공백 제거) 후 부분 일치로 본다.
 *
 * 한국어 활용을 고려해 **가장 짧은 안전한 어간**을 넣는다.
 * ㅂ불규칙 때문에 어간이 바뀌기 때문이다:
 *   가렵다 → 가려워요  (`가렵` 으로는 못 잡는다 → `가려`)
 *   어지럽다 → 어지러워요 (→ `어지러`)
 *   붓다 → 부어요        (→ `부어`)
 * 어간을 짧게 잡으면 오탐이 늘지만, 누락보다 낫다.
 */
export const AE_KEYWORDS: readonly string[] = [
  // 총칭
  '부작용', '이상반응', '이상사례', '유해사례', '약물이상',

  // 피부
  '발진', '두드러기', '가려', '따가', '홍반', '물집', '수포',
  '화끈', '작열감', '피부염', '알레르기', '알러지', '아나필락시스', '색소침착',

  // 전신
  '어지러', '어지럽', '현기증', '두통', '메스꺼', '메슥', '구역', '구토', '토했',
  '설사', '복통', '발열', '고열', '오한', '경련', '떨림', '실신', '기절',
  '호흡곤란', '숨이', '가슴답답', '두근', '심계항진', '부종', '붓', '부어', '통증', '쇼크',

  // 중대한 결과 (§8-3 — 이 경우 반드시 PV 로 간다)
  '입원', '응급실', '후유증', '장애', '기형', '사망', '중태', '중환자',

  // 간·신장 등 검사 이상
  '간수치', '황달', '신부전', '혈뇨', '출혈',
] as const

/** 판정에 쓸 정규화: 공백·특수문자 제거 + 소문자 */
function normalize(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/[^0-9a-z가-힣]/gu, '')
}

export interface AeDetection {
  isSuspect: boolean
  /** 감지된 키워드 원형. PV 검토 근거로 DB 에 남긴다 */
  matched: string[]
}

/**
 * 불만 내용에서 이상사례 의심 키워드를 찾는다.
 * 하나라도 걸리면 PV 담당 메일로도 발송한다 (§8-3).
 */
export function detectAdverseEvent(content: string): AeDetection {
  const haystack = normalize(content)
  if (haystack.length === 0) return { isSuspect: false, matched: [] }

  const matched = AE_KEYWORDS.filter((keyword) => haystack.includes(normalize(keyword)))

  return { isSuspect: matched.length > 0, matched }
}
