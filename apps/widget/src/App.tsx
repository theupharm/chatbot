/**
 * 챗봇 셸 (설계문서 §3, §6)
 *
 * 상태 전이는 전부 여기서 일어난다. 서버는 데이터만 준다.
 * 대화 내용은 메모리에만 있고 서버로 보내지 않는다 (§13).
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import {
  ApiError,
  fetchProduct,
  getCurrentPosition,
  searchPharmacies,
  type AddressCandidate,
  type Pharmacy,
} from '@/api'
import { SITE } from '@/config'
import {
  FLOW,
  GEOLOCATION_FALLBACK_MESSAGE,
  GREETING,
  INITIAL_CONTEXT,
  NO_PHARMACY_MESSAGE,
  type Choice,
  type FlowContext,
  type StepId,
} from '@/scenario/flow'
import { extractSido, resetSession, track, type BranchKey } from '@/analytics'
import { mapRouteUrl, mapViewUrl } from '@/map-link'
import { AddressInput } from '@/components/AddressInput'
import { BotAvatar, ContactList, IntroBlock, LogoBadge } from '@/components/Intro'
import { ComplaintForm } from '@/components/ComplaintForm'
import { ProductSearch, type SelectedProduct } from '@/components/ProductSearch'

type Message =
  | { kind: 'bot'; text: string }
  | { kind: 'user'; text: string }
  | { kind: 'notice'; text: string }
  | { kind: 'pharmacies'; items: Pharmacy[] }
  | { kind: 'links'; items: Array<{ label: string; url: string }> }

let messageSeq = 0
const withId = (message: Message) => ({ ...message, id: ++messageSeq })
type Keyed = Message & { id: number }

/** 통계에 남길 분기 이름 (§9-5) */
const BRANCH_OF: Partial<Record<StepId, BranchKey>> = {
  PHARMACY_PRODUCT: 'pharmacy',
  COMPLAINT_WHO: 'complaint',
  PRODUCT_SEARCH: 'info',
  ETC: 'etc',
}

