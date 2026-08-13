'use client'

/**
 * 불만 접수 내역 (설계문서 §9-4)
 * 목록 조회 · AE 의심 필터 · 처리 상태 변경 · 메일 재발송
 */

import { Fragment, useCallback, useEffect, useState } from 'react'
import { apiGet, apiSend, formatDateTime, messageOf, type Paged } from '@/app/admin/client'

interface ComplaintRow {
  id: number
  ticket_no: string
  org_name: string
  region: string
  contact: string
  content: string
  productName: string | null
  is_ae_suspect: boolean
  ae_keywords: string[] | null
  status: 'new' | 'in_progress' | 'done'
  email_sent: boolean
  email_error: string | null
  created_at: string
}

const STATUS_LABEL: Record<ComplaintRow['status'], string> = {
  new: '신규',
  in_progress: '처리중',
  done: '완료',
}

const PAGE_SIZE = 20

export default function ComplaintsPage() {
  const [rows, setRows] = useState<ComplaintRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [aeOnly, setAeOnly] = useState(false)
  const [failedOnly, setFailedOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (status) params.set('status', status)
      if (aeOnly) params.set('ae', '1')
      if (failedOnly) params.set('failed', '1')

      const data = await apiGet<Paged<ComplaintRow>>(`/api/admin/complaints?${params}`)
      setRows(data.items)
      setTotal(data.total)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setLoading(false)
    }
  }, [page, status, aeOnly, failedOnly])

  useEffect(() => {
    void load()
  }, [load])

  async function changeStatus(id: number, next: ComplaintRow['status']) {
    setBusyId(id)
    setNotice(null)
    try {
      await apiSend(`/api/admin/complaints/${id}`, 'PATCH', { status: next })
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, status: next } : row)))
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusyId(null)
    }
  }

  async function resend(id: number, ticketNo: string) {
    setBusyId(id)
    setError(null)
    setNotice(null)
    try {
      const result = await apiSend<{ sent: boolean; to: string[] }>(
        `/api/admin/complaints/${id}/resend`,
        'POST',
      )
      setNotice(`${ticketNo} 재발송 완료 → ${result.to.join(', ')}`)
      setRows((prev) =>
        prev.map((row) => (row.id === id ? { ...row, email_sent: true, email_error: null } : row)),
      )
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusyId(null)
    }
  }

  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  return (
    <>
      <h1 className="ad-title">불만 접수</h1>
      <p className="ad-subtitle">
        챗봇으로 접수된 의료인 불만 내역입니다. 연락처는 목록에서 가려지고 상세를 펼치면 보입니다.
      </p>

      <div className="ad-panel">
        <div className="ad-toolbar">
          <select
            className="ad-select"
            style={{ width: 'auto' }}
            value={status}
            onChange={(e) => {
              setPage(1)
              setStatus(e.target.value)
            }}
          >
            <option value="">전체 상태</option>
            <option value="new">신규</option>
            <option value="in_progress">처리중</option>
            <option value="done">완료</option>
          </select>

          <label className="ad-check">
            <input
              type="checkbox"
              checked={aeOnly}
              onChange={(e) => {
                setPage(1)
                setAeOnly(e.target.checked)
              }}
            />
            이상사례 의심만
          </label>

          <label className="ad-check">
            <input
              type="checkbox"
              checked={failedOnly}
              onChange={(e) => {
                setPage(1)
                setFailedOnly(e.target.checked)
              }}
            />
            메일 실패만
          </label>

          <span className="ad-spacer" />
          <span className="ad-hint">총 {total}건</span>
          <button className="ad-btn sm" type="button" onClick={() => void load()}>
            새로고침
          </button>
        </div>

        {error && <div className="ad-alert error">{error}</div>}
        {notice && <div className="ad-alert ok">{notice}</div>}

        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>접수번호</th>
                <th>상호명</th>
                <th>지역</th>
                <th>제품</th>
                <th>연락처</th>
                <th>구분</th>
                <th>메일</th>
                <th>상태</th>
                <th>접수일시</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr>
                    <td>{row.ticket_no}</td>
                    <td>{row.org_name}</td>
                    <td>{row.region}</td>
                    <td>{row.productName ?? '-'}</td>
                    <td>{row.contact}</td>
                    <td>
                      {row.is_ae_suspect ? (
                        <span className="ad-badge ae">이상사례 의심</span>
                      ) : (
                        <span className="ad-hint">일반</span>
                      )}
                    </td>
                    <td>
                      {row.email_sent ? (
                        <span className="ad-hint">발송됨</span>
                      ) : (
                        <span className="ad-badge fail">실패</span>
                      )}
                    </td>
                    <td>
                      <select
                        className="ad-select"
                        style={{ width: 'auto', padding: '4px 8px', fontSize: 13 }}
                        value={row.status}
                        disabled={busyId === row.id}
                        onChange={(e) =>
                          void changeStatus(row.id, e.target.value as ComplaintRow['status'])
                        }
                      >
                        {(['new', 'in_progress', 'done'] as const).map((value) => (
                          <option key={value} value={value}>
                            {STATUS_LABEL[value]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">{formatDateTime(row.created_at)}</td>
                    <td className="num">
                      <button
                        className="ad-btn sm"
                        type="button"
                        onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                      >
                        {expanded === row.id ? '접기' : '상세'}
                      </button>
                    </td>
                  </tr>

                  {expanded === row.id && (
                    <tr>
                      <td colSpan={10} style={{ background: '#fbfcfb' }}>
                        <ComplaintDetail
                          id={row.id}
                          ticketNo={row.ticket_no}
                          emailError={row.email_error}
                          aeKeywords={row.ae_keywords ?? []}
                          busy={busyId === row.id}
                          onResend={() => void resend(row.id, row.ticket_no)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>

          {!loading && rows.length === 0 && <div className="ad-empty">접수 내역이 없습니다.</div>}
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

interface DetailData {
  contact: string
  content: string
  consent_at: string
}

function ComplaintDetail({
  id,
  ticketNo,
  emailError,
  aeKeywords,
  busy,
  onResend,
}: {
  id: number
  ticketNo: string
  emailError: string | null
  aeKeywords: string[]
  busy: boolean
  onResend: () => void
}) {
  const [detail, setDetail] = useState<DetailData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<DetailData>(`/api/admin/complaints/${id}`)
      .then((data) => {
        if (!cancelled) setDetail(data)
      })
      .catch((cause) => {
        if (!cancelled) setError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (error) return <div className="ad-alert error">{error}</div>
  if (!detail) return <div className="ad-hint">불러오는 중…</div>

  return (
    <div className="ad-detail">
      <dl>
        <dt>연락처</dt>
        <dd>{detail.contact}</dd>
        <dt>불만 내용</dt>
        <dd>{detail.content}</dd>
        <dt>동의 시각</dt>
        <dd>{formatDateTime(detail.consent_at)}</dd>
        {aeKeywords.length > 0 && (
          <>
            <dt>감지 키워드</dt>
            <dd>{aeKeywords.join(', ')}</dd>
          </>
        )}
        {emailError && (
          <>
            <dt>메일 오류</dt>
            <dd style={{ color: '#c0392b' }}>{emailError}</dd>
          </>
        )}
      </dl>

      <div style={{ marginTop: 12 }}>
        <button className="ad-btn" type="button" disabled={busy} onClick={onResend}>
          {busy ? '재발송 중…' : `${ticketNo} 메일 재발송`}
        </button>
      </div>
    </div>
  )
}
