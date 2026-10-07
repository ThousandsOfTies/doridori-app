import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useBookIndex } from '../../book/useBookIndex'
import { bookIndexLabel } from '../../book/bookIndexStatus'
import { BookIndexDot } from './BookIndexDot'
import type { PDFTextInspection } from '@home-teacher/common/utils/pdfTextInspection'

export function BookIndexSettings({ pdfId, pdfDoc, numPages, textInspection }: {
  pdfId: string; pdfDoc: PDFDocumentProxy | null; numPages: number; textInspection?: PDFTextInspection
}) {
  const bookIndex = useBookIndex(pdfId, pdfDoc, numPages, textInspection)
  const running = ['reading', 'embedding', 'connecting'].includes(bookIndex.phase)
  const done = ['complete', 'no-text'].includes(bookIndex.summary.state)
  return <details className="book-index-settings">
    <summary><BookIndexDot summary={numPages ? bookIndex.summary : null} textInspection={textInspection} /><strong>本の索引</strong>
      <span className="book-index-summary-status" title={bookIndexLabel(numPages ? bookIndex.summary : null)}>{bookIndexLabel(numPages ? bookIndex.summary : null)}</span>
      <svg className="book-index-toggle" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M7 12h10" />
        <path className="book-index-toggle-plus" d="M12 7v10" />
      </svg>
    </summary>
    <section className="book-index-settings-body" aria-label="本の索引の設定">
      <p>PDFに入っている文字から索引を作ります。意味検索のため本文をAIへ送信するので、本文の量に応じて使用量が発生します。本の画像をAIで文字起こしする処理は行いません。</p>
      {textInspection?.status === 'present' && <p>登録時の確認：文字情報があります。画像だけのページが含まれる場合もあります。</p>}
      {textInspection?.status === 'unknown' && <p>登録時に文字情報の有無を判定できませんでした。索引作成で再確認できます。</p>}
      <p className="book-index-progress" role="status">{
        bookIndex.phase === 'reading' ? `文字情報を確認中: ${bookIndex.progress}/${numPages}ページ` :
          bookIndex.phase === 'embedding' ? `意味検索の索引を作成中: ${bookIndex.embeddingProgress.done}/${bookIndex.embeddingProgress.total}箇所` :
            bookIndex.phase === 'connecting' ? '関連ページを結びつけています…' : bookIndexLabel(bookIndex.summary)
      }</p>
      {numPages > 0 && <progress max={numPages} value={bookIndex.phase === 'reading' ? bookIndex.progress : bookIndex.summary.checkedPages} />}
      {(bookIndex.missingTextPageCount > 0 || bookIndex.summary.state === 'no-text') && <p className="book-index-note">
        {bookIndex.summary.state === 'no-text' ? 'このPDFには読み取れる文字情報がありません。' : `${bookIndex.missingTextPageCount}ページで文字情報を取得できませんでした。`}画像だけのページを検索に含める場合は、
        <a href="https://tools.pdf24.org/ja/ocr-pdf" target="_blank" rel="noopener noreferrer">PDF24などでOCR</a>
        してからPDFを取り込んでください。
      </p>}
      {bookIndex.error && <p className="book-index-error" role="alert">{bookIndex.error}</p>}
      <div className="book-index-actions">{running ?
        <button type="button" onClick={bookIndex.stopIndexing}>ここで停止</button> :
        <button type="button" disabled={!pdfDoc || !bookIndex.loaded || done} onClick={() => void bookIndex.startIndexing()}>
          {bookIndex.summary.state === 'complete' ? '索引作成済み' :
            bookIndex.summary.state === 'no-text' ? '文字情報がありません' :
              bookIndex.pages.length ? '索引作成を再開' : '索引を作成'}
        </button>}
      </div>
      {running && <small>この画面を離れると停止します。続きはここから再開できます。</small>}
    </section>
  </details>
}
