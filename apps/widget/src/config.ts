/**
 * 위젯 설정 (설계문서 §3, §6, §10)
 *
 * 시나리오 고정값은 config/site.json 하나에서 온다. 서버(apps/web)와 같은 파일을 읽으므로
 * 고객센터 번호가 두 곳에서 어긋날 일이 없다.
 */

import siteConfig from '../../../config/site.json'

export const SITE = {
  company: siteConfig.company as string,
  cs: siteConfig.customerService as {
    phone: string
    email: string
    hours: string
    lunchBreak: string
    hoursLabel: string
  },
  links: siteConfig.links as { consumerComplaintBoard: string; homepage: string },
  privacy: siteConfig.privacy as { reviewed: boolean; consentNotice: string },
}

// 법무 확인 전 문구로 개인정보를 수집하면 안 된다 (§8). 배포 전 반드시 확인할 것.
if (!SITE.privacy.reviewed) {
  console.warn(
    '[더유챗봇] 개인정보 수집·이용 동의 문구가 법무 확인 전 임시본입니다. 운영 배포 전 config/site.json 을 갱신하세요.',
  )
}

/**
 * API 주소.
 *
 * 위젯은 챗봇 도메인에서 서빙되고 홈페이지에 임베드된다. 따라서 현재 페이지 origin 이 아니라
 * **이 스크립트가 로드된 origin** 을 기준으로 삼아야 한다.
 * (개발 중에는 window 전역으로 덮어쓸 수 있게 열어둔다)
 */
function resolveApiBase(): string {
  const override = (window as { __THEU_CHATBOT_API__?: string }).__THEU_CHATBOT_API__
  if (override) return override.replace(/\/$/, '')

  const current = document.currentScript as HTMLScriptElement | null
  const src = current?.src
  if (src) {
    try {
      return new URL(src).origin
    } catch {
      /* 잘못된 src 는 무시하고 아래로 */
    }
  }

  return window.location.origin
}

export const API_BASE = resolveApiBase()

/** 자동완성 디바운스 (§5-1) */
export const SEARCH_DEBOUNCE_MS = 300

/** 취급처 검색 반경 (§5-2) */
export const SEARCH_RADIUS_KM = 10
