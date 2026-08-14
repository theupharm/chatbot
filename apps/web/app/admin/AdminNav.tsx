'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const MENU = [
  { href: '/admin/stats', label: '이용 통계' },
  { href: '/admin/complaints', label: '불만 접수' },
  { href: '/admin/pharmacies', label: '취급처 관리' },
  { href: '/admin/products', label: '제품 관리' },
  { href: '/admin/import', label: 'CSV 업로드' },
]

export function AdminNav() {
  const pathname = usePathname()

  return (
    <nav className="ad-nav">
      {MENU.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={pathname.startsWith(item.href) ? 'active' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
