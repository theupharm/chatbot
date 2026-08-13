/** 스크립트 공용: .env.local 로더 (외부 의존성 없이) */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** 이미 설정된 환경변수는 덮어쓰지 않는다 */
export function loadEnvFile(file = '.env.local'): void {
  const resolved = path.resolve(process.cwd(), file)
  if (!existsSync(resolved)) return

  for (const line of readFileSync(resolved, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eq = trimmed.indexOf('=')
    if (eq === -1) continue

    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}
