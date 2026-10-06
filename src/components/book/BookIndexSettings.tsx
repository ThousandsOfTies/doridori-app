import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useBookIndex } from '../../book/useBookIndex'
import { bookIndexLabel } from '../../book/bookIndexStatus'
import { BookIndexBadge } from './BookIndexBadge'

export function BookIndexSettings({ pdfId, pdfDoc, numPages }: {
  pdfId: string; pdfDoc: PDFDocumentProxy | null; numPages: number
}) {
  const bookIndex = useBookIndex(pdfId, pdfDoc, numPages)
  const running = ['reading', 'embedding', 'connecting'].includes(bookIndex.phase)
  const done = ['complete', 'no-text'].includes(bookIndex.summary.state)
  return <details className="book-index-settings">
    <summary><BookIndexBadge summary={numPages ? bookIndex.summary : null} /><strong>本の索引</strong>
      <span>{bookIndexLabel(numPages ? bookIndex.summary : null)}</span></summary>
    <section className="book-index-settings-body" aria-label="本の索引の設定">
      <p>PDFに入っている文字から索引を作ります。意味検索のため本文をAIへ送信するので、本文の量に応じて使用量が発生します。本の画像をAIで文字起こしする処理は行いません。</p>
      <p className="book-index-progress" role="status">{
        bookIndex.phase === 'reading' ? `文字情報を確認中: ${bookIndex.progress}/${numPages}ページ` :
          bookIndex.phase === 'embedding' ? `意味検索の索引を作成中: ${bookIndex.embeddingProgress.done}/${bookIndex.embeddingProgress.total}箇所` :
            bookIndex.phase === 'connecting' ? '関連ページを結びつけています…' : bookIndexLabel(bookIndex.summary)
      }</p>
      {numPages > 0 && <progress max={numPages} value={bookIndex.progress} />}
      {bookIndex.missingTextPageCount > 0 && <p className="book-index-note">
        {bookIndex.missingTextPageCount}ページで文字情報を取得できませんでした。画像だけのページを検索に含める場合は、
        <a href="https://tools.pdf24.org/ja/ocr-pdf" target="_blank" rel="noopener noreferrer">PDF24などでOCR</a>
        してからPDFを取り込んでください。
      </p>}
      {bookIndex.error && <p className="book-index-error" role="alert">{bookIndex.error}</p>}
      <div className="book-index-actions">{running ?
        <button type="button" onClick={bookIndex.stopIndexing}>ここで停止</button> :
        <button type="button" disabled={!pdfDoc || done} onClick={() => void bookIndex.startIndexing()}>
          {bookIndex.summary.state === 'complete' ? '索引作成済み' :
            bookIndex.summary.state === 'no-text' ? '文字情報がありません' :
              bookIndex.pages.length ? '索引作成を再開' : '索引を作成'}
        </button>}
      </div>
      {running && <small>この画面を離れると停止します。続きはここから再開できます。</small>}
    </section>
  </details>
}
