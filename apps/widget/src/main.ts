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
const FONT_LINK_ID = 'theu-chatbot-font'

/** Pretendard (오픈 폰트 라이선스). 글자 단위로 쪼개진 subset 이라 필요한 만큼만 받아온다 */
const FONT_CSS_URL =
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css'

/**
 * 폰트 선언을 **부모 문서**에 넣는다.
 *
 * Shadow DOM 안에 @font-face 를 써도 브라우저가 무시하기 때문이다.
 * 폰트 이름으로만 동작하므로 홈페이지의 다른 요소에는 영향이 없다.
 *
 * 홈페이지의 CSP 가 외부 스타일시트를 막으면 이 요청은 실패한다. 그래도 문제없다 —
 * styles.css 의 대체 폰트 목록으로 자연스럽게 넘어간다.
 */
function loadFont(): void {
  if (document.getElementById(FONT_LINK_ID)) return

  const link = document.createElement('link')
  link.id = FONT_LINK_ID
  link.rel = 'stylesheet'
  link.href = FONT_CSS_URL
  link.crossOrigin = 'anonymous'
  document.head.appendChild(link)
}

function mount(): void {
  if (document.getElementById(HOST_ID)) return

  loadFont()

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
