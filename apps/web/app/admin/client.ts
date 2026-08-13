'use client'

/** 관리자 화면 공용 fetch. 서버가 준 사용자 노출용 메시지를 그대로 올린다 */

export class AdminApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdminApiError'
  }
}

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null

  if (!response.ok || !body) {
    throw new AdminApiError(body?.error?.message ?? '요청을 처리하지 못했습니다.')
  }
  return body
}

export async function apiGet<T>(path: string): Promise<T> {
  return parse<T>(await fetch(path, { headers: { Accept: 'application/json' } }))
}

export async function apiSend<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  return parse<T>(
    await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value))
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
