/**
 * SMTP 연결·발송 점검 (설계문서 §8)
 *
 *   npm run check:mail --workspace @theu/web
 *   npm run check:mail --workspace @theu/web -- --send
 *   npm run check:mail --workspace @theu/web -- --send --ae
 *
 * 옵션
 *   --send   실제로 테스트 메일을 보낸다 (기본은 연결·인증만 확인)
 *   --ae     이상사례 의심 건으로 보낸다 (PV 수신 주소까지 가는지 확인)
 *
 * 비밀번호는 출력하지 않는다.
 */

import { loadEnvFile } from './_env'

loadEnvFile()

function mask(value: string | undefined): string {
  if (!value) return '(미설정)'
  return `설정됨 (${value.length}자)`
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const doSend = args.includes('--send')
  const asAe = args.includes('--ae')

  console.log('── SMTP 설정')
  console.log(`  SMTP_HOST         ${process.env.SMTP_HOST ?? '(미설정)'}`)
  console.log(`  SMTP_PORT         ${process.env.SMTP_PORT ?? '(기본 465)'}`)
  console.log(`  SMTP_SECURE       ${process.env.SMTP_SECURE ?? '(포트로 자동 판단)'}`)
  console.log(`  SMTP_USER         ${process.env.SMTP_USER ?? '(미설정)'}`)
  console.log(`  SMTP_PASS         ${mask(process.env.SMTP_PASS)}`)
  console.log(`  MAIL_FROM         ${process.env.MAIL_FROM ?? '(SMTP_USER 사용)'}`)
  console.log(`  COMPLAINT_MAIL_TO ${process.env.COMPLAINT_MAIL_TO ?? '(미설정)'}`)
  console.log(`  PV_MAIL_TO        ${process.env.PV_MAIL_TO ?? '(미설정)'}`)
  console.log('')

  const { verifyMailTransport, sendComplaintMail, buildSubject } = await import('../lib/mail')

  console.log('── 연결·인증 확인')
  const verified = await verifyMailTransport()
  if (!verified.ok) {
    console.error(`✗ 실패: ${verified.error}`)
    console.error('')
    console.error('  자주 나오는 원인')
    console.error('   · 호스트/포트가 다름 → 다우오피스 관리자 > 메일 > 외부 메일 프로그램 설정 확인')
    console.error('   · 외부 메일 프로그램(IMAP/SMTP) 사용이 꺼져 있음')
    console.error('   · 계정 비밀번호가 아니라 앱 비밀번호가 필요함')
    console.error('   · 메일 서버가 IP 허용목록 방식이라 현재 IP 가 막힘')
    process.exit(1)
  }
  console.log('✓ 연결·인증 성공')
  console.log('')

  if (!doSend) {
    console.log('테스트 메일을 보내려면 --send 를 붙이세요.')
    return
  }

  const sample = {
    ticketNo: 'C-TEST-0000',
    orgName: '(발송 테스트)',
    region: '서울 강남구',
    content: asAe
      ? '연동 확인용 테스트입니다. 바른 뒤 발진이 생기고 가려워서 병원에 갔다고 합니다.'
      : '연동 확인용 테스트입니다. 실제 접수 건이 아닙니다.',
    contact: 'test@example.com',
    productName: '닥터로반연고',
    isAeSuspect: asAe,
    aeKeywords: asAe ? ['발진', '가려'] : [],
    createdAt: new Date(),
  }

  console.log('── 테스트 발송')
  console.log(`  제목: ${buildSubject(sample)}`)

  const result = await sendComplaintMail(sample)
  if (!result.sent) {
    console.error(`✗ 발송 실패: ${result.error}`)
    process.exit(1)
  }

  console.log(`✓ 발송 성공 → ${result.to?.join(', ')}`)
  if (asAe) {
    console.log('  PV 수신 주소가 위 목록에 포함되어 있어야 합니다 (§8-3).')
  }
}

main().catch((error: unknown) => {
  console.error('✗ 점검 중 오류:', error instanceof Error ? error.message : error)
  process.exit(1)
})
