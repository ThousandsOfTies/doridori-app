import { useEffect, useState } from 'react'
import { FiFileText } from 'react-icons/fi'
import type { PDFFileRecord } from '@home-teacher/common/utils/indexedDB'
import { StudyPDFThumbnail } from '@home-teacher/common/components/study/StudyPDFThumbnail'
import { BOOK_INDEX_CHANGED_EVENT } from '../../book/bookIndex'
import type { BookIndexSummary } from '../../book/bookIndexStatus'
import { withPDFTextInspection } from '../../book/bookIndexStatus'
import { getSavedBookIndexSummary } from '../../book/bookIndexStatusLoader'
import { BookIndexDot } from './BookIndexDot'

export function BookCoverThumbnail({ record, summary, size = 'list', onStatusClick, expanded, unavailable = false }: {
  record: PDFFileRecord
  summary: BookIndexSummary | null
  size?: 'list' | 'toolbar'
  onStatusClick?: () => void
  expanded?: boolean
  unavailable?: boolean
}) {
  const status = <BookIndexDot summary={summary && withPDFTextInspection(summary, record.textInspection)} textInspection={record.textInspection}
    unavailable={unavailable} onClick={onStatusClick} expanded={expanded} />
  if (size === 'toolbar') return <StudyPDFThumbnail record={record}>{status}</StudyPDFThumbnail>
  return <span className="book-cover-thumbnail list">
    <span className="book-cover-image">
      {record.thumbnail ? <img src={record.thumbnail} alt={record.fileName} /> :
        <span className="book-cover-placeholder" role="img" aria-label={record.fileName}><FiFileText /></span>}
      {status}
    </span>
  </span>
}

export function SavedBookCoverThumbnail({ record }: { record: PDFFileRecord }) {
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
  }, [record])
  return <BookCoverThumbnail record={record} summary={summary} unavailable={unavailable} />
}
