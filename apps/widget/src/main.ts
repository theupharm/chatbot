/**
 * 위젯 진입점 (설계문서 §10)
 *
 * 부모 페이지에 DOM 을 직접 붙이되 Shadow DOM 으로 감싼다.
 * - 홈페이지 CSS 와 서로 간섭하지 않는다
 * - iframe 이 아니므로 Geolocation 이 부모 페이지 권한으로 동작한다
 *   (iframe 이면 홈페이지에 allow="geolocation" 을 넣어달라고 해야 하고,
 *    누락되면 §5-2 경로 A 가 통째로 실패한다)
 */

import { render } from 'preact'
import { h } from 'preact'
import { App } from '@/App'
import styles from '@/styles.css?inline'

const HOST_ID = 'theu-chatbot-root'

function mount(): void {
  if (document.getElementById(HOST_ID)) return

  const host = document.createElement('div')
  host.id = HOST_ID
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = styles
  shadow.appendChild(style)

  const container = document.createElement('div')
  shadow.appendChild(container)

  render(h(App, {}), container)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true })
} else {
  mount()
}