export function App() {
  const [open, setOpen] = useState(false)
  /** 헤더 펼침 여부. 기본은 접힌 상태 */
  const [headerOpen, setHeaderOpen] = useState(false)
  const [step, setStep] = useState<StepId>('START')
  const [context, setContext] = useState<FlowContext>(INITIAL_CONTEXT)
  const [messages, setMessages] = useState<Keyed[]>([])
  const [busy, setBusy] = useState(false)

  const bodyRef = useRef<HTMLDivElement | null>(null)
  /** effect 가 같은 스텝에서 두 번 돌지 않게 한다 */
  const handledEffect = useRef<string | null>(null)

  const say = useCallback((texts: string[], kind: 'bot' | 'notice' = 'bot') => {
    if (texts.length === 0) return
    setMessages((prev) => [...prev, ...texts.map((text) => withId({ kind, text }))])
  }, [])

  const push = useCallback((message: Message) => {
    setMessages((prev) => [...prev, withId(message)])
  }, [])

  /** 스텝 이동. 진입 문구를 자동으로 붙인다 */
  const goto = useCallback(
    (next: StepId, patch: Partial<FlowContext> = {}) => {
      setContext((prev) => {
        const merged = { ...prev, ...patch }
        say(FLOW[next].say(merged))
        return merged
      })
      setStep(next)
    },
    [say],
  )

  // 첫 진입 문구
  useEffect(() => {
    if (open && messages.length === 0) {
      say(FLOW.START.say(INITIAL_CONTEXT))
    }
  }, [open, messages.length, say])

  // 새 메시지가 붙으면 아래로 스크롤
  useEffect(() => {
    const body = bodyRef.current
    if (body) body.scrollTop = body.scrollHeight
  }, [messages, step])

  const runPharmacySearch = useCallback(
    async (lat: number, lng: number, productId: number, sido?: string) => {
      setBusy(true)
      try {
        const data = await searchPharmacies(productId, lat, lng)
        track({
          type: 'pharmacy_search',
          productId,
          resultCount: data.results.length,
          // 주소로 검색한 경우에만 지역을 남긴다. 좌표에서 유도하지 않는다 (§13)
          ...(sido ? { sido } : {}),
        })
        if (data.found) {
          say([`가까운 취급처 ${data.results.length}곳을 찾았습니다.`])
          push({ kind: 'pharmacies', items: data.results })
        } else {
          say(NO_PHARMACY_MESSAGE, 'notice')
        }
        setStep('PHARMACY_RESULT')
      } catch (cause) {
        say([cause instanceof ApiError ? cause.message : '검색에 실패했습니다.'], 'notice')
        setStep('PHARMACY_RESULT')
      } finally {
        setBusy(false)
      }
    },
    [push, say],
  )

  // 현재 위치로 찾기 (§5-2 경로 A). 실패하면 주소 입력으로 자연스럽게 넘어간다
  useEffect(() => {
    const current = FLOW[step]
    if (current.effect !== 'search-pharmacies-by-geolocation') return
    if (handledEffect.current === step) return
    handledEffect.current = step
  }, [step])

  const useCurrentLocation = useCallback(async () => {
    setBusy(true)
    say(['현재 위치를 확인하고 있어요…'])
    const position = await getCurrentPosition()
    setBusy(false)

    if (!position) {
      say(GEOLOCATION_FALLBACK_MESSAGE, 'notice')
      goto('PHARMACY_ADDRESS')
      return
    }
    if (context.productId !== null) {
      await runPharmacySearch(position.lat, position.lng, context.productId)
    }
  }, [context.productId, goto, runPharmacySearch, say])

  const handleChoice = useCallback(
    (choice: Choice) => {
      if (choice.href) {
        window.open(choice.href, '_blank', 'noopener,noreferrer')
        return
      }
      if (!choice.next) return

      push({ kind: 'user', text: choice.label })

      // 현재 위치 버튼만 특별 처리: 좌표를 얻은 뒤에야 결과 스텝으로 간다
      if (step === 'PHARMACY_LOCATION' && choice.next === 'PHARMACY_RESULT') {
        void useCurrentLocation()
        return
      }

      if (choice.next === 'START') {
        // 처음으로 돌아가면 새 대화로 센다
        resetSession()
        setContext(INITIAL_CONTEXT)
        setMessages([])
        setStep('START')
        say(FLOW.START.say(INITIAL_CONTEXT))
        track({ type: 'widget_open' })
        return
      }

      const branch = BRANCH_OF[choice.next]
      if (branch) track({ type: 'branch', branch })

      goto(choice.next)
    },
    [goto, push, say, step, useCurrentLocation],
  )

  const handleProductSelected = useCallback(
    async (product: SelectedProduct) => {
      push({ kind: 'user', text: product.name })
      track({ type: 'product_select', productId: product.id })

      if (step === 'PHARMACY_PRODUCT') {
        goto('PHARMACY_LOCATION', { productId: product.id, productName: product.name })
        return
      }

      // 제품정보 분기: 안내 문구는 DB 에서 받아 그대로 출력한다 (§13)
      setBusy(true)
      try {
        const detail = await fetchProduct(product.id)
        say([detail.infoText])
        if (detail.infoLinks.length > 0) push({ kind: 'links', items: detail.infoLinks })
        setContext((prev) => ({ ...prev, productId: product.id, productName: product.name }))
        setStep('PRODUCT_INFO')
      } catch (cause) {
        say([cause instanceof ApiError ? cause.message : '제품 정보를 불러오지 못했습니다.'], 'notice')
        setStep('PRODUCT_INFO')
      } finally {
        setBusy(false)
      }
    },
    [goto, push, say, step],
  )

  const handleAddressResolved = useCallback(
    async (candidate: AddressCandidate) => {
      push({ kind: 'user', text: candidate.address })
      if (context.productId !== null) {
        await runPharmacySearch(
          candidate.lat,
          candidate.lng,
          context.productId,
          extractSido(candidate.address),
        )
      }
    },
    [context.productId, push, runPharmacySearch],
  )

  const handleComplaintSubmitted = useCallback(
    (ticketNo: string) => {
      push({ kind: 'user', text: '불만 접수 양식을 제출했습니다.' })
      track({ type: 'complaint_submit' })
      goto('COMPLAINT_DONE', { ticketNo })
    },
    [goto, push],
  )

  if (!open) {
    return (
      <div class="root">
        <button
          class="launcher"
          type="button"
          aria-label={`${SITE.company} 챗봇 열기`}
          onClick={() => {
            setOpen(true)
            track({ type: 'widget_open' })
          }}
        >
          💬
        </button>
        {/*
          로고 심볼 버전 (보류). 쓰려면 아래로 교체하고
          styles.css 의 `.launcher` 로고 버전 주석도 함께 되살릴 것.
          import { LOGO_SYMBOL_DATA_URI } from '@/logo' 도 필요하다.

          <img class="launcher-logo" src={LOGO_SYMBOL_DATA_URI} alt="" />
        */}
      </div>
    )
  }

  const current = FLOW[step]
  const choices = current.choices?.(context) ?? []

  return (
    <div class="root open">
      <div class="panel" role="dialog" aria-label={`${SITE.company} 챗봇`}>
        <div class={`header${headerOpen ? ' expanded' : ''}`}>
          {/* 헤더를 누르면 연락 수단까지 펼쳐진다 */}
          <button
            class="header-main"
            type="button"
            aria-expanded={headerOpen}
            onClick={() => setHeaderOpen(!headerOpen)}
          >
            <LogoBadge size={headerOpen ? 64 : 34} />
            <span class="header-text">
              <span class="header-title">{SITE.company} 챗봇</span>
              <span class="header-greeting">{GREETING}</span>
            </span>
          </button>

          {headerOpen && <ContactList />}

          <div class="header-actions">
            <button
              class="icon-button"
              type="button"
              aria-label="처음으로"
              title="처음으로"
              onClick={() => handleChoice({ label: '처음으로', next: 'START' })}
            >
              ↻
            </button>
            <button
              class="icon-button"
              type="button"
              aria-label="닫기"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
        </div>

        <div class="body" ref={bodyRef}>
          <IntroBlock />
          <div class="day-divider">
            <span>오늘</span>
          </div>

          {messages.map((message, index) => (
            <MessageView
              key={message.id}
              message={message}
              // 봇이 연달아 말할 때는 첫 줄에만 아바타를 붙인다
              showAvatar={isBotSide(message) && !isBotSide(messages[index - 1])}
            />
          ))}

          {busy && <div class="spinner">잠시만 기다려주세요…</div>}

          {!busy && choices.length > 0 && (
            <div class="choices indented">
              {choices.map((choice) => (
                <button
                  key={choice.label}
                  type="button"
                  class={`choice${choice.primary ? ' primary' : ''}`}
                  onClick={() => handleChoice(choice)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {current.input && current.input !== 'none' && (
          <div class="footer">
            {current.input === 'product-search' && (
              <ProductSearch
                onlyWithPharmacy={step === 'PHARMACY_PRODUCT'}
                onSelect={(product) => void handleProductSelected(product)}
                onNoResult={(query) =>
                  track({ type: 'product_search', query, resultCount: 0 })
                }
              />
            )}
            {current.input === 'address' && (
              <AddressInput onResolved={(candidate) => void handleAddressResolved(candidate)} />
            )}
            {current.input === 'complaint-form' && (
              <ComplaintForm onSubmitted={handleComplaintSubmitted} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** 봇 쪽에서 나온 메시지인지 (아바타를 붙일 대상) */
function isBotSide(message: Keyed | undefined): boolean {
  return message !== undefined && (message.kind === 'bot' || message.kind === 'notice')
}

function MessageView({
  message,
  showAvatar,
}: {
  message: Keyed
  showAvatar: boolean
}): JSX.Element {
  switch (message.kind) {
    case 'bot':
    case 'notice':
      return (
        <div class="row">
          {showAvatar ? <BotAvatar /> : <div class="avatar-gap" />}
          <div class={`bubble ${message.kind}`}>{message.text}</div>
        </div>
      )
    case 'user':
      return <div class="bubble user">{message.text}</div>
    case 'links':
      return (
        <div class="choices indented">
          {message.items.map((link) => (
            <a
              key={link.url}
              class="choice primary"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.label}
            </a>
          ))}
        </div>
      )
    case 'pharmacies':
      return (
        <>
          {message.items.map((item) => (
            <div class="card" key={item.id}>
              <div class="card-head">
                <span class="card-name">{item.name}</span>
                {item.orgLabel && (
                  <span class={`badge${item.orgType === 'clinic' ? ' clinic' : ''}`}>
                    {item.orgLabel}
                  </span>
                )}
                <span class="card-distance">{item.distanceKm.toFixed(1)}km</span>
              </div>
              <div class="card-address">{item.address}</div>
              {item.phone && <div class="card-address">{item.phone}</div>}
              <div class="card-actions">
                <a
                  class="choice"
                  href={mapRouteUrl(item.name, item.lat, item.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  길찾기
                </a>
                <a
                  class="choice"
                  href={mapViewUrl(item.name, item.lat, item.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  지도보기
                </a>
                {item.phone && (
                  <a class="choice" href={`tel:${item.phone}`}>
                    전화
                  </a>
                )}
              </div>
            </div>
          ))}
        </>
      )
  }
}
