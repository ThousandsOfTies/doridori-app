import { bookIndexLabel, bookIndexDotState, type BookIndexSummary } from '../../book/bookIndexStatus'
import './BookIndex.css'
import type { PDFTextInspection } from '@home-teacher/common/utils/pdfTextInspection'

export function BookIndexDot({ summary, onClick, expanded, unavailable = false, textInspection }: {
  summary: BookIndexSummary | null
  onClick?: () => void
  expanded?: boolean
  unavailable?: boolean
  textInspection?: PDFTextInspection
}) {
  const state = bookIndexDotState(summary, textInspection, unavailable)
  const label = unavailable ? '索引の状態を確認できません' : summary?.state === 'none' && textInspection?.status === 'present'
    ? '文字情報あり・索引未作成' : summary?.state === 'none' && textInspection?.status === 'unknown'
      ? '文字情報の有無を判定できませんでした・索引未作成' : state === 'transparent' && summary?.state !== 'no-text'
        ? '文字情報は未確認です' : bookIndexLabel(summary)
  return onClick && state !== 'transparent' ? <button type="button" className={`book-index-dot ${state}`} title={label}
    aria-label={label} aria-expanded={expanded} aria-haspopup="dialog"
    onClick={event => { event.stopPropagation(); onClick() }} /> :
    <span className={`book-index-dot ${state}`} role="img" aria-label={label} title={label} />
}
