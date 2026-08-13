/**
 * 환경변수 접근 (설계문서 §11)
 *
 * import 시점이 아니라 실제 사용 시점에 검증한다.
 * 빌드 머신에 운영 환경변수가 없어도 `next build` 가 실패하지 않게 하기 위함이다.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`환경변수 ${name} 가 설정되지 않았습니다. .env.example 을 참고하세요.`)
  }
  return value
}

function optional(name: string): string | undefined {
  const value = process.env[name]
  return value && value.length > 0 ? value : undefined
}

export const env = {
  supabaseUrl: () => required('SUPABASE_URL'),
  supabaseAnonKey: () => required('SUPABASE_ANON_KEY'),
  /** 서버 전용. 클라이언트 코드에서 절대 참조하지 말 것 (§13) */
  supabaseServiceKey: () => required('SUPABASE_SERVICE_KEY'),

  upstashUrl: () => optional('UPSTASH_REDIS_REST_URL'),
  upstashToken: () => optional('UPSTASH_REDIS_REST_TOKEN'),

  /** 위젯을 임베드하는 홈페이지 origin 목록. 와일드카드는 허용하지 않는다 (§7) */
  allowedOrigins: (): string[] =>
    (optional('ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0 && o !== '*'),

  productCacheTtlSeconds: (): number => {
    const raw = optional('PRODUCT_CACHE_TTL_SECONDS')
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 300
  },
}
