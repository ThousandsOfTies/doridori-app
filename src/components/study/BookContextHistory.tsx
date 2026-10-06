import type { BookContextTrace } from '../../../shared/bookAgentProtocol'

export default function BookContextHistory({ entries, onOpenPage }: {
  entries: BookContextTrace[]
  onOpenPage?: (page: number) => void
}) {
  return (
    <details className="book-context-history">
      <summary>先生が確認した本文（{entries.length}件の問い合わせ）</summary>
      <p>{entries.length ? '先生が指定した検索語やページと、ブラウザから返した本文です。'
        : '今回は選択した画像と質問から回答しています。本文の追加取得はありません。'}</p>
      <ol>
        {entries.map(entry => (
          <li key={`${entry.round}:${entry.request.id}`}>
            <strong>{entry.request.name === 'search_book'
              ? `本文を検索: ${entry.request.query}`
              : `ページを取得: ${entry.request.pageNumbers.map(page => `p.${page}`).join('、')}`}</strong>
            {entry.request.reason && <p className="book-context-purpose">確認の目的: {entry.request.reason}</p>}
            {entry.result.contexts.map((context, index) => (
              <details className="book-context-passage" key={`${context.pageNumber}:${index}`}>
                <summary>PDF p.{context.pageNumber}の本文（{context.text.length}文字）</summary>
                <button type="button" onClick={() => onOpenPage?.(context.pageNumber)}>PDF p.{context.pageNumber}を開く ↗</button>
                <p>{context.text}</p>
                {context.truncated && <small>送信量を抑えるため、本文の一部を送っています。</small>}
              </details>
            ))}
            {entry.result.error && <p className="book-context-note">{entry.result.error}</p>}
            {!entry.result.contexts.length && !entry.result.error && <p className="book-context-note">該当する本文を取得できませんでした。</p>}
          </li>
        ))}
      </ol>
    </details>
  )
}
