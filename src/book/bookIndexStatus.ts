import type { BookPageIndex } from './bookIndex'
import type { PDFTextInspection } from '@home-teacher/common/utils/pdfTextInspection'
import type { TFunction } from 'i18next'

export type BookIndexState = 'none' | 'partial' | 'complete' | 'no-text' | 'failed'

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

export function bookIndexLabel(summary: BookIndexSummary | null, t: TFunction<'doridori'>): string {
  if (!summary) return t('index.status.checking')
  if (summary.state === 'none') return t('index.status.none')
  if (summary.state === 'no-text') return t('index.status.noText')
  if (summary.state === 'failed') return t('index.status.failed')
  if (summary.state === 'complete') return t('index.status.complete', { ...summary })
  return t('index.status.partial', { ...summary,
    textPageCount: `${summary.textPages}${summary.totalPages ? `/${summary.totalPages}` : ''}` })
}

export function withPDFTextInspection(summary: BookIndexSummary, inspection?: PDFTextInspection): BookIndexSummary {
  // Trust only a successful whole-book check. Actual indexed text takes precedence
  // over import metadata, and an unknown/partial check never means "no text".
  if (inspection?.status !== 'absent' || !Number.isInteger(inspection.totalPages) || inspection.totalPages <= 0 ||
    inspection.checkedPages !== inspection.totalPages || summary.textPages || summary.totalPassages ||
    summary.totalPages && summary.totalPages !== inspection.totalPages) return summary
  return { ...summary, state: 'no-text', checkedPages: inspection.checkedPages, totalPages: inspection.totalPages }
}

export function hasBookText(summary: BookIndexSummary | null, inspection?: PDFTextInspection): boolean {
  return !!summary?.textPages || summary?.state !== 'no-text' && inspection?.status === 'present'
}

export function withBookIndexAttempt(summary: BookIndexSummary, inspection?: PDFTextInspection, failed = false, running = false): BookIndexSummary {
  const result = withPDFTextInspection(summary, inspection)
  if (!hasBookText(result, inspection)) return result
  return failed ? { ...result, state: 'failed' } : running ? { ...result, state: 'partial' } : result
}

export function bookIndexDotState(summary: BookIndexSummary | null, inspection?: PDFTextInspection, unavailable = false): string {
  if (!hasBookText(summary, inspection)) return 'transparent'
  if (unavailable || summary?.state === 'failed') return 'failed'
  return summary?.state === 'complete' ? 'complete' : summary?.state === 'partial' ? 'partial' : 'none'
}
