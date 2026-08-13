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
  INITIAL_CONTEXT,
  NO_PHARMACY_MESSAGE,
  type Choice,
  type FlowContext,
  type StepId,
} from '@/scenario/flow'
import { mapRouteUrl, mapViewUrl } from '@/map-link'
import { AddressInput } from '@/components/AddressInput'
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

export function App() {
  const [open, setOpen] = useState(false)
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
    async (lat: number, lng: number, productId: number) => {
      setBusy(true)
      try {
        const data = await searchPharmacies(productId, lat, lng)
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
        setContext(INITIAL_CONTEXT)
        setMessages([])
        setStep('START')
        say(FLOW.START.say(INITIAL_CONTEXT))
        return
      }

      goto(choice.next)
    },
    [goto, push, say, step, useCurrentLocation],
  )

  const handleProductSelected = useCallback(
    async (product: SelectedProduct) => {
      push({ kind: 'user', text: product.name })

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
        await runPharmacySearch(candidate.lat, candidate.lng, context.productId)
      }
    },
    [context.productId, push, runPharmacySearch],
  )

  const handleComplaintSubmitted = useCallback(
    (ticketNo: string) => {
      push({ kind: 'user', text: '불만 접수 양식을 제출했습니다.' })
      goto('COMPLAINT_DONE', { ticketNo })
    },
    [goto, push],
  )

  if (!open) {
    return (
      <div class="root">
        <button class="launcher" type="button" aria-label="챗봇 열기" onClick={() => setOpen(true)}>
          💬
        </button>
      </div>
    )
  }

  const current = FLOW[step]
  const choices = current.choices?.(context) ?? []

  return (
    <div class="root open">
      <div class="panel" role="dialog" aria-label={`${SITE.company} 챗봇`}>
        <div class="header">
          <span class="header-title">{SITE.company} 챗봇</span>
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
          {messages.map((message) => (
            <MessageView key={message.id} message={message} />
          ))}

          {busy && <div class="spinner">잠시만 기다려주세요…</div>}

          {!busy && choices.length > 0 && (
            <div class="choices">
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

function MessageView({ message }: { message: Keyed }): JSX.Element {
  switch (message.kind) {
    case 'bot':
      return <div class="bubble bot">{message.text}</div>
    case 'user':
      return <div class="bubble user">{message.text}</div>
    case 'notice':
      return <div class="bubble notice">{message.text}</div>
    case 'links':
      return (
        <div class="choices">
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
