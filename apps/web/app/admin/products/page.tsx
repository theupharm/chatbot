'use client'

/**
 * 제품 관리 (설계문서 §9-1)
 *
 * 별칭·카테고리·안내 문구를 편집한다.
 * name_norm / name_jamo / name_chosung 은 서버가 저장 시 만들므로 화면에 노출하지 않는다.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiSend, messageOf, type Paged } from '@/app/admin/client'

interface ProductRow {
  id: number
  name: string
  name_norm: string
  package_size: string | null
  category: string | null
  aliases: string[] | null
  info_url: string | null
  info_text: string | null
  is_active: boolean
}

const PAGE_SIZE = 20

interface FormState {
  id: number | null
  name: string
  packageSize: string
  category: string
  aliases: string
  infoUrl: string
  infoText: string
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  packageSize: '',
  category: '',
  aliases: '',
  infoUrl: '',
  infoText: '',
  isActive: true,
}

export default function ProductsPage() {
  const [rows, setRows] = useState<ProductRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
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

      const data = await apiGet<Paged<ProductRow>>(`/api/admin/products?${params}`)
      setRows(data.items)
      setTotal(data.total)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    void load()
  }, [load])

  function openEdit(row: ProductRow) {
    setNotice(null)
    setForm({
      id: row.id,
      name: row.name,
      packageSize: row.package_size ?? '',
      category: row.category ?? '',
      aliases: (row.aliases ?? []).join(', '),
      infoUrl: row.info_url ?? '',
      infoText: row.info_text ?? '',
      isActive: row.is_active,
    })
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!form) return

    setSaving(true)
    setError(null)
    setNotice(null)

    const payload = {
      name: form.name,
      packageSize: form.packageSize,
      category: form.category,
      aliases: form.aliases
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      infoUrl: form.infoUrl.trim() === '' ? null : form.infoUrl.trim(),
      infoText: form.infoText,
      isActive: form.isActive,
    }

    try {
      await apiSend(
        form.id ? `/api/admin/products/${form.id}` : '/api/admin/products',
        form.id ? 'PATCH' : 'POST',
        payload,
      )
      setNotice('저장했습니다. 챗봇에는 최대 5분 안에 반영됩니다.')
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
      <h1 className="ad-title">제품 관리</h1>
      <p className="ad-subtitle">
        별칭을 넣어두면 사용자가 다르게 입력해도 검색됩니다. 안내 문구는 [제품정보] 분기에서
        그대로 출력됩니다.
      </p>

      {error && <div className="ad-alert error">{error}</div>}
      {notice && <div className="ad-alert ok">{notice}</div>}

      {form && (
        <form className="ad-panel" onSubmit={save}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>{form.id ? '제품 수정' : '제품 등록'}</h2>

          <div className="ad-grid2">
            <div className="ad-field">
              <label className="ad-label" htmlFor="pr-name">
                제품명<span className="req">*</span>
              </label>
              <input
                id="pr-name"
                className="ad-input"
                value={form.name}
                maxLength={80}
                required
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="ad-field">
              <label className="ad-label" htmlFor="pr-size">
                규격
              </label>
              <input
                id="pr-size"
                className="ad-input"
                value={form.packageSize}
                maxLength={40}
                placeholder="500g, 30T"
                onChange={(e) => setForm({ ...form, packageSize: e.target.value })}
              />
            </div>
          </div>

          <div className="ad-grid2">
            <div className="ad-field">
              <label className="ad-label" htmlFor="pr-category">
                카테고리
              </label>
              <input
                id="pr-category"
                className="ad-input"
                value={form.category}
                maxLength={40}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
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
            <label className="ad-label" htmlFor="pr-aliases">
              별칭
            </label>
            <input
              id="pr-aliases"
              className="ad-input"
              value={form.aliases}
              onChange={(e) => setForm({ ...form, aliases: e.target.value })}
              placeholder="쉼표로 구분. 예: 로반연고, 닥터로반"
            />
            <span className="ad-hint">
              사용자가 자주 잘못 입력하는 이름을 넣어주세요. 오타는 자동으로도 어느 정도 잡힙니다.
            </span>
          </div>

          <div className="ad-field">
            <label className="ad-label" htmlFor="pr-url">
              정보 링크
            </label>
            <input
              id="pr-url"
              className="ad-input"
              type="url"
              value={form.infoUrl}
              onChange={(e) => setForm({ ...form, infoUrl: e.target.value })}
              placeholder="https://nedrug.mfds.go.kr/..."
            />
          </div>

          <div className="ad-field">
            <label className="ad-label" htmlFor="pr-info">
              안내 문구
            </label>
            <textarea
              id="pr-info"
              className="ad-textarea"
              value={form.infoText}
              maxLength={4000}
              onChange={(e) => setForm({ ...form, infoText: e.target.value })}
            />
            <span className="ad-hint">
              사용자에게 그대로 보이는 문구입니다. 줄바꿈이 유지됩니다.
            </span>
          </div>

          <div className="ad-toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
            <button className="ad-btn primary" type="submit" disabled={saving}>
              {saving ? '저장 중…' : '저장'}
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
            placeholder="제품명 검색"
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

          <span className="ad-spacer" />
          <span className="ad-hint">총 {total}종</span>
          <button className="ad-btn primary" type="button" onClick={() => setForm({ ...EMPTY_FORM })}>
            새 제품 등록
          </button>
        </div>

        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>제품명</th>
                <th>규격</th>
                <th>카테고리</th>
                <th>별칭</th>
                <th>안내 문구</th>
                <th>노출</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.package_size ?? '-'}</td>
                  <td>{row.category ?? '-'}</td>
                  <td className="ad-hint">{(row.aliases ?? []).join(', ') || '-'}</td>
                  <td>
                    {row.info_text ? (
                      <span className="ad-hint">있음</span>
                    ) : (
                      <span className="ad-badge fail">없음</span>
                    )}
                  </td>
                  <td>
                    {row.is_active ? (
                      <span className="ad-hint">노출</span>
                    ) : (
                      <span className="ad-badge off">숨김</span>
                    )}
                  </td>
                  <td className="num">
                    <button className="ad-btn sm" type="button" onClick={() => openEdit(row)}>
                      수정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && rows.length === 0 && <div className="ad-empty">등록된 제품이 없습니다.</div>}
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
