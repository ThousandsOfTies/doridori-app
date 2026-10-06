import { bookIndexLabel, type BookIndexSummary } from '../../book/bookIndexStatus'
import './BookIndex.css'

export function BookIndexDot({ summary, onClick, expanded, unavailable = false }: {
  summary: BookIndexSummary | null
  onClick?: () => void
  expanded?: boolean
  unavailable?: boolean
}) {
  const state = unavailable ? 'unavailable' : summary?.state || 'loading'
  const label = unavailable ? '索引の状態を確認できません' : bookIndexLabel(summary)
  return onClick ? <button type="button" className={`book-index-dot ${state}`} title={label}
    aria-label={label} aria-expanded={expanded} aria-haspopup="dialog"
    onClick={event => { event.stopPropagation(); onClick() }} /> :
    <span className={`book-index-dot ${state}`} role="img" aria-label={label} title={label} />
}
