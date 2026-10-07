import type { BookContextTrace } from '../../../shared/bookAgentProtocol'
import { useDoriTranslation } from '../../i18n'

export default function BookContextHistory({ entries, onOpenPage }: {
  entries: BookContextTrace[]
  onOpenPage?: (page: number) => void
}) {
  const { t, i18n } = useDoriTranslation()
  return (
    <details className="book-context-history">
      <summary>{t('context.title', { count: entries.length })}</summary>
      <p>{t(entries.length ? 'context.description' : 'context.noRequests')}</p>
      <ol>
        {entries.map(entry => (
          <li key={`${entry.round}:${entry.request.id}`}>
            <strong>{entry.request.name === 'search_book'
              ? t('context.search', { query: entry.request.query })
              : t('context.readPages', { pages: entry.request.pageNumbers.map(page => `p.${page}`).join(i18n.language.startsWith('ja') ? '、' : ', ') })}</strong>
            {entry.request.reason && <p className="book-context-purpose">{t('context.purpose', { reason: entry.request.reason })}</p>}
            {entry.result.contexts.map((context, index) => (
              <details className="book-context-passage" key={`${context.pageNumber}:${index}`}>
                <summary>{t('context.passage', { page: context.pageNumber, count: context.text.length })}</summary>
                <button type="button" onClick={() => onOpenPage?.(context.pageNumber)}>{t('context.openPage', { page: context.pageNumber })}</button>
                <p>{context.text}</p>
                {context.truncated && <small>{t('context.truncated')}</small>}
              </details>
            ))}
            {entry.result.error && <p className="book-context-note">{entry.result.error}</p>}
            {!entry.result.contexts.length && !entry.result.error && <p className="book-context-note">{t('context.empty')}</p>}
          </li>
        ))}
      </ol>
    </details>
  )
}
