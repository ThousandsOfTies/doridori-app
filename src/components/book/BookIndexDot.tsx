import { bookIndexLabel, bookIndexDotState, type BookIndexSummary } from '../../book/bookIndexStatus'
import './BookIndex.css'
import type { PDFTextInspection } from '@home-teacher/common/utils/pdfTextInspection'
import { useDoriTranslation } from '../../i18n'

export function BookIndexDot({ summary, onClick, expanded, unavailable = false, textInspection }: {
  summary: BookIndexSummary | null
  onClick?: () => void
  expanded?: boolean
  unavailable?: boolean
  textInspection?: PDFTextInspection
}) {
  const { t } = useDoriTranslation()
  const state = bookIndexDotState(summary, textInspection, unavailable)
  const label = unavailable ? t('index.status.unavailable') : summary?.state === 'none' && textInspection?.status === 'present'
    ? t('index.status.textPresent') : summary?.state === 'none' && textInspection?.status === 'unknown'
      ? t('index.status.textUnknown') : state === 'transparent' && summary?.state !== 'no-text'
        ? t('index.status.textUnchecked') : bookIndexLabel(summary, t)
  return onClick && state !== 'transparent' ? <button type="button" className={`book-index-dot ${state}`} title={label}
    aria-label={label} aria-expanded={expanded} aria-haspopup="dialog"
    onClick={event => { event.stopPropagation(); onClick() }} /> :
    <span className={`book-index-dot ${state}`} role="img" aria-label={label} title={label} />
}
