/**
 * 관리자 레이아웃 (설계문서 §9)
 *
 * 미들웨어는 "로그인 여부"만 본다. "관리자 권한"은 여기서 확인한다.
 * 로그인은 했지만 admin_users 에 없는 사용자는 아무 데이터도 보지 못한다.
 */

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { checkAdmin } from '@/lib/admin-auth'
import { AdminNav } from '@/app/admin/AdminNav'
import './admin.css'

export const metadata: Metadata = {
  title: '더유제약 챗봇 관리자',
  robots: { index: false, follow: false },
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const result = await checkAdmin()

  // 로그인 화면에서는 헤더 없이 내용만 보여준다
  if (result.state === 'anonymous') return <>{children}</>

  if (result.state === 'not-allowed') {
    return (
      <div className="ad-login">
        <div className="ad-login-box">
          <h1 className="ad-title">접근 권한이 없습니다</h1>
          <p className="ad-subtitle">
            {result.email ?? '이 계정'}은(는) 관리자로 등록되어 있지 않습니다.
            <br />
            시스템 담당자에게 권한 등록을 요청해주세요.
          </p>
          <form action="/api/auth/logout" method="post">
            <button className="ad-btn" type="submit" style={{ width: '100%' }}>
              로그아웃
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <>
      <header className="ad-header">
        <span className="ad-brand">더유제약 챗봇</span>
        <AdminNav />
        <div className="ad-user">
          <span>{result.admin.email}</span>
          <form action="/api/auth/logout" method="post">
            <button className="ad-btn sm" type="submit">
              로그아웃
            </button>
          </form>
        </div>
      </header>
      <main className="ad-main">{children}</main>
    </>
  )
}
