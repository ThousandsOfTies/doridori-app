import type { useBookIndex } from '../../book/useBookIndex'

interface BookIndexPanelProps {
  bookIndex: ReturnType<typeof useBookIndex>
  numPages: number
  canReadPDF: boolean
  isOpen: boolean
  onToggle: () => void
  includeLaterPages: boolean
  onIncludeLaterPagesChange: (value: boolean) => void
}

export function BookIndexPanel({ bookIndex, numPages, canReadPDF, isOpen, onToggle,
  includeLaterPages, onIncludeLaterPagesChange }: BookIndexPanelProps) {
  return (
    <div className="book-index-launcher">
      <button type="button" onClick={onToggle}
        aria-expanded={isOpen} title="本全体の検索索引">
        📚 本の索引 {bookIndex.textPageCount}/{numPages || '…'}
      </button>
      {isOpen && (
        <div className="book-index-card">
          <strong>本の内容を参照</strong>
          <p>PDFに入っている文字から索引を作ります。意味検索のため本文をAIへ送信するので、本文の量に応じて使用量が発生します。本の画像をAIで文字起こしする処理は行いません。</p>
          <p className="book-index-progress" role="status">
            {bookIndex.phase === 'reading' ? `文字情報を確認中: ${bookIndex.progress}/${numPages}ページ` :
              bookIndex.phase === 'embedding' ? `意味検索の索引を作成中: ${bookIndex.embeddingProgress.done}/${bookIndex.embeddingProgress.total}箇所` :
              bookIndex.phase === 'connecting' ? '関連ページを結びつけています…' :
              bookIndex.phase === 'complete' ? `索引作成済み: 本文 ${bookIndex.textPageCount}/${numPages}ページ` :
              `本文を取得済み: ${bookIndex.textPageCount}/${numPages}ページ`}
          </p>
          {numPages > 0 && <progress max={numPages} value={bookIndex.progress} />}
          {bookIndex.missingTextPageCount > 0 && (
            <p className="book-index-note">
              {bookIndex.missingTextPageCount}ページで文字情報を取得できませんでした。画像だけのページを検索に含める場合は、
              <a href="https://tools.pdf24.org/ja/ocr-pdf" target="_blank" rel="noopener noreferrer">PDF24などでOCR</a>
              してからPDFを取り込んでください。
            </p>
          )}
          {bookIndex.error && <p className="book-index-error">{bookIndex.error}</p>}
          <label className="book-index-option">
            <input type="checkbox" checked={includeLaterPages}
              onChange={event => onIncludeLaterPagesChange(event.target.checked)} />
            今より先のページも検索する
          </label>
          <div className="book-index-actions">
            {['reading', 'embedding', 'connecting'].includes(bookIndex.phase) ?
              <button type="button" onClick={bookIndex.stopIndexing}>ここで停止</button> :
              <button type="button" disabled={!canReadPDF || bookIndex.phase === 'complete'}
                onClick={() => void bookIndex.startIndexing()}>
                {bookIndex.pages.length ? '索引作成を再開' : '索引を作成'}
              </button>}
          </div>
        </div>
      )}
    </div>
  )
}
