import { useEffect, useRef } from 'react'
import type { BookIndexSummary } from '../../book/bookIndexStatus'
import { bookIndexLabel } from '../../book/bookIndexStatus'

export function BookReferenceOptions({ summary, onClose, onOpenSettings, includeLaterPages, onIncludeLaterPagesChange }: {
  summary: BookIndexSummary
  onClose: () => void
  onOpenSettings?: () => void
  includeLaterPages: boolean
  onIncludeLaterPagesChange: (value: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.book-index-dot')) return
      if (event.target instanceof Node && !ref.current?.contains(event.target)) onClose()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [onClose])
  return <div ref={ref} className="book-reference-options" role="dialog" aria-label="本の参照設定">
    <div className="book-reference-heading"><strong>{bookIndexLabel(summary)}</strong><button type="button" onClick={onClose} aria-label="参照設定を閉じる">×</button></div>
    <p>索引の作成・再開はPDFの設定画面から行えます。</p>
    <label className="book-index-option"><input type="checkbox" checked={includeLaterPages}
      onChange={event => onIncludeLaterPagesChange(event.target.checked)} />今より先のページも参照する</label>
    {onOpenSettings && <button type="button" className="book-reference-settings-link" onClick={onOpenSettings}>PDFの設定を開く</button>}
  </div>
}
