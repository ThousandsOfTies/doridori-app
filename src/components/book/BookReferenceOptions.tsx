import { useEffect, useRef } from 'react'
import type { BookIndexSummary } from '../../book/bookIndexStatus'
import { bookIndexLabel } from '../../book/bookIndexStatus'
import { useDoriTranslation } from '../../i18n'

export function BookReferenceOptions({ summary, onClose, onOpenSettings, includeLaterPages, onIncludeLaterPagesChange }: {
  summary: BookIndexSummary
  onClose: () => void
  onOpenSettings?: () => void
  includeLaterPages: boolean
  onIncludeLaterPagesChange: (value: boolean) => void
}) {
  const { t } = useDoriTranslation()
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
  return <div ref={ref} className="book-reference-options" role="dialog" aria-label={t('reference.settings')}>
    <div className="book-reference-heading"><strong>{bookIndexLabel(summary, t)}</strong><button type="button" onClick={onClose} aria-label={t('reference.close')}>×</button></div>
    <p>{t('reference.indexHint')}</p>
    <label className="book-index-option"><input type="checkbox" checked={includeLaterPages}
      onChange={event => onIncludeLaterPagesChange(event.target.checked)} />{t('reference.includeLaterPages')}</label>
    {onOpenSettings && <button type="button" className="book-reference-settings-link" onClick={onOpenSettings}>{t('reference.openSettings')}</button>}
  </div>
}
