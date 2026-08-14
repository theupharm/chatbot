'use client'

/**
 * 이용 통계 (설계문서 §9-5)
 *
 * 대화 내용은 저장하지 않으므로 "무엇을 물어봤는지"는 알 수 없다.
 * 여기서 보는 것은 어떤 분기를 얼마나 썼는지, 어떤 제품을 골랐는지,
 * 무엇을 찾다가 실패했는지다.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiGet, messageOf } from '@/app/admin/client'

interface DailyRow {
  day: string
  opens: number
  pharmacy: number
  complaint: number
  info: number
  etc: number
}

interface ProductRow {
  product_id: number
  name: string
  picks: number
}

interface FailedRow {
  query: string
  tries: number
  last_at: string
}

interface PharmacyRow {
  product_id: number
  name: string
  searches: number
  empty: number
}

interface RegionRow {
  sido: string
  searches: number
  empty: number
}

interface Stats {
  from: string
  to: string
  daily: DailyRow[]
  topProducts: ProductRow[]
  failedQueries: FailedRow[]
  pharmacySearch: PharmacyRow[]
  emptyRegions: RegionRow[]
}

const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

const PRESETS = [
  { label: '최근 7일', days: 6 },
  { label: '최근 30일', days: 29 },
  { label: '최근 90일', days: 89 },
]

export default function StatsPage() {
  const [from, setFrom] = useState(isoDaysAgo(29))
  const [to, setTo] = useState(isoDaysAgo(0))
  const [data, setData] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await apiGet<Stats>(`/api/admin/stats?from=${from}&to=${to}`))
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    void load()
  }, [load])

  const total = data
    ? data.daily.reduce(
        (acc, row) => ({
          opens: acc.opens + Number(row.opens),
          pharmacy: acc.pharmacy + Number(row.pharmacy),
          complaint: acc.complaint + Number(row.complaint),
          info: acc.info + Number(row.info),
          etc: acc.etc + Number(row.etc),
        }),
        { opens: 0, pharmacy: 0, complaint: 0, info: 0, etc: 0 },
      )
    : null

  const branchTotal = total ? total.pharmacy + total.complaint + total.info + total.etc : 0

  return (
    <>
      <h1 className="ad-title">이용 통계</h1>
      <p className="ad-subtitle">
        챗봇은 대화 내용을 저장하지 않습니다. 어떤 기능을 얼마나 썼는지와 검색 실패 기록만
        집계됩니다.
      </p>

      <div className="ad-panel">
        <div className="ad-toolbar" style={{ marginBottom: 0 }}>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              className="ad-btn sm"
              type="button"
              onClick={() => {
                setFrom(isoDaysAgo(preset.days))
                setTo(isoDaysAgo(0))
              }}
            >
              {preset.label}
            </button>
          ))}
          <input
            className="ad-input"
            style={{ width: 150 }}
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span className="ad-hint">~</span>
          <input
            className="ad-input"
            style={{ width: 150 }}
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
          <span className="ad-spacer" />
          <button className="ad-btn sm" type="button" onClick={() => void load()}>
            새로고침
          </button>
        </div>
      </div>

      {error && <div className="ad-alert error">{error}</div>}
      {loading && <div className="ad-panel ad-empty">불러오는 중…</div>}

      {!loading && data && total && (
        <>
          {total.opens === 0 && branchTotal === 0 && (
            <div className="ad-alert warn">
              이 기간에 기록된 이용이 없습니다. 통계 수집은 이 기능을 배포한 시점부터 쌓이므로,
              그 이전 기간은 비어 있습니다.
            </div>
          )}

          <div className="ad-panel">
            <h2 style={{ fontSize: 16, marginTop: 0 }}>기능별 이용</h2>
            <div className="ad-stat-row">
              <Stat label="대화 시작" value={total.opens} />
              <Stat label="약국찾기" value={total.pharmacy} share={branchTotal} />
              <Stat label="제품불만" value={total.complaint} share={branchTotal} />
              <Stat label="제품정보" value={total.info} share={branchTotal} />
              <Stat label="기타" value={total.etc} share={branchTotal} />
            </div>
          </div>

          <div className="ad-panel">
            <h2 style={{ fontSize: 16, marginTop: 0 }}>일별 추이</h2>
            {data.daily.length === 0 ? (
              <div className="ad-empty">기록이 없습니다.</div>
            ) : (
              <div className="ad-table-wrap">
                <table className="ad-table">
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th style={{ textAlign: 'right' }}>대화</th>
                      <th style={{ textAlign: 'right' }}>약국찾기</th>
                      <th style={{ textAlign: 'right' }}>제품불만</th>
                      <th style={{ textAlign: 'right' }}>제품정보</th>
                      <th style={{ textAlign: 'right' }}>기타</th>
                      <th style={{ width: '35%' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily.map((row) => (
                      <tr key={row.day}>
                        <td>{row.day}</td>
                        <td className="num">{Number(row.opens).toLocaleString()}</td>
                        <td className="num">{Number(row.pharmacy).toLocaleString()}</td>
                        <td className="num">{Number(row.complaint).toLocaleString()}</td>
                        <td className="num">{Number(row.info).toLocaleString()}</td>
                        <td className="num">{Number(row.etc).toLocaleString()}</td>
                        <td>
                          <Bar
                            value={Number(row.opens)}
                            max={Math.max(...data.daily.map((d) => Number(d.opens)), 1)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="ad-panel">
            <h2 style={{ fontSize: 16, marginTop: 0 }}>많이 찾는 제품</h2>
            <SimpleTable
              columns={['제품', '선택 횟수']}
              rows={data.topProducts.map((row) => [row.name, Number(row.picks).toLocaleString()])}
              empty="기록이 없습니다."
            />
          </div>

          <div className="ad-panel">
            <h2 style={{ fontSize: 16, marginTop: 0 }}>찾지 못한 검색어</h2>
            <p className="ad-hint" style={{ marginTop: -6, marginBottom: 12 }}>
              결과가 0건이었던 검색어입니다. 자주 나오는 것은 해당 제품의 <strong>별칭</strong>으로
              등록해두면 다음부터 검색됩니다.
            </p>
            <SimpleTable
              columns={['검색어', '횟수', '마지막 시도']}
              rows={data.failedQueries.map((row) => [
                row.query,
                Number(row.tries).toLocaleString(),
                new Date(row.last_at).toLocaleDateString('ko-KR'),
              ])}
              empty="찾지 못한 검색어가 없습니다."
            />
          </div>

          <div className="ad-panel">
            <h2 style={{ fontSize: 16, marginTop: 0 }}>취급처 검색 결과</h2>
            <p className="ad-hint" style={{ marginTop: -6, marginBottom: 12 }}>
              "가까운 곳 없음"이 많은 제품은 취급처 등록이 부족하다는 뜻입니다.
            </p>
            <SimpleTable
              columns={['제품', '검색', '0건', '0건 비율']}
              rows={data.pharmacySearch.map((row) => {
                const searches = Number(row.searches)
                const empty = Number(row.empty)
                return [
                  row.name,
                  searches.toLocaleString(),
                  empty.toLocaleString(),
                  searches > 0 ? `${Math.round((empty / searches) * 100)}%` : '-',
                ]
              })}
              empty="기록이 없습니다."
            />
          </div>

          <div className="ad-panel">
            <h2 style={{ fontSize: 16, marginTop: 0 }}>지역별 취급처 검색</h2>
            <p className="ad-hint" style={{ marginTop: -6, marginBottom: 12 }}>
              주소를 입력해 검색한 건만 집계됩니다. 현재 위치로 찾은 건은 위치 정보를 저장하지
              않으므로 지역이 남지 않습니다.
            </p>
            <SimpleTable
              columns={['지역', '검색', '0건']}
              rows={data.emptyRegions.map((row) => [
                row.sido,
                Number(row.searches).toLocaleString(),
                Number(row.empty).toLocaleString(),
              ])}
              empty="기록이 없습니다."
            />
          </div>
        </>
      )}
    </>
  )
}

function Stat({ label, value, share }: { label: string; value: number; share?: number }) {
  const percent = share && share > 0 ? Math.round((value / share) * 100) : null

  return (
    <div className="ad-stat">
      <div className="ad-stat-label">{label}</div>
      <div className="ad-stat-value">{value.toLocaleString()}</div>
      {percent !== null && <div className="ad-stat-sub">{percent}%</div>}
    </div>
  )
}

function Bar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="ad-bar">
      <div className="ad-bar-fill" style={{ width: `${width}%` }} />
    </div>
  )
}

function SimpleTable({
  columns,
  rows,
  empty,
}: {
  columns: string[]
  rows: Array<Array<string | number>>
  empty: string
}) {
  if (rows.length === 0) return <div className="ad-empty">{empty}</div>

  return (
    <div className="ad-table-wrap">
      <table className="ad-table">
        <thead>
          <tr>
            {columns.map((column, i) => (
              <th key={column} style={i > 0 ? { textAlign: 'right' } : undefined}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={j > 0 ? 'num' : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
