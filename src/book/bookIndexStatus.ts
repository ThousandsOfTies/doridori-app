import type { BookPageIndex } from './bookIndex'

export type BookIndexState = 'none' | 'partial' | 'complete' | 'no-text'

export interface BookIndexSummary {
  pdfId: string
  state: BookIndexState
  totalPages: number
  checkedPages: number
  textPages: number
  indexedPages: number
  totalPassages: number
  embeddedPassages: number
}

export function summarizeBookIndex(pdfId: string, pages: BookPageIndex[], totalPages: number): BookIndexSummary {
  const valid = [...new Map(pages.filter(page => page.pdfId === pdfId && Number.isInteger(page.pageNumber) && page.pageNumber >= 1 &&
    (!totalPages || page.pageNumber <= totalPages)).map(page => [page.pageNumber, page])).values()]
  const textPages = valid.filter(page => page.text.trim())
  const passages = textPages.flatMap(page => page.passages)
  const embeddedPassages = passages.filter(passage => passage.vector?.length).length
  const fullyChecked = totalPages > 0 && valid.length === totalPages
  const state: BookIndexState = !valid.length ? 'none' :
    fullyChecked && !textPages.length ? 'no-text' :
      fullyChecked && passages.length > 0 && embeddedPassages === passages.length ? 'complete' : 'partial'
  return { pdfId, state, totalPages, checkedPages: valid.length, textPages: textPages.length,
    indexedPages: textPages.filter(page => page.passages.length && page.passages.every(passage => passage.vector?.length)).length,
    totalPassages: passages.length, embeddedPassages }
}

export function bookIndexLabel(summary: BookIndexSummary | null): string {
  if (!summary) return '索引の状態を確認中'
  if (summary.state === 'none') return '索引未作成'
  if (summary.state === 'no-text') return '文字情報がありません'
  if (summary.state === 'complete') return `索引作成済み：本文 ${summary.textPages}/${summary.totalPages}ページ`
  return `索引は途中：本文 ${summary.textPages}${summary.totalPages ? `/${summary.totalPages}` : ''}ページ、意味検索 ${summary.embeddedPassages}/${summary.totalPassages}箇所`
}
