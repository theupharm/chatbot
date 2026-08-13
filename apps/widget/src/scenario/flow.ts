/**
 * 시나리오 상태 머신 (설계문서 §6)
 *
 * 상태 전이는 위젯에서 일어난다 (§3). 서버는 데이터만 준다.
 *
 * ⚠️ 이 파일의 문구가 챗봇이 말할 수 있는 전부다.
 *    생성형 AI 로 문장을 만들어내는 코드를 절대 추가하지 말 것 (§13).
 *    제품 안내문·취급처 정보는 DB 에서 오고, 그 외 문구는 여기 있는 것만 쓴다.
 */

import { SITE } from '@/config'

export type StepId =
  | 'START'
  | 'PHARMACY_PRODUCT'
  | 'PHARMACY_LOCATION'
  | 'PHARMACY_ADDRESS'
  | 'PHARMACY_RESULT'
  | 'COMPLAINT_WHO'
  | 'COMPLAINT_CONSUMER'
  | 'COMPLAINT_FORM'
  | 'COMPLAINT_DONE'
  | 'PRODUCT_SEARCH'
  | 'PRODUCT_INFO'
  | 'ETC'

/** 자유 입력을 허용하는 지점. §6 에 따라 이 셋 외에는 전부 버튼이다 */
export type InputKind = 'none' | 'product-search' | 'address' | 'complaint-form'

export interface Choice {
  label: string
  /** 눌렀을 때 이동할 스텝 */
  next?: StepId
  /** 새 탭으로 열 외부 링크 */
  href?: string
  /** 강조 표시 */
  primary?: boolean
}

export interface FlowContext {
  productId: number | null
  productName: string | null
  /** 제품 검색이 어느 분기에서 왔는지 — 검색 필터와 다음 스텝이 달라진다 */
  productPurpose: 'pharmacy' | 'info'
  ticketNo: string | null
}

export interface Step {
  id: StepId
  /** 진입 시 봇이 말하는 문구 */
  say: (ctx: FlowContext) => string[]
  choices?: (ctx: FlowContext) => Choice[]
  input?: InputKind
  /** 진입 시 자동으로 수행할 동작. App 이 처리한다 */
  effect?: 'search-pharmacies-by-geolocation'
}

const BACK_TO_START: Choice = { label: '처음으로', next: 'START' }

/** 헤더와 인트로가 함께 쓰는 인사말 */
export const GREETING = `안녕하세요 ${SITE.company} 챗봇입니다. 문의사항을 선택해주세요.`

export const CUSTOMER_SERVICE_LINES = [
  `전화 ${SITE.cs.phone}`,
  `이메일 ${SITE.cs.email}`,
  `운영시간 ${SITE.cs.hoursLabel}`,
]

