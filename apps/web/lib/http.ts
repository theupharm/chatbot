/**
 * API 공통 응답·CORS 처리 (설계문서 §7 공통 규약)
 *
 * 에러 메시지는 사용자에게 그대로 보여줄 수 있는 한국어 문구만 담는다.
 * 내부 예외 정보는 응답에 넣지 않는다.
 */

import { env } from '@/lib/env'

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'FORBIDDEN_ORIGIN'
  | 'UNAUTHORIZED'
  | 'CONFLICT'
  | 'INTERNAL'

const USER_MESSAGE: Record<ErrorCode, string> = {
  INVALID_INPUT: '입력값을 확인해주세요.',
  RATE_LIMITED: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
  NOT_FOUND: '요청하신 정보를 찾을 수 없습니다.',
  FORBIDDEN_ORIGIN: '허용되지 않은 요청입니다.',
  UNAUTHORIZED: '로그인이 필요합니다.',
  CONFLICT: '이미 등록된 항목입니다.',
  INTERNAL: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
}

/**
 * 요청 origin 이 허용 목록에 있으면 CORS 헤더를 만든다.
 * 목록에 없으면 CORS 헤더를 붙이지 않는다(브라우저가 차단). 와일드카드는 쓰지 않는다.
 */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin')
  if (!origin) return {}
  if (!env.allowedOrigins().includes(origin)) return {}

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export interface JsonOptions {
  status?: number
  /** 예: 's-maxage=300, stale-while-revalidate=60' */
  cacheControl?: string
  headers?: Record<string, string>
}

export function json(request: Request, body: unknown, options: JsonOptions = {}): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(request),
    ...options.headers,
  }
  if (options.cacheControl) {
    headers['Cache-Control'] = options.cacheControl
  }

  return new Response(JSON.stringify(body), { status: options.status ?? 200, headers })
}

export function apiError(
  request: Request,
  code: ErrorCode,
  options: { status?: number; message?: string; headers?: Record<string, string> } = {},
): Response {
  const status =
    options.status ??
    ({
      INVALID_INPUT: 400,
      RATE_LIMITED: 429,
      NOT_FOUND: 404,
      FORBIDDEN_ORIGIN: 403,
      UNAUTHORIZED: 401,
      CONFLICT: 409,
      INTERNAL: 500,
    }[code] as number)

  return json(
    request,
    { error: { code, message: options.message ?? USER_MESSAGE[code] } },
    { status, headers: options.headers },
  )
}

/** CORS preflight */
export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

/** 레이트리밋 키로 쓸 클라이언트 IP. 프록시 헤더가 없으면 'unknown' */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip') ?? 'unknown'
}

/**
 * 라우트 핸들러 공통 예외 처리.
 * 내부 오류는 서버 로그에만 남기고 사용자에게는 일반 문구를 준다.
 * 개인정보가 섞일 수 있는 요청 바디는 로그에 남기지 않는다 (§13).
 */
export function handleUnexpected(request: Request, error: unknown, context: string): Response {
  // 인증 실패는 예상된 흐름이다. 500 으로 뭉뚱그리지 않는다.
  if (error instanceof Error && error.name === 'UnauthorizedError') {
    return apiError(request, 'UNAUTHORIZED')
  }
  console.error(`[api] ${context} 실패:`, error instanceof Error ? error.message : error)
  return apiError(request, 'INTERNAL')
}

/** Postgres unique 제약 위반 */
export const UNIQUE_VIOLATION = '23505'
