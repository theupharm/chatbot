import { redirect } from 'next/navigation'

/** /admin 진입 시 첫 화면으로 보낸다 */
export default function AdminIndexPage() {
  redirect('/admin/complaints')
}
