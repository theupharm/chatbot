/**
 * 제품명 자동완성 (설계문서 §5-1)
 *
 * 결과가 0건이어도 빈 화면으로 끝내지 않는다. 서버가 함께 내려준 초성 인덱스로
 * 전체 제품을 훑어볼 수 있게 한다 (§13).
 */

import { useEffect, useRef, useState } from 'preact/hooks'
import { ApiError, searchProducts, fetchProductIndex, type IndexGroup } from '@/api'
import { SEARCH_DEBOUNCE_MS } from '@/config'

export interface SelectedProduct {
  id: number
  name: string
}

interface Props {
  /** 약국찾기 분기는 취급처가 있는 제품만 보여준다 */
  onlyWithPharmacy: boolean
  onSelect: (product: SelectedProduct) => void
  /** 검색 결과가 0건일 때 알려준다 (별칭 보강용 통계) */
  onNoResult?: (query: string) => void
}

interface Suggestion {
  id: number
  name: string
  packageSize: string | null
}

export function ProductSearch({ onlyWithPharmacy, onSelect, onNoResult }: Props) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [index, setIndex] = useState<IndexGroup[] | null>(null)
  const [activeInitial, setActiveInitial] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 늦게 도착한 응답이 최신 입력 결과를 덮어쓰지 않게 한다 */
  const requestId = useRef(0)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      setSuggestions([])
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const id = ++requestId.current
    const timer = window.setTimeout(async () => {
      try {
        const data = await searchProducts(trimmed, onlyWithPharmacy)
        if (id !== requestId.current) return

        setSuggestions(data.results)
        setError(null)
        if (data.results.length === 0) {
          onNoResult?.(trimmed)
          if (data.fallback) {
            setIndex(data.fallback.index)
            setActiveInitial(null)
          }
        }
      } catch (cause) {
        if (id !== requestId.current) return
        setSuggestions([])
        setError(cause instanceof ApiError ? cause.message : '검색에 실패했습니다.')
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
    // onNoResult 는 통계 전송용이라 의존성에 넣지 않는다. 넣으면 매 렌더마다 재검색이 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, onlyWithPharmacy])

  async function showAllProducts() {
    if (index) {
      setActiveInitial(null)
      setSuggestions([])
      return
    }
    setLoading(true)
    try {
      const data = await fetchProductIndex(onlyWithPharmacy)
      setIndex(data.index)
      setSuggestions([])
      setError(null)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const trimmed = query.trim()
  const showEmptyState = trimmed.length > 0 && !loading && suggestions.length === 0 && !error
  const activeGroup = index?.find((group) => group.initial === activeInitial) ?? null

  return (
    <div>
      <input
        class="input"
        type="text"
        value={query}
        maxLength={40}
        placeholder="제품명을 입력하세요"
        autocomplete="off"
        aria-label="제품명"
        onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
      />

      {loading && <div class="spinner">찾는 중…</div>}
      {error && <div class="error">{error}</div>}

      {suggestions.length > 0 && (
        <div class="suggestions">
          {suggestions.map((item) => (
            <button
              key={item.id}
              type="button"
              class="suggestion"
              onClick={() => onSelect({ id: item.id, name: item.name })}
            >
              {item.name}
              {item.packageSize && <span class="suggestion-size">{item.packageSize}</span>}
            </button>
          ))}
        </div>
      )}

      {showEmptyState && (
        <div class="bubble notice" style="margin-top:8px">
          제품을 찾지 못했어요. 아래에서 직접 선택해주세요.
        </div>
      )}

      {index === null && !showEmptyState && (
        <div class="index-initials">
          <button type="button" class="initial" style="min-width:auto;padding:7px 12px" onClick={showAllProducts}>
            전체 제품 보기
          </button>
        </div>
      )}

      {index !== null && (
        <>
          <div class="index-initials">
            {index.map((group) => (
              <button
                key={group.initial}
                type="button"
                class={`initial${group.initial === activeInitial ? ' active' : ''}`}
                onClick={() => setActiveInitial(group.initial)}
              >
                {group.initial}
              </button>
            ))}
          </div>

          {activeGroup && (
            <div class="suggestions">
              {activeGroup.products.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  class="suggestion"
                  onClick={() => onSelect({ id: item.id, name: item.name })}
                >
                  {item.name}
                  {item.packageSize && <span class="suggestion-size">{item.packageSize}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
