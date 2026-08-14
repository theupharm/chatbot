/**
 * 이용 통계 전송 (설계문서 §9-5)
 *
 * 무엇을 보내지 않는지가 중요하다.
 *   · 사용자 위치 좌표를 보내지 않는다 (§13)
 *   · 대화 내용을 보내지 않는다. 어떤 분기를 골랐는지, 어떤 제품을 골랐는지만 보낸다
 *   · 검색어는 **결과가 0건일 때만** 보낸다. 별칭 보강용이다
 *
 * 세션 ID 는 대화가 시작될 때 만들고 브라우저에 저장하지 않는다.
 * 새로고침하면 새 ID 가 되므로 재방문을 이어붙일 수 없다.
 *
 * 통계 때문에 챗봇이 느려지거나 멈추면 안 된다. 전송은 항상 fire-and-forget 이고
 * 실패해도 무시한다.
 */

import { API_BASE } from '@/config'

export type EventType =
  | 'widget_open'
  | 'branch'
  | 'product_search'
  | 'product_select'
  | 'pharmacy_search'
  | 'complaint_submit'

export type BranchKey = 'pharmacy' | 'complaint' | 'info' | 'etc'

export interface UsageEvent {
  type: EventType
  branch?: BranchKey
  productId?: number
  /** 0건 검색일 때만 채운다 */
  query?: string
  /** 주소로 검색한 경우의 시/도. 현재 위치 검색에는 넣지 않는다 */
  sido?: string
  resultCount?: number
}

/** 시/도 표기 통일. 서버의 lib/address.ts 와 같은 기준 */
const SIDO_CANONICAL: Record<string, string> = {
  서울: '서울', 서울시: '서울', 서울특별시: '서울',
  부산: '부산', 부산광역시: '부산', 대구: '대구', 대구광역시: '대구',
  인천: '인천', 인천광역시: '인천', 광주: '광주', 광주광역시: '광주',
  대전: '대전', 대전광역시: '대전', 울산: '울산', 울산광역시: '울산',
  세종: '세종', 세종특별자치시: '세종',
  경기: '경기', 경기도: '경기',
  강원: '강원', 강원도: '강원', 강원특별자치도: '강원',
  충북: '충북', 충청북도: '충북', 충남: '충남', 충청남도: '충남',
  전북: '전북', 전라북도: '전북', 전북특별자치도: '전북',
  전남: '전남', 전라남도: '전남',
  경북: '경북', 경상북도: '경북', 경남: '경남', 경상남도: '경남',
  제주: '제주', 제주도: '제주', 제주특별자치도: '제주',
}

/**
 * 주소 문자열에서 시/도만 뽑는다.
 *
 * **주소로 검색한 경우에만** 쓴다. 현재 위치로 검색한 건은 지역을 남기지 않는다 —
 * 좌표에서 유도한 값은 남기지 않는다는 §13 원칙 때문이다.
 */
export function extractSido(address: string): string | undefined {
  const first = address.trim().split(/\s+/)[0]
  return first ? SIDO_CANONICAL[first] : undefined
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // randomUUID 가 없는 구형 브라우저용 대체 (통계 용도라 강한 난수가 필요하지 않다)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

let sessionId = newSessionId()

/** 대화를 처음으로 되돌릴 때 새 세션으로 끊는다 */
export function resetSession(): void {
  sessionId = newSessionId()
}

export function track(event: UsageEvent): void {
  const body = JSON.stringify({
    events: [{ sessionId, ...event }],
  })

  try {
    void fetch(`${API_BASE}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // 페이지를 벗어나는 순간에도 전송이 끊기지 않게 한다
      keepalive: true,
    }).catch(() => {
      /* 통계 유실은 무시한다 */
    })
  } catch {
    /* 무시 */
  }
}
