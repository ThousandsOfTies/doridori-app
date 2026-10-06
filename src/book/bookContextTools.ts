import { BOOK_AGENT_LIMITS, type BookContextRequest, type BookContextResult } from '../../shared/bookAgentProtocol'
import type { BookPageIndex, RetrievedPassage } from './bookIndex'

export interface BookContextTools {
  currentPage: number
  totalPages: number
  includeLaterPages: boolean
  search: (query: string) => Promise<{ passages: RetrievedPassage[]; indexedPages: number }>
  readPage: (number: number) => Promise<BookPageIndex>
  indexedPages: () => number
}

export async function resolveBookContext(request: BookContextRequest, tools: BookContextTools): Promise<BookContextResult> {
  const maxPage = tools.includeLaterPages ? tools.totalPages : tools.currentPage
  if (request.name === 'search_book') {
    const found = await tools.search(request.query)
    const contexts = found.passages.filter(passage => passage.pageNumber >= 1 && passage.pageNumber <= maxPage && passage.text.trim())
      .slice(0, BOOK_AGENT_LIMITS.contextsPerRequest)
      .map(passage => ({ pageNumber: passage.pageNumber,
        text: passage.text.slice(0, BOOK_AGENT_LIMITS.contextCharacters),
        truncated: passage.text.length > BOOK_AGENT_LIMITS.contextCharacters }))
    return { id: request.id, contexts, indexedPages: found.indexedPages,
      ...(contexts.length ? {} : { error: '索引に関連する本文が見つかりません。必要ならページ番号を指定して確認してください。' }) }
  }
  const contexts: BookContextResult['contexts'] = []
  const missingPages: number[] = []
  const errors: string[] = []
  const requested = [...new Set(request.pageNumbers)].slice(0, BOOK_AGENT_LIMITS.contextsPerRequest)
  for (const number of requested) {
    if (number < 1 || number > maxPage) {
      errors.push(`PDF p.${number}は参照を許可されていません。参照可能なのは1～${maxPage}ページです。`)
      continue
    }
    try {
      const page = await tools.readPage(number)
      if (!page.text.trim()) {
        missingPages.push(number)
        continue
      }
      contexts.push({ pageNumber: number, text: page.text.slice(0, BOOK_AGENT_LIMITS.contextCharacters),
        truncated: page.text.length > BOOK_AGENT_LIMITS.contextCharacters })
    } catch {
      missingPages.push(number)
      errors.push(`PDF p.${number}の文字情報を取得できませんでした。`)
    }
  }
  if (missingPages.length) errors.push('文字のないページの画像OCRは行いません。')
  return { id: request.id, contexts, missingPages, indexedPages: tools.indexedPages(),
    ...(errors.length ? { error: errors.join(' ').slice(0, 300) } : {}) }
}
