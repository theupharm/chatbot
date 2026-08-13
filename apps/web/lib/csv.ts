/**
 * CSV 파싱 (설계문서 §9-3)
 *
 * 따옴표로 감싼 필드와 그 안의 쉼표·줄바꿈·이스케이프(`""`)를 처리한다.
 * 원본 데이터의 주소·안내 문구에 쉼표와 줄바꿈이 섞여 있어 단순 split 으로는 깨진다.
 *
 * 관리자 CSV 업로드(Phase 6)와 이관 스크립트가 같은 파서를 쓴다.
 */

/** UTF-8 BOM. 엑셀이 저장한 CSV 앞에 붙는다 */
const BOM = '﻿'

export function parseCsv(text: string): string[][] {
  const content = text.startsWith(BOM) ? text.slice(BOM.length) : text

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!

    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // 완전히 빈 줄은 버린다
  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0))
}

/** 헤더 행에서 컬럼 인덱스 맵을 만든다 (소문자·trim 기준) */
export function headerIndex(header: readonly string[]): Record<string, number> {
  const index: Record<string, number> = {}
  header.forEach((column, i) => {
    index[column.trim().toLowerCase()] = i
  })
  return index
}
