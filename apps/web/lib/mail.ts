/**
 * 메일 발송 (설계문서 §8)
 *
 * 불만 접수 → 고객센터 메일. 이상사례(AE) 의심 건은 PV(약물감시) 담당에게도 함께 보낸다.
 *
 * 전송은 **사내 그룹웨어(다우오피스) SMTP** 를 쓴다.
 * 접수 내용에는 환자 이상사례 정보와 의료인 연락처가 들어가므로, 외부 메일 API 를 거치면
 * 개인정보 국외이전에 해당해 별도 고지·동의가 필요해진다. 사내 SMTP 는 그 문제가 없다.
 *
 * 원칙
 *   - 저장이 먼저다. 메일이 실패해도 접수 데이터는 남는다 (§8-1)
 *   - 메일 실패를 사용자에게 전가하지 않는다. 접수는 완료된 것이고, 재발송은 관리자 몫이다
 *   - 오류 로그에 연락처·불만 내용을 남기지 않는다 (§13)
 */

import nodemailer, { type Transporter } from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import { CUSTOMER_SERVICE } from '@/lib/site-config'

let transporter: Transporter | null | undefined

interface SmtpSettings {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
}

function readSmtpSettings(): SmtpSettings | null {
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null

  const port = Number.parseInt(process.env.SMTP_PORT ?? '', 10)
  const resolvedPort = Number.isFinite(port) ? port : 465

  return {
    host,
    port: resolvedPort,
    // 465 는 접속 즉시 TLS(implicit), 587 은 STARTTLS 로 올린다
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : resolvedPort === 465,
    user,
    pass,
  }
}

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter

  const settings = readSmtpSettings()
  if (!settings) {
    transporter = null
    console.warn('[mail] SMTP 환경변수 미설정 — 메일 발송이 비활성화된 상태로 동작합니다.')
    return transporter
  }

  const options: SMTPTransport.Options = {
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    // 465(implicit TLS)가 아니면 STARTTLS 를 강제한다.
    // 평문으로 자격증명이 나가는 상황을 막기 위한 것이다 — 접수 내용에 개인정보가 있다.
    requireTLS: !settings.secure,
    auth: { user: settings.user, pass: settings.pass },
    // 연결 풀은 쓰지 않는다(기본값). 서버리스에서는 요청마다 함수가 새로 뜨므로 의미가 없다.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  }

  transporter = nodemailer.createTransport(options)
  return transporter
}

/** 발신 주소. 다우오피스는 인증 계정과 다른 주소로 보내면 거부할 수 있다 */
function fromAddress(): string {
  const explicit = process.env.MAIL_FROM
  if (explicit) return explicit
  const user = process.env.SMTP_USER ?? ''
  return user ? `더유제약 챗봇 <${user}>` : ''
}

/** SMTP 연결·인증만 확인한다 (점검 스크립트용). 메일은 보내지 않는다 */
export async function verifyMailTransport(): Promise<{ ok: boolean; error?: string }> {
  const transport = getTransporter()
  if (!transport) return { ok: false, error: 'SMTP 환경변수가 설정되지 않았습니다.' }

  try {
    await transport.verify()
    return { ok: true }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : '알 수 없는 오류' }
  }
}

function recipients(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address.length > 0)
}

export interface ComplaintMail {
  ticketNo: string
  orgName: string
  region: string
  content: string
  contact: string
  productName: string | null
  isAeSuspect: boolean
  aeKeywords: string[]
  createdAt: Date
}

export interface MailResult {
  sent: boolean
  /** 실패 사유. DB 의 email_error 에 남겨 재발송 판단에 쓴다 */
  error?: string
  /** 실제로 보낸 수신자 (감사용). 주소만 담고 본문은 담지 않는다 */
  to?: string[]
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** 메일 제목 (§8-2). AE 의심 건은 담당자가 받은편지함에서 바로 알아보게 앞에 표시한다 */
export function buildSubject(mail: ComplaintMail): string {
  const product = mail.productName ?? '제품 미지정'
  const base = `[챗봇 불만접수 ${mail.ticketNo}] ${mail.orgName} - ${product}`
  return mail.isAeSuspect ? `[이상사례 의심] ${base}` : base
}

const FIELD_LABELS: Array<[keyof ComplaintMail | 'createdAtLabel', string]> = [
  ['ticketNo', '접수번호'],
  ['createdAtLabel', '접수일시'],
  ['orgName', '상호명'],
  ['region', '시/군/구'],
  ['productName', '관련 제품'],
  ['contact', '연락처'],
]

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(date)
}