export const FLOW: Record<StepId, Step> = {
  START: {
    id: 'START',
    // 인사말은 인트로 카드가 이미 하고 있다. 여기서 반복하지 않는다.
    say: () => ['문의 종류를 선택해주세요.'],
    choices: () => [
      { label: '약국찾기', next: 'PHARMACY_PRODUCT', primary: true },
      { label: '제품불만', next: 'COMPLAINT_WHO' },
      { label: '제품정보', next: 'PRODUCT_SEARCH' },
      { label: '기타', next: 'ETC' },
    ],
  },

  // ── 약국찾기 ──────────────────────────────────────────────────────────
  PHARMACY_PRODUCT: {
    id: 'PHARMACY_PRODUCT',
    say: () => ['찾으시는 제품명을 입력해주세요.'],
    input: 'product-search',
  },

  PHARMACY_LOCATION: {
    id: 'PHARMACY_LOCATION',
    say: (ctx) => [`${ctx.productName ?? '선택하신 제품'}을(를) 취급하는 곳을 찾아드릴게요.`, '위치를 알려주세요.'],
    choices: () => [
      { label: '📍 현재 위치로 찾기', next: 'PHARMACY_RESULT', primary: true },
      { label: '주소로 찾기', next: 'PHARMACY_ADDRESS' },
      BACK_TO_START,
    ],
    effect: 'search-pharmacies-by-geolocation',
  },

  PHARMACY_ADDRESS: {
    id: 'PHARMACY_ADDRESS',
    say: () => ['주소를 입력해주세요.', '"수원 영통"처럼 동네 이름만 넣으셔도 됩니다.'],
    input: 'address',
  },

  PHARMACY_RESULT: {
    id: 'PHARMACY_RESULT',
    say: () => [],
    choices: () => [
      { label: '다른 위치로 찾기', next: 'PHARMACY_ADDRESS' },
      BACK_TO_START,
    ],
  },

  // ── 제품불만 ──────────────────────────────────────────────────────────
  COMPLAINT_WHO: {
    id: 'COMPLAINT_WHO',
    say: () => ['제품 불만을 접수해드리겠습니다.', '어느 쪽에 해당하시나요?'],
    choices: () => [
      { label: '일반 소비자', next: 'COMPLAINT_CONSUMER' },
      { label: '의료인', next: 'COMPLAINT_FORM' },
      BACK_TO_START,
    ],
  },

  COMPLAINT_CONSUMER: {
    id: 'COMPLAINT_CONSUMER',
    say: () => [
      '일반 소비자 문의는 홈페이지 게시판으로 접수해주세요.',
      '아래 버튼을 누르면 게시판으로 이동합니다.',
    ],
    choices: () => [
      { label: '문의 게시판 열기', href: SITE.links.consumerComplaintBoard, primary: true },
      BACK_TO_START,
    ],
  },

  COMPLAINT_FORM: {
    id: 'COMPLAINT_FORM',
    say: () => ['아래 양식을 작성해주세요.', '접수 후 담당자가 확인하여 연락드립니다.'],
    input: 'complaint-form',
  },

  COMPLAINT_DONE: {
    id: 'COMPLAINT_DONE',
    say: (ctx) => [
      '접수가 완료되었습니다.',
      `접수번호는 ${ctx.ticketNo ?? '-'} 입니다.`,
      '문의 시 접수번호를 알려주시면 빠르게 확인할 수 있습니다.',
    ],
    choices: () => [BACK_TO_START],
  },

  // ── 제품정보 ──────────────────────────────────────────────────────────
  PRODUCT_SEARCH: {
    id: 'PRODUCT_SEARCH',
    say: () => ['정보를 확인하실 제품명을 입력해주세요.'],
    input: 'product-search',
  },

  PRODUCT_INFO: {
    id: 'PRODUCT_INFO',
    // 안내 문구는 DB 에서 온다. 여기서 문장을 만들지 않는다.
    say: () => [],
    choices: () => [
      { label: '다른 제품 보기', next: 'PRODUCT_SEARCH' },
      BACK_TO_START,
    ],
  },

  // ── 기타 ──────────────────────────────────────────────────────────────
  ETC: {
    id: 'ETC',
    say: () => ['고객센터로 문의해주세요.', ...CUSTOMER_SERVICE_LINES],
    choices: () => [BACK_TO_START],
  },
}

export const INITIAL_CONTEXT: FlowContext = {
  productId: null,
  productName: null,
  productPurpose: 'pharmacy',
  ticketNo: null,
}

/** 취급처를 못 찾았을 때 (§5-2, §13 — 조용히 실패하지 않는다) */
export const NO_PHARMACY_MESSAGE = [
  '10km 이내에 취급하는 곳을 찾지 못했습니다.',
  '고객센터로 문의해주시면 안내해드리겠습니다.',
  ...CUSTOMER_SERVICE_LINES,
]

/** 위치 권한이 거부됐을 때 (§5-2 — 에러 화면으로 끝내지 않는다) */
export const GEOLOCATION_FALLBACK_MESSAGE = [
  '현재 위치를 가져오지 못했습니다.',
  '주소를 입력해주시면 찾아드릴게요.',
]
