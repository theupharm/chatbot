/**
 * 레이트리밋 (설계문서 §7 공통 규약)
 *
 * Vercel 서버리스는 인스턴스마다 메모리가 분리되므로 인메모리 카운터는 무용하다.
 * 공유 저장소(Upstash Redis)를 쓴다.
 *
 * Upstash 환경변수가 없으면 제한을 걸지 않고 통과시킨다(로컬 개발 편의).
 * 운영 배포 전 환경변수 설정 여부를 반드시 확인할 것.
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { env } from '@/lib/env'

export interface RateLimitRule {
  /** 윈도 내 허용 요청 수 */
  requests: number
  /** 윈도 길이(초) */
  windowSeconds: number
}

/** 공개 조회 API 기본값: IP당 분당 30회 */
export const PUBLIC_READ_LIMIT: RateLimitRule = { requests: 30, windowSeconds: 60 }

/** 불만 접수 등 쓰기 API: IP당 분당 3회 (Phase 4) */
export const SUBMIT_LIMIT: RateLimitRule = { requests: 3, windowSeconds: 60 }

let redis: Redis | null | undefined
const limiters = new Map<string, Ratelimit>()

function getRedis(): Redis | null {
  if (redis !== undefined) return redis

  const url = env.upstashUrl()
  const token = env.upstashToken()
  redis = url && token ? new Redis({ url, token }) : null

  if (!redis) {
    console.warn('[ratelimit] Upstash 미설정 — 레이트리밋이 비활성화된 상태로 동작합니다.')
  }
  return redis
}

function getLimiter(namespace: string, rule: RateLimitRule): Ratelimit | null {
  const client = getRedis()
  if (!client) return null

  const key = `${namespace}:${rule.requests}:${rule.windowSeconds}`
  let limiter = limiters.get(key)
  if (!limiter) {
    limiter = new Ratelimit({
      redis: client,
      limiter: Ratelimit.slidingWindow(rule.requests, `${rule.windowSeconds} s`),
      prefix: `rl:${namespace}`,
      analytics: false,
    })
    limiters.set(key, limiter)
  }
  return limiter
}

export interface RateLimitResult {
  allowed: boolean
  /** 429 응답에 붙일 Retry-After 헤더 값(초) */
  retryAfterSeconds?: number
}

/**
 * @param namespace 엔드포인트 구분자 (예: 'products-search')
 * @param identifier 보통 클라이언트 IP
 */
export async function checkRateLimit(
  namespace: string,
  identifier: string,
  rule: RateLimitRule = PUBLIC_READ_LIMIT,
): Promise<RateLimitResult> {
  const limiter = getLimiter(namespace, rule)
  if (!limiter) return { allowed: true }

  try {
    const result = await limiter.limit(identifier)
    if (result.success) return { allowed: true }

    const retryAfterMs = Math.max(result.reset - Date.now(), 0)
    return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) || 1 }
  } catch (error) {
    // 레이트리밋 저장소 장애가 서비스 장애가 되면 안 된다. 열어두고 로그만 남긴다.
    console.error('[ratelimit] 검사 실패 — 통과 처리:', error instanceof Error ? error.message : error)
    return { allowed: true }
  }
}
