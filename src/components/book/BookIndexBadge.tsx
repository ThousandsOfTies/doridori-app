import { useEffect, useState } from 'react'
import { FiBookOpen, FiCheck, FiClock, FiMinus, FiAlertCircle } from 'react-icons/fi'
import type { PDFFileRecord } from '@home-teacher/common/utils/indexedDB'
import { BOOK_INDEX_CHANGED_EVENT } from '../../book/bookIndex'
import { bookIndexLabel, type BookIndexSummary } from '../../book/bookIndexStatus'
import { getSavedBookIndexSummary } from '../../book/bookIndexStatusLoader'
import './BookIndex.css'

export function BookIndexBadge({ summary, onClick, expanded, unavailable = false }: {
  summary: BookIndexSummary | null
  onClick?: () => void
  expanded?: boolean
  unavailable?: boolean
}) {
  const state = summary?.state || 'loading'
  const label = unavailable ? '索引の状態を確認できません' : bookIndexLabel(summary)
  const icon = <><FiBookOpen size={22} /><span className="book-index-badge-mark" aria-hidden="true">
    {state === 'complete' ? <FiCheck /> : state === 'partial' ? <FiClock /> :
      state === 'no-text' || unavailable ? <FiAlertCircle /> : <FiMinus />}
  </span></>
  return onClick ? <button type="button" className={`book-index-badge ${state}`} title={label}
    aria-label={label} aria-expanded={expanded} onClick={event => { event.stopPropagation(); onClick() }}>{icon}</button> :
    <span className={`book-index-badge ${state}`} role="img" aria-label={label} title={label}>{icon}</span>
}

export function SavedBookIndexBadge({ record, onOpenSettings }: { record: PDFFileRecord; onOpenSettings: () => void }) {
  const [summary, setSummary] = useState<BookIndexSummary | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = () => { void getSavedBookIndexSummary(record).then(value => {
      if (active) { setSummary(value); setUnavailable(false) }
    }).catch(() => { if (active) setUnavailable(true) }) }
    const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === record.id) refresh() }
    refresh()
    window.addEventListener(BOOK_INDEX_CHANGED_EVENT, changed)
    window.addEventListener('focus', refresh)
    return () => { active = false; window.removeEventListener(BOOK_INDEX_CHANGED_EVENT, changed); window.removeEventListener('focus', refresh) }
  }, [record.id])
  return <BookIndexBadge summary={summary} unavailable={unavailable} onClick={onOpenSettings} />
}
