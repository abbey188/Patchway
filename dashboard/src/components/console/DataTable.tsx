'use client'

import React from 'react'

export type Column<T> = {
  key: string
  header: string
  render: (row: T) => React.ReactNode
  width?: string
}

type Props<T> = {
  columns: Column<T>[]
  rows: T[]
  onRowClick?: (row: T) => void
  emptyMessage?: string
  loading?: boolean
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} style={{ padding: '12px 14px', borderBottom: '1px solid #1A1D1A' }}>
          <div
            style={{
              height: '12px',
              borderRadius: '4px',
              background: 'rgba(255,255,255,0.04)',
              width: `${50 + Math.random() * 40}%`,
            }}
          />
        </td>
      ))}
    </tr>
  )
}

export function DataTable<T>({ columns, rows, onRowClick, emptyMessage = 'No data', loading }: Props<T>) {
  return (
    <div
      style={{
        background: '#1C201C',
        border: '1px solid #242824',
        borderRadius: '10px',
        overflow: 'hidden',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #242824' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  padding: '11px 14px',
                  textAlign: 'left',
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: '#474D47',
                  width: col.width,
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={columns.length} />)
          ) : rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  padding: '40px 14px',
                  textAlign: 'center',
                  color: '#474D47',
                  fontSize: '13px',
                }}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr
                key={idx}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={{
                  borderBottom: idx < rows.length - 1 ? '1px solid #1A1D1A' : undefined,
                  cursor: onRowClick ? 'pointer' : 'default',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => {
                  if (onRowClick) {
                    (e.currentTarget as HTMLTableRowElement).style.background = 'rgba(255,255,255,0.015)'
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = ''
                }}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{
                      padding: '12px 14px',
                      fontSize: '12px',
                      color: '#9BA39B',
                    }}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
