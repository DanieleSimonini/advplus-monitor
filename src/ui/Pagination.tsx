import { IconButton } from './primitives'

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  loading,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  loading?: boolean
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const to = Math.min(total, safePage * pageSize)

  return (
    <div className="gu-pagination">
      <div className="gu-pagination__info" aria-live="polite">
        {total === 0 ? 'Nessun risultato' : <>
          <strong>{from}–{to}</strong> di <strong>{total}</strong>
        </>}
      </div>
      <div className="gu-row-tight">
        <IconButton
          icon="chevronLeft"
          label="Pagina precedente"
          size="sm"
          disabled={safePage <= 1 || loading}
          onClick={() => onPageChange(safePage - 1)}
        />
        <span style={{ fontSize: 'var(--gu-text-sm)', color: 'var(--gu-text-subtle)', padding: '0 4px' }}>
          {safePage} / {totalPages}
        </span>
        <IconButton
          icon="chevronRight"
          label="Pagina successiva"
          size="sm"
          disabled={safePage >= totalPages || loading}
          onClick={() => onPageChange(safePage + 1)}
        />
      </div>
    </div>
  )
}
