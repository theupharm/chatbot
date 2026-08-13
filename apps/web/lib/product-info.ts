/**
 * 제품 안내 문구 파싱 (설계문서 §6 [제품정보] 분기)
 *
 * 원본은 이런 형태의 답변 전문이다:
 *
 *   안녕하세요 더유제약입니다.
 *   멜라녹스캡슐은 전문의약품으로 챗봇으로 안내가 어렵습니다.
 *   용법용량 및 주의사항은 아래 링크에서 확인 부탁드립니다.
 *   의약품상세정보(https://nedrug.mfds.go.kr/...)
 *   부작용 및 불량품은 처방받은 병원이나 약국으로 문의해주세요.
 *   감사합니다.
 *
 * 링크 줄은 채팅에서 버튼으로 띄우는 편이 낫다. 본문과 링크를 분리한다.
 * **문구 자체는 절대 손대지 않는다.** 사전 승인된 안내문이므로 요약·재작성 금지 (§13).
 */

/** `라벨(https://...)` 형태의 줄 */
const LINK_LINE = /^(.*?)\(\s*(https?:\/\/[^\s)]+)\s*\)\s*$/

export interface ProductLink {
  label: string
  url: string
}

export interface ParsedProductInfo {
  /** 링크 줄을 걷어낸 본문. 줄바꿈은 그대로 둔다 */
  text: string
  links: ProductLink[]
}

const DEFAULT_LINK_LABEL = '자세히 보기'

export function parseProductAnswer(answer: string): ParsedProductInfo {
  const links: ProductLink[] = []
  const kept: string[] = []

  for (const rawLine of answer.replace(/\r\n/g, '\n').split('\n')) {
    const match = LINK_LINE.exec(rawLine.trim())
    if (match?.[2]) {
      const label = (match[1] ?? '').trim()
      links.push({ label: label || DEFAULT_LINK_LABEL, url: match[2] })
      continue
    }
    kept.push(rawLine.trimEnd())
  }

  const text = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { text, links }
}
