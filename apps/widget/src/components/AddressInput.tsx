/**
 * 주소 입력 → 좌표 (설계문서 §5-2 경로 B)
 *
 * 후보가 여러 개면 사용자가 고르게 한다. 0건이어도 에러로 끝내지 않고 재입력을 안내한다.
 */

import { useState } from 'preact/hooks'
import { ApiError, geocode, type AddressCandidate } from '@/api'

interface Props {
  onResolved: (candidate: AddressCandidate) => void
}

export function AddressInput({ onResolved }: Props) {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<AddressCandidate[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function search(event: Event) {
    event.preventDefault()
    const trimmed = query.trim()
    if (trimmed.length === 0) return

    setLoading(true)
    setError(null)
    setCandidates(null)

    try {
      const data = await geocode(trimmed)
      if (data.candidates.length === 1) {
        onResolved(data.candidates[0]!)
        return
      }
      setCandidates(data.candidates)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '주소를 찾지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={search}>
      <div class="field">
        <input
          class="input"
          type="text"
          value={query}
          maxLength={100}
          placeholder="예: 수원 영통"
          aria-label="주소"
          autocomplete="off"
          onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
        />
      </div>

      <button class="submit" type="submit" disabled={loading || query.trim().length === 0}>
        {loading ? '찾는 중…' : '주소 찾기'}
      </button>

      {error && <div class="error" style="margin-top:8px">{error}</div>}

      {candidates !== null && candidates.length === 0 && (
        <div class="bubble notice" style="margin-top:8px">
          해당 주소를 찾지 못했습니다. 시/군/구를 포함해 다시 입력해주세요.
        </div>
      )}

      {candidates !== null && candidates.length > 1 && (
        <>
          <div class="hint" style="margin-top:10px">여러 곳이 검색되었습니다. 한 곳을 선택해주세요.</div>
          <div class="suggestions">
            {candidates.map((candidate, i) => (
              <button
                key={`${candidate.lat},${candidate.lng},${i}`}
                type="button"
                class="suggestion"
                onClick={() => onResolved(candidate)}
              >
                {candidate.placeName ? `${candidate.placeName} · ` : ''}
                {candidate.address}
              </button>
            ))}
          </div>
        </>
      )}
    </form>
  )
}
