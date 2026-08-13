/**
 * 시나리오 고정값 (설계문서 §6)
 *
 * 고객센터 안내·게시판 링크처럼 챗봇 문구에 그대로 박히는 값이다.
 * `config/site.json` 하나만 고치면 서버와 위젯이 같이 따라간다.
 */

import siteConfig from '../../../config/site.json'

export interface CustomerService {
  phone: string
  email: string
  hours: string
  lunchBreak: string
  /** 사용자에게 그대로 보여줄 운영시간 문구 */
  hoursLabel: string
}

export const COMPANY: string = siteConfig.company

export const CUSTOMER_SERVICE: CustomerService = siteConfig.customerService

export const LINKS: { consumerComplaintBoard: string; homepage: string } = siteConfig.links

/**
 * 개인정보 동의·보관 정책 (§8).
 * `reviewed` 가 false 인 동안에는 파기 배치가 동작하지 않는다.
 */
export const PRIVACY: { reviewed: boolean; consentNotice: string } = siteConfig.privacy

/** 검색 0건·취급처 0건 등 막다른 길에서 항상 붙여줄 안내 (§13) */
export function customerServiceNotice(): string {
  const { phone, email, hoursLabel } = CUSTOMER_SERVICE
  return `고객센터 ${phone} / ${email}\n운영시간 ${hoursLabel}`
}
