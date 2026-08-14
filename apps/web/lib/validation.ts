/**
 * 입력 검증 스키마 (설계문서 §7 공통 규약)
 * 모든 사용자 입력은 Zod 로 검증하고 길이를 제한한다.
 */

import { z } from 'zod'

/**
 * 불리언 쿼리 파라미터. `1`/`true` 만 참으로 본다.
 * 값이 없으면 undefined 로 두어 "필터 없음"과 구분한다.
 */
const booleanFlag = z
  .enum(['1', 'true', '0', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === '1' || v === 'true'))

/** 제품 검색어. §7 길이 제한 40자 */
export const productSearchQuerySchema = z.object({
  q: z.string().trim().min(1, '검색어를 입력해주세요.').max(40),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  /** [약국찾기] 분기용. 취급처 매핑이 있는 제품만 반환한다 */
  has_pharmacy: booleanFlag,
})

export const productCatalogQuerySchema = z.object({
  has_pharmacy: booleanFlag,
})

export const productIdSchema = z.coerce.number().int().positive()

/**
 * 의료인 불만 접수 (§8). 길이 제한은 §7 공통 규약을 따른다.
 * `consent` 는 반드시 true 여야 한다 — 동의 없이 연락처를 받지 않는다.
 */
export const complaintSchema = z.object({
  orgName: z.string().trim().min(1, '상호명을 입력해주세요.').max(60),
  region: z.string().trim().min(1, '시/군/구를 입력해주세요.').max(60),
  content: z.string().trim().min(1, '불만 내용을 입력해주세요.').max(2000),
  contact: z.string().trim().min(1, '연락처를 입력해주세요.').max(40),
  productId: z.coerce.number().int().positive().nullable().optional(),
  consent: z.literal(true, {
    errorMap: () => ({ message: '개인정보 수집·이용에 동의해주세요.' }),
  }),
})

export type ComplaintInput = z.infer<typeof complaintSchema>

/**
 * 이용 통계 이벤트 (§9-5).
 *
 * 받아들이는 필드를 좁게 제한한다. 위젯이 실수로든 의도적으로든 개인정보를 실어 보내도
 * 스키마에서 걸러지도록 하는 것이 목적이다.
 */
export const usageEventSchema = z.object({
  sessionId: z.string().uuid(),
  type: z.enum([
    'widget_open',
    'branch',
    'product_search',
    'product_select',
    'pharmacy_search',
    'complaint_submit',
  ]),
  branch: z.enum(['pharmacy', 'complaint', 'info', 'etc']).nullable().optional(),
  productId: z.coerce.number().int().positive().nullable().optional(),
  query: z.string().trim().max(40).nullable().optional(),
  sido: z.string().trim().max(10).nullable().optional(),
  resultCount: z.coerce.number().int().min(0).max(1000).nullable().optional(),
})

export const usageEventBatchSchema = z.object({
  events: z.array(usageEventSchema).min(1).max(20),
})

// ── 관리자 (§9) ─────────────────────────────────────────────────────────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))

/**
 * 제품 등록·수정.
 * `name_norm`/`name_jamo`/`name_chosung` 은 받지 않는다 — 서버가 이름에서 다시 만든다 (§13).
 */
export const adminProductSchema = z.object({
  name: z.string().trim().min(1, '제품명을 입력해주세요.').max(80),
  packageSize: optionalText(40),
  category: optionalText(40),
  infoUrl: z.string().trim().url('올바른 URL 이 아닙니다.').max(500).nullable().optional(),
  infoText: optionalText(4000),
  aliases: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  isActive: z.boolean().default(true),
})

/**
 * 취급처 등록·수정.
 * 좌표는 받지 않는다 — 주소를 서버가 지오코딩해서 채운다. 실패하면 저장을 막는다 (§9-2).
 */
export const adminPharmacySchema = z.object({
  name: z.string().trim().min(1, '상호명을 입력해주세요.').max(80),
  orgType: z.enum(['pharmacy', 'clinic', 'other']).default('pharmacy'),
  address: z.string().trim().min(1, '주소를 입력해주세요.').max(200),
  phone: optionalText(40),
  productIds: z.array(z.coerce.number().int().positive()).max(200).default([]),
  isActive: z.boolean().default(true),
})

export const complaintStatusSchema = z.object({
  status: z.enum(['new', 'in_progress', 'done']),
})

/** 통계 조회 기간 (§9-5). 기본값은 최근 30일 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않습니다.')

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

export const statsQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .transform((value) => ({
    from: value.from ?? daysAgo(29),
    to: value.to ?? daysAgo(0),
  }))
  .refine((value) => value.from <= value.to, { message: '시작일이 종료일보다 늦습니다.' })

/** 목록 조회 공통 페이지네이션 */
export const adminListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

/** 주소 검색어 (§5-2 경로 B). §7 길이 제한 100자 */
export const geocodeQuerySchema = z.object({
  q: z.string().trim().min(1, '주소를 입력해주세요.').max(100),
})

/**
 * 취급처 거리 검색 (§5-2).
 * 좌표는 대한민국 범위로 제한한다 — 범위 밖 좌표는 잘못된 요청이다.
 */
export const pharmacySearchQuerySchema = z.object({
  product_id: z.coerce.number().int().positive(),
  lat: z.coerce.number().min(32).max(39.5),
  lng: z.coerce.number().min(124).max(132),
  limit: z.coerce.number().int().min(1).max(10).optional(),
  radius_km: z.coerce.number().min(1).max(50).optional(),
})
