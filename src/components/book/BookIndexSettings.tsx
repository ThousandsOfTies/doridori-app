import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useBookIndex } from '../../book/useBookIndex'
import { bookIndexLabel } from '../../book/bookIndexStatus'
import { BookIndexDot } from './BookIndexDot'
import type { PDFTextInspection } from '@home-teacher/common/utils/pdfTextInspection'
import { Trans } from 'react-i18next'
import { useDoriTranslation } from '../../i18n'

export function BookIndexSettings({ pdfId, pdfDoc, numPages, textInspection }: {
  pdfId: string; pdfDoc: PDFDocumentProxy | null; numPages: number; textInspection?: PDFTextInspection
}) {
  const { t, i18n } = useDoriTranslation()
  const bookIndex = useBookIndex(pdfId, pdfDoc, numPages, textInspection)
  const running = ['reading', 'embedding', 'connecting'].includes(bookIndex.phase)
  const done = ['complete', 'no-text'].includes(bookIndex.summary.state)
  return <details className="book-index-settings">
    <summary><BookIndexDot summary={numPages ? bookIndex.summary : null} textInspection={textInspection} /><strong>{t('index.title')}</strong>
      <span className="book-index-summary-status" title={bookIndexLabel(numPages ? bookIndex.summary : null, t)}>{bookIndexLabel(numPages ? bookIndex.summary : null, t)}</span>
      <svg className="book-index-toggle" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M7 12h10" />
        <path className="book-index-toggle-plus" d="M12 7v10" />
      </svg>
    </summary>
    <section className="book-index-settings-body" aria-label={t('index.settings')}>
      <p>{t('index.description')}</p>
      {textInspection?.status === 'present' && <p>{t('index.textPresent')}</p>}
      {textInspection?.status === 'unknown' && <p>{t('index.textUnknown')}</p>}
      <p className="book-index-progress" role="status">{
        bookIndex.phase === 'reading' ? t('index.reading', { checked: bookIndex.progress, total: numPages }) :
          bookIndex.phase === 'embedding' ? t('index.embedding', bookIndex.embeddingProgress) :
            bookIndex.phase === 'connecting' ? t('index.connecting') : bookIndexLabel(bookIndex.summary, t)
      }</p>
      {numPages > 0 && <progress max={numPages} value={bookIndex.phase === 'reading' ? bookIndex.progress : bookIndex.summary.checkedPages} />}
      {(bookIndex.missingTextPageCount > 0 || bookIndex.summary.state === 'no-text') && <p className="book-index-note">
        {bookIndex.summary.state === 'no-text' ? t('index.noTextInPDF') : t('index.missingText', { count: bookIndex.missingTextPageCount })}{' '}
        <Trans t={t} i18nKey="index.ocrHint" components={{ ocr: <a href={`https://tools.pdf24.org/${i18n.language.startsWith('ja') ? 'ja' : 'en'}/ocr-pdf`} target="_blank" rel="noopener noreferrer" /> }} />
      </p>}
      {bookIndex.error && <p className="book-index-error" role="alert">{bookIndex.error}</p>}
      <div className="book-index-actions">{running ?
        <button type="button" onClick={bookIndex.stopIndexing}>{t('index.stop')}</button> :
        <button type="button" disabled={!pdfDoc || !bookIndex.loaded || done} onClick={() => void bookIndex.startIndexing()}>
          {t(bookIndex.summary.state === 'complete' ? 'index.created' :
            bookIndex.summary.state === 'no-text' ? 'index.status.noText' :
              bookIndex.pages.length ? 'index.resume' : 'index.create')}
        </button>}
      </div>
      {running && <small>{t('index.leavingStops')}</small>}
    </section>
  </details>
}
