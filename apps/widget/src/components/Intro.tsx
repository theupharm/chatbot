/**
 * 인트로 구성요소 (설계문서 §10)
 *
 * 기존 Botpress 챗봇의 화면 구성을 따른다.
 *   - 헤더는 접힌 상태가 기본이고, 누르면 펼쳐져 연락 수단까지 보여준다
 *   - 대화 영역 위쪽에는 로고·이름·인사말이 놓인다
 *
 * 문구는 flow.ts 와 config/site.json 에서만 온다. 여기서 만들지 않는다 (§13).
 */

import { SITE } from '@/config'
import { LOGO_SYMBOL_DATA_URI } from '@/logo'
import { GREETING } from '@/scenario/flow'

/** 흰 원형 배지 안의 로고. size 는 배지 지름(px) */
export function LogoBadge({ size }: { size: number }) {
  return (
    <span class="badge-circle" style={`width:${size}px;height:${size}px`}>
      <img src={LOGO_SYMBOL_DATA_URI} alt="" style={`width:${Math.round(size * 0.6)}px`} />
    </span>
  )
}

/** 봇 말풍선 왼쪽에 붙는 작은 아바타 */
export function BotAvatar() {
  return (
    <div class="avatar" aria-hidden="true">
      <img src={LOGO_SYMBOL_DATA_URI} alt="" />
    </div>
  )
}

function MailIcon() {
  return (
    <svg class="contact-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3.5 7A1.5 1.5 0 0 1 5 5.5h14A1.5 1.5 0 0 1 20.5 7v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17V7Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
      />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" fill="none" stroke="currentColor" stroke-width="1.6" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg class="contact-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.2 4.2c.5 0 1 .35 1.15.85l.85 2.8c.13.45 0 .95-.35 1.25l-1.1 1a11.5 11.5 0 0 0 4.65 4.65l1-1.1c.3-.35.8-.48 1.25-.35l2.8.85c.5.15.85.65.85 1.15v2.5c0 .7-.55 1.25-1.25 1.25A15.9 15.9 0 0 1 3.7 5.45c0-.7.55-1.25 1.25-1.25h2.25Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg class="contact-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6">
      <circle cx="12" cy="12" r="8.2" />
      <ellipse cx="12" cy="12" rx="3.6" ry="8.2" />
      <path d="M4.2 9.5h15.6M4.2 14.5h15.6" />
    </svg>
  )
}

/** 펼친 헤더에 들어가는 연락 수단 목록 */
export function ContactList() {
  const { phone, email } = SITE.cs

  return (
    <div class="contacts">
      <a class="contact" href={`mailto:${email}`}>
        <MailIcon />
        <span>{email}</span>
      </a>
      <a class="contact" href={`tel:${phone}`}>
        <PhoneIcon />
        <span>{phone}</span>
      </a>
      <a class="contact" href={SITE.links.homepage} target="_blank" rel="noopener noreferrer">
        <GlobeIcon />
        <span>{SITE.links.homepage}</span>
      </a>
      <div class="contact-hours">{SITE.cs.hoursLabel}</div>
    </div>
  )
}

/** 대화 영역 맨 위의 인트로 블록 */
export function IntroBlock() {
  return (
    <div class="intro">
      <LogoBadge size={64} />
      <div class="intro-name">{SITE.company} 챗봇</div>
      <p class="intro-greeting">{GREETING}</p>
    </div>
  )
}
