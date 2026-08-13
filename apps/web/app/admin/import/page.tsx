'use client'

/**
 * CSV 일괄 업로드 (설계문서 §9-3)
 *
 * 브라우저에서 CSV 를 파싱해 200행씩 나눠 보낸다. 서버 함수 실행시간 제한 때문이다.
 * 검증만 먼저 돌려볼 수 있게 "검증만 하기"를 기본으로 둔다 — 수천 행을 되돌리는 것보다
 * 미리 확인하는 편이 낫다.
 */

import { useRef, useState } from 'react'
import { apiSend, messageOf } from '@/app/admin/client'
import { parseCsv } from '@/lib/csv'
import { mapHeaders, toRawRow } from '@/lib/import-mapping'
import type { RawRow, RowIssue } from '@/lib/pharmacy-import'

const CHUNK_SIZE = 200

interface ChunkResult {
  saved: number
  mappings: number
  rejected: RowIssue[]
  warnings: RowIssue[]
  geocoded: number
}

interface Report {
  totalRows: number
  saved: number
  mappings: number
  geocoded: number
  rejected: RowIssue[]
  warnings: RowIssue[]
  dryRun: boolean
}

export default function ImportPage() {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [dryRun, setDryRun] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)

  async function handleUpload(event: React.FormEvent) {
    event.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError('CSV 파일을 선택해주세요.')
      return
    }

    setBusy(true)
    setError(null)
    setReport(null)
    setProgress(null)

    try {
      const table = parseCsv(await file.text())
      const header = table[0]
      if (!header) throw new Error('CSV 가 비어 있습니다.')

      const { index, missing } = mapHeaders(header)
      if (missing.length > 0) {
        throw new Error(
          `필수 컬럼이 없습니다: ${missing.join(', ')}\n헤더: ${header.join(', ')}\n템플릿을 내려받아 컬럼 이름을 맞춰주세요.`,
        )
      }

      const rows: RawRow[] = table.slice(1).map((cells) => toRawRow(cells, index))
      if (rows.length === 0) throw new Error('데이터 행이 없습니다.')

      const chunkCount = Math.ceil(rows.length / CHUNK_SIZE)
      setProgress({ done: 0, total: chunkCount })

      const merged: Report = {
        totalRows: rows.length,
        saved: 0,
        mappings: 0,
        geocoded: 0,
        rejected: [],
        warnings: [],
        dryRun,
      }

      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const result = await apiSend<ChunkResult>('/api/admin/import', 'POST', {
          startRow: i + 1,
          rows: rows.slice(i, i + CHUNK_SIZE),
          dryRun,
        })

        merged.saved += result.saved
        merged.mappings += result.mappings
        merged.geocoded += result.geocoded
        merged.rejected.push(...result.rejected)
        merged.warnings.push(...result.warnings)

        setProgress({ done: Math.floor(i / CHUNK_SIZE) + 1, total: chunkCount })
      }

      merged.rejected.sort((a, b) => a.rowNumber - b.rowNumber)
      merged.warnings.sort((a, b) => a.rowNumber - b.rowNumber)
      setReport(merged)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  function downloadIssues(issues: RowIssue[], filename: string) {
    const csv = [
      '원본행번호,취급처명,사유',
      ...issues.map(
        (issue) =>
          `${issue.rowNumber},"${issue.name.replace(/"/g, '""')}","${issue.reason.replace(/"/g, '""')}"`,
      ),
    ].join('\r\n')

    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <h1 className="ad-title">CSV 일괄 업로드</h1>
      <p className="ad-subtitle">
        기존 스프레드시트를 CSV 로 내보내 올리면 취급처와 취급 제품이 한 번에 등록됩니다.
      </p>

      <form className="ad-panel" onSubmit={handleUpload}>
        <div className="ad-field">
          <span className="ad-label">1. 템플릿 확인</span>
          <div>
            <a className="ad-btn" href="/api/admin/import/template" download>
              템플릿 CSV 내려받기
            </a>
          </div>
          <span className="ad-hint">
            컬럼: 제품명 · 약국명 · 주소 · 전화번호 · 위도 · 경도
            <br />
            위도·경도는 비워도 됩니다. 비어 있으면 주소로 좌표를 찾습니다.
          </span>
        </div>

        <div className="ad-field">
          <label className="ad-label" htmlFor="csv-file">
            2. 파일 선택
          </label>
          <input id="csv-file" ref={fileRef} className="ad-input" type="file" accept=".csv,text/csv" />
        </div>

        <div className="ad-field">
          <span className="ad-label">3. 실행 방식</span>
          <label className="ad-check">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            검증만 하고 저장하지 않기
          </label>
          <span className="ad-hint">
            먼저 검증만 돌려 실패 행을 확인한 뒤, 체크를 풀고 다시 올리는 순서를 권합니다.
          </span>
        </div>

        <button className="ad-btn primary" type="submit" disabled={busy}>
          {busy ? '처리 중…' : dryRun ? '검증 실행' : '업로드 실행'}
        </button>

        {progress && (
          <div className="ad-hint" style={{ marginTop: 10 }}>
            {progress.done} / {progress.total} 묶음 처리
          </div>
        )}
      </form>

      {error && <div className="ad-alert error">{error}</div>}

      {report && (
        <div className="ad-panel">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>
            {report.dryRun ? '검증 결과 (저장하지 않음)' : '업로드 결과'}
          </h2>

          <div className={`ad-alert ${report.rejected.length > 0 ? 'warn' : 'ok'}`}>
            {`전체 ${report.totalRows.toLocaleString()}행 · ${report.saved.toLocaleString()}건 ${report.dryRun ? '처리 가능' : '처리됨'}`}
            {!report.dryRun && ` · 제품 연결 ${report.mappings.toLocaleString()}건`}
            {report.geocoded > 0 && ` · 주소로 좌표를 찾은 곳 ${report.geocoded}곳`}
            {report.rejected.length > 0 && ` · 반려 ${report.rejected.length}건`}
            {report.warnings.length > 0 && ` · 경고 ${report.warnings.length}건`}
          </div>

          <div className="ad-hint" style={{ marginTop: -4, marginBottom: 12 }}>
            처리 건수는 묶음별 집계라 같은 취급처가 여러 번 세어질 수 있습니다. 상호와 주소가 같은
            곳은 자동으로 하나로 합쳐지므로 실제 등록 수는 이보다 적을 수 있습니다.
          </div>

          {report.rejected.length > 0 && (
            <IssueTable
              title="반려 (저장되지 않음)"
              issues={report.rejected}
              onDownload={() => downloadIssues(report.rejected, '반려행.csv')}
            />
          )}

          {report.warnings.length > 0 && (
            <IssueTable
              title="경고 (저장은 됨)"
              issues={report.warnings}
              onDownload={() => downloadIssues(report.warnings, '경고행.csv')}
            />
          )}

          {report.rejected.length === 0 && report.warnings.length === 0 && (
            <div className="ad-hint">문제가 발견되지 않았습니다.</div>
          )}
        </div>
      )}
    </>
  )
}

const PREVIEW_LIMIT = 50

function IssueTable({
  title,
  issues,
  onDownload,
}: {
  title: string
  issues: RowIssue[]
  onDownload: () => void
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="ad-toolbar">
        <strong style={{ fontSize: 14 }}>
          {title} — {issues.length}건
        </strong>
        <span className="ad-spacer" />
        <button className="ad-btn sm" type="button" onClick={onDownload}>
          CSV 로 내려받기
        </button>
      </div>

      <div className="ad-table-wrap">
        <table className="ad-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>원본 행</th>
              <th style={{ width: 200 }}>취급처명</th>
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {issues.slice(0, PREVIEW_LIMIT).map((issue, i) => (
              <tr key={`${issue.rowNumber}-${i}`}>
                <td className="num">{issue.rowNumber}</td>
                <td>{issue.name}</td>
                <td>{issue.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {issues.length > PREVIEW_LIMIT && (
        <div className="ad-hint" style={{ marginTop: 8 }}>
          {PREVIEW_LIMIT}건까지만 표시했습니다. 전체는 CSV 로 내려받아 확인해주세요.
        </div>
      )}
    </div>
  )
}
