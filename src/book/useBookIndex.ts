import { localizeBookError } from '../i18n/errorMessages'
import en from '../i18n/locales/en.json'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { embedBookTexts } from './bookKnowledgeApi'
import { BookPageIndex, loadBookPages, loadBookIndexSummary, retrieveBookPassages, saveBookPage, saveBookIndexSummary } from './bookIndex'
import { summarizeBookIndex, withBookIndexAttempt } from './bookIndexStatus'
import type { PDFTextInspection } from '@home-teacher/common/utils/pdfTextInspection'
import { readBookPageText } from './bookPageText'
import { resolveBookContext } from './bookContextTools'
import type { BookContextRequest } from '../../shared/bookAgentProtocol'
import { useDoriTranslation } from '../i18n'
import { buildBookIndex, type IndexPhase } from './buildBookIndex'

export type { IndexPhase } from './buildBookIndex'
type IndexError = { kind: 'previousFailure' | 'load' | 'save' | 'indexing' | 'pdfLoading'; detail?: string }
class PDFNotReadyError extends Error {}

export function useBookIndex(pdfId: string, pdfDoc: PDFDocumentProxy | null, numPages: number, textInspection?: PDFTextInspection) {
  const { t } = useDoriTranslation()
  const [pages, setPages] = useState<BookPageIndex[]>([])
  const [loadedPdfId, setLoadedPdfId] = useState<string | null>(null)
  const [loadedPageCount, setLoadedPageCount] = useState(-1)
  const [hasIndexFailure, setHasIndexFailure] = useState(false)
  const [phase, setPhase] = useState<IndexPhase>('idle')
  const [progress, setProgress] = useState(0)
  const [embeddingProgress, setEmbeddingProgress] = useState({ done: 0, total: 0 })
  // Store the cause rather than translated wording so language changes only update the UI.
  const [error, setError] = useState<IndexError | null>(null)
  const indexingAbortRef = useRef<AbortController | null>(null)
  const activePdfRef = useRef<string | null>(pdfId)
  const runningRef = useRef(false)

  useEffect(() => {
    let active = true
    activePdfRef.current = pdfId
    indexingAbortRef.current?.abort()
    Promise.all([loadBookPages(pdfId), loadBookIndexSummary(pdfId)]).then(([saved, cached]) => {
      if (!active) return
      setPages(saved)
      setLoadedPdfId(pdfId)
      setLoadedPageCount(numPages)
      setHasIndexFailure(cached?.state === 'failed')
      setError(cached?.state === 'failed' ? { kind: 'previousFailure' } : null)
      setProgress(saved.length)
      const summary = withBookIndexAttempt(summarizeBookIndex(pdfId, saved, numPages), textInspection, cached?.state === 'failed')
      setPhase(summary.state === 'complete' || summary.state === 'no-text'
        ? 'complete' : 'idle')
    }).catch(reason => { if (active) setError({ kind: 'load', detail: String(reason) }) })
    return () => { active = false; activePdfRef.current = null; indexingAbortRef.current?.abort() }
  }, [pdfId, numPages, textInspection])

  const loaded = loadedPdfId === pdfId && loadedPageCount === numPages
  const summary = useMemo(() => withBookIndexAttempt(summarizeBookIndex(pdfId, pages, numPages), textInspection,
    hasIndexFailure, ['reading', 'embedding', 'connecting'].includes(phase)), [pdfId, pages, numPages, textInspection, hasIndexFailure, phase])
  useEffect(() => {
    if (!loaded || !numPages) return
    saveBookIndexSummary(summary).catch(reason => setError({ kind: 'save', detail: String(reason) }))
  }, [summary, loaded, numPages])

  const stopIndexing = useCallback(() => { indexingAbortRef.current?.abort() }, [])

  const readPage = useCallback(async (number: number): Promise<BookPageIndex> => {
    if (!pdfDoc) throw new PDFNotReadyError(en.errors.pdfLoading)
    const pdfPage = await pdfDoc.getPage(number)
    const page = await readBookPageText(pdfId, number, pdfPage)
    await saveBookPage(page)
    return page
  }, [pdfDoc, pdfId])

  const startIndexing = useCallback(async () => {
    if (!pdfDoc || !numPages || !loaded || runningRef.current) return
    runningRef.current = true
    const controller = new AbortController()
    indexingAbortRef.current = controller
    setError(null)
    setHasIndexFailure(false)
    let attemptFailed = false
    try {
      await buildBookIndex(numPages, controller.signal, {
        loadPages: () => loadBookPages(pdfId), readPage, savePage: saveBookPage, embedTexts: embedBookTexts,
      }, update => {
        if (activePdfRef.current !== pdfId) return
        setPages(update.pages)
        setPhase(update.phase)
        setProgress(update.progress)
        setEmbeddingProgress(update.embeddingProgress)
      })
    } catch (reason) {
      if (!controller.signal.aborted) {
        attemptFailed = true
        if (activePdfRef.current === pdfId) {
          setHasIndexFailure(true)
          setError(reason instanceof PDFNotReadyError ? { kind: 'pdfLoading' } :
            { kind: 'indexing', detail: reason instanceof Error ? reason.message : String(reason) })
        }
      }
      if (activePdfRef.current === pdfId) setPhase('stopped')
    } finally {
      // An in-flight embedding batch may finish after the settings view closes.
      // Refresh persisted status even when React no longer runs this hook's effects.
      try { await saveBookIndexSummary(withBookIndexAttempt(summarizeBookIndex(pdfId, await loadBookPages(pdfId), numPages), textInspection, attemptFailed)) }
      catch (reason) { if (activePdfRef.current === pdfId) setError({ kind: 'save', detail: String(reason) }) }
      indexingAbortRef.current = null
      runningRef.current = false
    }
  }, [pdfDoc, pdfId, numPages, readPage, textInspection, loaded])

  const searchBook = useCallback(async (query: string, currentPage: number, includeLaterPages: boolean) => {
    const latest = await loadBookPages(pdfId)
    if (!latest.some(page => page.pageNumber === currentPage) && pdfDoc) {
      const current = await readPage(currentPage)
      latest.push(current)
      setPages([...latest].sort((a, b) => a.pageNumber - b.pageNumber))
    }
    let vector: number[] | null = null
    if (latest.some(page => page.passages.some(passage => passage.vector))) {
      try { vector = (await embedBookTexts([query]))[0] }
      catch (error) { console.warn('Meaning search unavailable; using text search:', error) }
    }
    return {
      passages: retrieveBookPassages(latest, query, vector, currentPage,
        includeLaterPages ? numPages : currentPage),
      indexedPages: latest.filter(page => page.text.trim()).length,
    }
  }, [pdfId, numPages, pdfDoc, readPage])

  const answerContextRequest = useCallback(async (request: BookContextRequest, currentPage: number, includeLaterPages: boolean) => {
    const saved = await loadBookPages(pdfId)
    const byPage = new Map(saved.map(page => [page.pageNumber, page]))
    return resolveBookContext(request, {
      currentPage, totalPages: numPages, includeLaterPages,
      search: query => searchBook(query, currentPage, includeLaterPages),
      readPage: async number => {
        const page = byPage.get(number) || await readPage(number)
        byPage.set(number, page)
        setPages([...byPage.values()].sort((a, b) => a.pageNumber - b.pageNumber))
        return page
      },
      indexedPages: () => [...byPage.values()].filter(page => page.text.trim()).length,
    })
  }, [pdfId, numPages, searchBook, readPage])

  const textPageCount = pages.filter(page => page.text.trim()).length
  const missingTextPageCount = pages.length - textPageCount
  return { pages, phase, progress, textPageCount, missingTextPageCount, summary, loaded,
    embeddingProgress, error: error ? t(`index.error.${error.kind}`, { detail: error.detail ? localizeBookError(error.detail, t) : '' }) : null,
    startIndexing, stopIndexing, answerContextRequest }
}