export function buildTextBody(mail: ComplaintMail): string {
  const lines = [
    '챗봇으로 제품 불만이 접수되었습니다.',
    '',
    `접수번호   ${mail.ticketNo}`,
    `접수일시   ${formatDateTime(mail.createdAt)}`,
    `상호명     ${mail.orgName}`,
    `시/군/구   ${mail.region}`,
    `관련 제품  ${mail.productName ?? '(선택 안 함)'}`,
    `연락처     ${mail.contact}`,
    '',
    '── 불만 내용 ──',
    mail.content,
    '',
  ]

  if (mail.isAeSuspect) {
    lines.push(
      '── 이상사례(AE) 의심 ──',
      `감지된 키워드: ${mail.aeKeywords.join(', ')}`,
      '약물감시 담당자에게도 함께 발송되었습니다. 보고 여부를 검토해주세요.',
      '',
    )
  }

  lines.push(`고객센터 ${CUSTOMER_SERVICE.phone} / ${CUSTOMER_SERVICE.email}`)
  return lines.join('\n')
}

export function buildHtmlBody(mail: ComplaintMail): string {
  const rows = FIELD_LABELS.map(([key, label]) => {
    const raw =
      key === 'createdAtLabel'
        ? formatDateTime(mail.createdAt)
        : key === 'productName'
          ? (mail.productName ?? '(선택 안 함)')
          : String(mail[key as keyof ComplaintMail] ?? '')
    return `<tr>
      <th style="text-align:left;padding:6px 12px 6px 0;color:#6b7280;font-weight:600;white-space:nowrap;vertical-align:top">${label}</th>
      <td style="padding:6px 0">${escapeHtml(raw)}</td>
    </tr>`
  }).join('')

  const aeBlock = mail.isAeSuspect
    ? `<div style="margin:16px 0;padding:12px 14px;background:#fff4f4;border-left:4px solid #c0392b;border-radius:4px">
         <strong style="color:#c0392b">이상사례(AE) 의심 건</strong>
         <div style="margin-top:6px;font-size:14px">감지된 키워드: ${escapeHtml(mail.aeKeywords.join(', '))}</div>
         <div style="margin-top:4px;font-size:14px">약물감시 담당자에게도 함께 발송되었습니다. 보고 여부를 검토해주세요.</div>
       </div>`
    : ''

  return `<div style="font-family:'Malgun Gothic',system-ui,sans-serif;color:#1a1a1a;line-height:1.6;max-width:640px">
  <h2 style="font-size:18px;margin:0 0 4px">챗봇 제품 불만 접수</h2>
  <p style="margin:0 0 16px;color:#6b7280;font-size:14px">챗봇으로 제품 불만이 접수되었습니다.</p>
  ${aeBlock}
  <table style="border-collapse:collapse;font-size:15px;margin-bottom:16px">${rows}</table>
  <div style="font-size:14px;color:#6b7280;margin-bottom:4px">불만 내용</div>
  <div style="white-space:pre-wrap;background:#f7f8f8;border:1px solid #e2e5e9;border-radius:8px;padding:12px 14px;font-size:15px">${escapeHtml(mail.content)}</div>
  <p style="margin-top:20px;font-size:13px;color:#9ca3af">
    고객센터 ${escapeHtml(CUSTOMER_SERVICE.phone)} / ${escapeHtml(CUSTOMER_SERVICE.email)}
  </p>
</div>`
}

/**
 * 불만 접수 메일 발송.
 *
 * 던지지 않는다. 실패는 MailResult 로 돌려주고 호출부가 DB 에 기록한다.
 * 메일 문제로 접수 자체가 실패하면 안 되기 때문이다 (§8-1).
 */
export async function sendComplaintMail(mail: ComplaintMail): Promise<MailResult> {
  const to = recipients(process.env.COMPLAINT_MAIL_TO)
  // AE 의심 건은 PV 담당에게도 보낸다 (§8-3)
  const pv = mail.isAeSuspect ? recipients(process.env.PV_MAIL_TO) : []
  const allRecipients = [...new Set([...to, ...pv])]

  if (allRecipients.length === 0) {
    return { sent: false, error: '수신 메일 주소가 설정되지 않았습니다 (COMPLAINT_MAIL_TO).' }
  }

  const transport = getTransporter()
  if (!transport) {
    return { sent: false, error: 'SMTP 환경변수가 설정되지 않았습니다.' }
  }

  const from = fromAddress()
  if (!from) {
    return { sent: false, error: '발신 주소가 설정되지 않았습니다 (MAIL_FROM 또는 SMTP_USER).' }
  }

  try {
    await transport.sendMail({
      from,
      to: allRecipients,
      subject: buildSubject(mail),
      text: buildTextBody(mail),
      html: buildHtmlBody(mail),
    })
    return { sent: true, to: allRecipients }
  } catch (cause) {
    // 예외 메시지에 본문이 섞이지 않도록 메시지만 취한다 (§13)
    return {
      sent: false,
      error: cause instanceof Error ? cause.message : '알 수 없는 오류',
      to: allRecipients,
    }
  }
}
