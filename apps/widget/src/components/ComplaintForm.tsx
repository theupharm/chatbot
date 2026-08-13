/**
 * 의료인 불만 접수 양식 (설계문서 §6, §8)
 *
 * 상호명 → 시/군/구 → 관련제품(선택) → 불만내용 → 연락처 → 개인정보 동의 순서.
 * 동의 없이는 제출 버튼이 활성화되지 않는다.
 */

import { useState } from 'preact/hooks'
import { ApiError, submitComplaint } from '@/api'
import { SITE } from '@/config'
import { ProductSearch, type SelectedProduct } from '@/components/ProductSearch'

interface Props {
  onSubmitted: (ticketNo: string) => void
}

const LIMITS = {
  orgName: 60,
  region: 60,
  content: 2000,
  contact: 40,
}

export function ComplaintForm({ onSubmitted }: Props) {
  const [orgName, setOrgName] = useState('')
  const [region, setRegion] = useState('')
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  const [product, setProduct] = useState<SelectedProduct | null>(null)
  const [pickingProduct, setPickingProduct] = useState(false)
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit =
    orgName.trim().length > 0 &&
    region.trim().length > 0 &&
    content.trim().length > 0 &&
    contact.trim().length > 0 &&
    consent &&
    !submitting

  async function handleSubmit(event: Event) {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setError(null)

    try {
      const { ticketNo } = await submitComplaint({
        orgName: orgName.trim(),
        region: region.trim(),
        content: content.trim(),
        contact: contact.trim(),
        productId: product?.id ?? null,
        consent: true,
      })
      onSubmitted(ticketNo)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '접수에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div class="field">
        <label class="label" for="theu-org">
          상호명<span class="required">*</span>
        </label>
        <input
          id="theu-org"
          class="input"
          type="text"
          value={orgName}
          maxLength={LIMITS.orgName}
          onInput={(e) => setOrgName((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="field">
        <label class="label" for="theu-region">
          시/군/구<span class="required">*</span>
        </label>
        <input
          id="theu-region"
          class="input"
          type="text"
          value={region}
          maxLength={LIMITS.region}
          placeholder="예: 서울 강남구"
          onInput={(e) => setRegion((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="field">
        <span class="label">관련 제품 <span class="hint">(선택)</span></span>
        {product ? (
          <div class="card-head">
            <span class="card-name">{product.name}</span>
            <button
              type="button"
              class="choice ghost"
              style="padding:4px 10px;font-size:13px;margin-left:auto"
              onClick={() => setProduct(null)}
            >
              변경
            </button>
          </div>
        ) : pickingProduct ? (
          <ProductSearch
            onlyWithPharmacy={false}
            onSelect={(selected) => {
              setProduct(selected)
              setPickingProduct(false)
            }}
          />
        ) : (
          <button type="button" class="choice ghost" onClick={() => setPickingProduct(true)}>
            제품 선택하기
          </button>
        )}
      </div>

      <div class="field">
        <label class="label" for="theu-content">
          불만 내용<span class="required">*</span>
        </label>
        <textarea
          id="theu-content"
          class="textarea"
          value={content}
          maxLength={LIMITS.content}
          onInput={(e) => setContent((e.target as HTMLTextAreaElement).value)}
        />
        <span class="hint">
          {content.length} / {LIMITS.content}자
        </span>
      </div>

      <div class="field">
        <label class="label" for="theu-contact">
          연락처<span class="required">*</span>
        </label>
        <input
          id="theu-contact"
          class="input"
          type="text"
          value={contact}
          maxLength={LIMITS.contact}
          placeholder="연락 가능한 전화번호 또는 이메일"
          onInput={(e) => setContact((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="consent-box">{SITE.privacy.consentNotice}</div>

      <label class="consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent((e.target as HTMLInputElement).checked)}
        />
        <span>
          개인정보 수집·이용에 동의합니다.<span class="required">*</span>
        </span>
      </label>

      {error && <div class="error" style="margin-bottom:8px">{error}</div>}

      <button class="submit" type="submit" disabled={!canSubmit}>
        {submitting ? '접수 중…' : '접수하기'}
      </button>
    </form>
  )
}
