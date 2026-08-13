'use client'

/**
 * 관리자 로그인 (설계문서 §9)
 *
 * Supabase Auth 이메일+비밀번호. 계정은 Supabase 대시보드에서 직접 만든다.
 * 이 화면에는 회원가입이 없다 — 아무나 가입해서 관리자가 되면 안 되기 때문이다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null
        setError(body?.error?.message ?? '이메일 또는 비밀번호가 올바르지 않습니다.')
        return
      }

      router.push('/admin/complaints')
      router.refresh()
    } catch {
      setError('로그인 중 오류가 발생했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ad-login">
      <form className="ad-login-box" onSubmit={handleSubmit}>
        <h1 className="ad-title">더유제약 챗봇 관리자</h1>
        <p className="ad-subtitle">등록된 관리자 계정으로 로그인해주세요.</p>

        {error && <div className="ad-alert error">{error}</div>}

        <div className="ad-field">
          <label className="ad-label" htmlFor="email">
            이메일
          </label>
          <input
            id="email"
            className="ad-input"
            type="email"
            value={email}
            autoComplete="username"
            required
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="ad-field">
          <label className="ad-label" htmlFor="password">
            비밀번호
          </label>
          <input
            id="password"
            className="ad-input"
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button className="ad-btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
      </form>
    </div>
  )
}
