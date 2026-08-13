'use client'

/**
 * 취급처 관리 (설계문서 §9-2)
 *
 * 저장 시 서버가 주소를 지오코딩한다. 좌표를 못 찾으면 저장이 막히고,
 * 성공하면 변환된 도로명주소와 좌표를 보여줘 담당자가 위치를 확인할 수 있게 한다.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiSend, messageOf, type Paged } from '@/app/admin/client'

interface PharmacyRow {
  id: number
  name: string
  org_type: 'pharmacy' | 'clinic' | 'other'
  address: string
  sido: string | null
  sigungu: string | null
  phone: string | null
  lat: number
  lng: number
  is_active: boolean
}

interface ProductOption {
  id: number
  name: string
  package_size: string | null
}

const ORG_LABEL: Record<PharmacyRow['org_type'], string> = {
  pharmacy: '약국',
  clinic: '의원',
  other: '기타',
}

const SIDO_LIST = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
]

const PAGE_SIZE = 20

interface FormState {
  id: number | null
  name: string
  orgType: PharmacyRow['org_type']
  address: string
  phone: string
  productIds: number[]
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  orgType: 'pharmacy',
  address: '',
  phone: '',
  productIds: [],
  isActive: true,
}

export default function PharmaciesPage() {
  const [rows, setRows] = useState<PharmacyRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [sido, setSido] = useState('')
  const [products, setProducts] = useState<ProductOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (search) params.set('q', search)
      if (sido) params.set('sido', sido)

      const data = await apiGet<Paged<PharmacyRow>>(`/api/admin/pharmacies?${params}`)
      setRows(data.items)
      setTotal(data.total)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setLoading(false)
    }
  }, [page, search, sido])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    apiGet<Paged<ProductOption>>('/api/admin/products?pageSize=100')
      .then((data) => setProducts(data.items))
      .catch((cause) => setError(messageOf(cause)))
  }, [])

  async function openEdit(id: number) {
    setError(null)
    setNotice(null)
    try {
      const detail = await apiGet<PharmacyRow & { productIds: number[] }>(
        `/api/admin/pharmacies/${id}`,
      )
      setForm({
        id: detail.id,
        name: detail.name,
        orgType: detail.org_type,
        address: detail.address,
        phone: detail.phone ?? '',
        productIds: detail.productIds,
        isActive: detail.is_active,
      })
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!form) return

    setSaving(true)
    setError(null)
    setNotice(null)

    const payload = {
      name: form.name,
      orgType: form.orgType,
      address: form.address,
      phone: form.phone,
      productIds: form.productIds,
      isActive: form.isActive,
    }

    try {
      const result = await apiSend<{ id: number; resolved: { address: string; lat: number; lng: number } }>(
        form.id ? `/api/admin/pharmacies/${form.id}` : '/api/admin/pharmacies',
        form.id ? 'PATCH' : 'POST',
        payload,
      )
      setNotice(
        `저장했습니다. 주소 확인 결과: ${result.resolved.address} (${result.resolved.lat.toFixed(6)}, ${result.resolved.lng.toFixed(6)})`,
      )
      setForm(null)
      await load()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setSaving(false)
    }
  }

  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  return (
    <>
      <h1 className="ad-title">취급처 관리</h1>
      <p className="ad-subtitle">
        저장할 때 주소를 좌표로 변환합니다. 좌표를 찾지 못하면 저장되지 않습니다.
      </p>

      {error && <div className="ad-alert error">{error}</div>}
      {notice && <div className="ad-alert ok">{notice}</div>}

      {form && (
        <form className="ad-panel" onSubmit={save}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>
            {form.id ? '취급처 수정' : '취급처 등록'}
          </h2>

          <div className="ad-grid2">
            <div className="ad-field">
              <label className="ad-label" htmlFor="ph-name">
                상호명<span className="req">*</span>
              </label>
              <input
                id="ph-name"
                className="ad-input"
                value={form.name}
                maxLength={80}
                required
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="ad-field">
              <label className="ad-label" htmlFor="ph-type">
                기관 유형
              </label>
              <select
                id="ph-type"
                className="ad-select"
                value={form.orgType}
                onChange={(e) =>
                  setForm({ ...form, orgType: e.target.value as PharmacyRow['org_type'] })
                }
              >
                <option value="pharmacy">약국</option>
                <option value="clinic">의원</option>
                <option value="other">기타</option>
              </select>
            </div>
          </div>

          <div className="ad-field">
            <label className="ad-label" htmlFor="ph-address">
              주소<span className="req">*</span>
            </label>
            <input
              id="ph-address"
              className="ad-input"
              value={form.address}
              maxLength={200}
              required
              placeholder="예: 인천 남동구 남동대로 892"
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
            <span className="ad-hint">
              저장 시 좌표로 변환됩니다. 층·호수는 그대로 보존되니 함께 적어주세요.
            </span>
          </div>

          <div className="ad-grid2">
            <div className="ad-field">
              <label className="ad-label" htmlFor="ph-phone">
                전화번호
              </label>
              <input
                id="ph-phone"
                className="ad-input"
                value={form.phone}
                maxLength={40}
                placeholder="032-427-7585"
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            <div className="ad-field">
              <span className="ad-label">노출 여부</span>
              <label className="ad-check">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                챗봇 검색 결과에 노출
              </label>
            </div>
          </div>

          <div className="ad-field">
            <span className="ad-label">취급 제품</span>
            <div className="ad-checks">
              {products.map((product) => (
                <label className="ad-check" key={product.id}>
                  <input
                    type="checkbox"
                    checked={form.productIds.includes(product.id)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        productIds: e.target.checked
                          ? [...form.productIds, product.id]
                          : form.productIds.filter((id) => id !== product.id),
                      })
                    }
                  />
                  {product.name}
                  {product.package_size && (
                    <span className="ad-hint">{product.package_size}</span>
                  )}
                </label>
              ))}
            </div>
            <span className="ad-hint">
              선택한 제품의 약국찾기 결과에 이 취급처가 나옵니다.
            </span>
          </div>

          <div className="ad-toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
            <button className="ad-btn primary" type="submit" disabled={saving}>
              {saving ? '주소 확인 중…' : '저장'}
            </button>
            <button className="ad-btn" type="button" onClick={() => setForm(null)}>
              취소
            </button>
          </div>
        </form>
      )}

      <div className="ad-panel">
        <div className="ad-toolbar">
          <input
            className="ad-input"
            style={{ width: 220 }}
            placeholder="상호명 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(1)
                setSearch(q)
              }
            }}
          />
          <button
            className="ad-btn"
            type="button"
            onClick={() => {
              setPage(1)
              setSearch(q)
            }}
          >
            검색
          </button>

          <select
            className="ad-select"
            style={{ width: 'auto' }}
            value={sido}
            onChange={(e) => {
              setPage(1)
              setSido(e.target.value)
            }}
          >
            <option value="">전체 지역</option>
            {SIDO_LIST.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <span className="ad-spacer" />
          <span className="ad-hint">총 {total.toLocaleString()}곳</span>
          <button className="ad-btn primary" type="button" onClick={() => setForm({ ...EMPTY_FORM })}>
            새 취급처 등록
          </button>
        </div>

        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>상호명</th>
                <th>유형</th>
                <th>주소</th>
                <th>전화</th>
                <th>좌표</th>
                <th>노출</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>
                    <span className={`ad-badge ${row.org_type}`}>{ORG_LABEL[row.org_type]}</span>
                  </td>
                  <td>{row.address}</td>
                  <td>{row.phone ?? '-'}</td>
                  <td className="ad-hint">
                    {row.lat.toFixed(4)}, {row.lng.toFixed(4)}
                  </td>
                  <td>
                    {row.is_active ? (
                      <span className="ad-hint">노출</span>
                    ) : (
                      <span className="ad-badge off">숨김</span>
                    )}
                  </td>
                  <td className="num">
                    <button className="ad-btn sm" type="button" onClick={() => void openEdit(row.id)}>
                      수정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && rows.length === 0 && <div className="ad-empty">등록된 취급처가 없습니다.</div>}
          {loading && <div className="ad-empty">불러오는 중…</div>}
        </div>

        <div className="ad-pager">
          <button className="ad-btn sm" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            이전
          </button>
          <span>
            {page} / {lastPage}
          </span>
          <button
            className="ad-btn sm"
            type="button"
            disabled={page >= lastPage}
            onClick={() => setPage(page + 1)}
          >
            다음
          </button>
        </div>
      </div>
    </>
  )
}
