import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { embedBookTexts } from './bookKnowledgeApi'
import { BookPageIndex, loadBookPages, loadBookIndexSummary, retrieveBookPassages, saveBookPage, saveBookIndexSummary } from './bookIndex'
import { summarizeBookIndex, withBookIndexAttempt } from './bookIndexStatus'
import type { PDFTextInspection } from '@home-teacher/common/utils/pdfTextInspection'
import { readBookPageText } from './bookPageText'
import { resolveBookContext } from './bookContextTools'
import type { BookContextRequest } from '../../shared/bookAgentProtocol'

export type IndexPhase = 'idle' | 'reading' | 'embedding' | 'connecting' | 'complete' | 'stopped'

function averageVector(page: BookPageIndex): number[] | null {
  const vectors = page.passages.map(passage => passage.vector).filter((vector): vector is number[] => !!vector)
  if (!vectors.length) return null
  const average = vectors[0].map((_, i) => vectors.reduce((sum, vector) => sum + vector[i], 0) / vectors.length)
  const length = Math.hypot(...average)
  return length ? average.map(value => value / length) : null
}

export function useBookIndex(pdfId: string, pdfDoc: PDFDocumentProxy | null, numPages: number, textInspection?: PDFTextInspection) {
  const [pages, setPages] = useState<BookPageIndex[]>([])
  const [loadedPdfId, setLoadedPdfId] = useState<string | null>(null)
  const [loadedPageCount, setLoadedPageCount] = useState(-1)
  const [hasIndexFailure, setHasIndexFailure] = useState(false)
  const [phase, setPhase] = useState<IndexPhase>('idle')
  const [progress, setProgress] = useState(0)
  const [embeddingProgress, setEmbeddingProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const cancelRef = useRef(false)
  const runningRef = useRef(false)

  useEffect(() => {
    let active = true
    cancelRef.current = true
    Promise.all([loadBookPages(pdfId), loadBookIndexSummary(pdfId)]).then(([saved, cached]) => {
      if (!active) return
      setPages(saved)
      setLoadedPdfId(pdfId)
      setLoadedPageCount(numPages)
      setHasIndexFailure(cached?.state === 'failed')
      setError(cached?.state === 'failed' ? '前回の索引作成に失敗しました。保存済みの部分から再開できます。' : null)
      setProgress(saved.length)
      const summary = withBookIndexAttempt(summarizeBookIndex(pdfId, saved, numPages), textInspection, cached?.state === 'failed')
      setPhase(summary.state === 'complete' || summary.state === 'no-text'
        ? 'complete' : 'idle')
    }).catch(error => { if (active) setError(String(error)) })
    return () => { active = false; cancelRef.current = true }
  }, [pdfId, numPages, textInspection])

  const loaded = loadedPdfId === pdfId && loadedPageCount === numPages
  const summary = useMemo(() => withBookIndexAttempt(summarizeBookIndex(pdfId, pages, numPages), textInspection,
    hasIndexFailure, ['reading', 'embedding', 'connecting'].includes(phase)), [pdfId, pages, numPages, textInspection, hasIndexFailure, phase])
  useEffect(() => {
    if (!loaded || !numPages) return
    saveBookIndexSummary(summary).catch(reason => setError(`索引の状態を保存できませんでした: ${String(reason)}`))
  }, [summary, loaded, numPages])

  const stopIndexing = useCallback(() => { cancelRef.current = true }, [])

  const readPage = useCallback(async (number: number): Promise<BookPageIndex> => {
    if (!pdfDoc) throw new Error('PDFを読み込み中です')
    const pdfPage = await pdfDoc.getPage(number)
    const page = await readBookPageText(pdfId, number, pdfPage)
    await saveBookPage(page)
    return page
  }, [pdfDoc, pdfId])

  const startIndexing = useCallback(async () => {
    if (!pdfDoc || !numPages || !loaded || runningRef.current) return
    runningRef.current = true
    cancelRef.current = false
    setError(null)
    setHasIndexFailure(false)
    let attemptFailed = false
    try {
      const saved = await loadBookPages(pdfId)
      const byPage = new Map(saved.map(page => [page.pageNumber, page]))
      setPhase('reading')
      for (let number = 1; number <= numPages; number++) {
        if (cancelRef.current) break
        if (!byPage.has(number)) {
          const page = await readPage(number)
          byPage.set(number, page)
        }
        setProgress(number)
        setPages([...byPage.values()].sort((a, b) => a.pageNumber - b.pageNumber))
      }
      if (cancelRef.current) { setPhase('stopped'); return }

      setPhase('embedding')
      const pending = [...byPage.values()].flatMap(page => page.passages.map((passage, index) => ({ page, passage, index })))
        .filter(item => !item.passage.vector?.length)
      setEmbeddingProgress({ done: 0, total: pending.length })
      for (let offset = 0; offset < pending.length; offset += 8) {
        if (cancelRef.current) break
        const batch = pending.slice(offset, offset + 8)
        const vectors = await embedBookTexts(batch.map(item => item.page.text.slice(item.passage.start, item.passage.end)))
        for (let i = 0; i < batch.length; i++) batch[i].page.passages[batch[i].index].vector = vectors[i]
        for (const page of new Set(batch.map(item => item.page))) await saveBookPage(page)
        setPages([...byPage.values()].sort((a, b) => a.pageNumber - b.pageNumber))
        setEmbeddingProgress({ done: offset + batch.length, total: pending.length })
      }
      if (cancelRef.current) { setPhase('stopped'); return }

      setPhase('connecting')
      const indexed = [...byPage.values()]
      const averaged = indexed.map(page => ({ page, vector: averageVector(page) }))
      for (const item of averaged) {
        if (cancelRef.current) { setPhase('stopped'); return }
        if (!item.vector) continue
        item.page.relatedPages = averaged.filter(other => other.page !== item.page && other.vector)
          .map(other => ({ pageNumber: other.page.pageNumber,
            similarity: item.vector!.reduce((sum, value, i) => sum + value * other.vector![i], 0) }))
          .filter(other => other.similarity >= 0.7)
          .sort((a, b) => b.similarity - a.similarity).slice(0, 3)
          .map(other => other.pageNumber)
        await saveBookPage(item.page)
      }
      setPages(indexed.sort((a, b) => a.pageNumber - b.pageNumber))
      setPhase('complete')
    } catch (reason) {
      attemptFailed = true
      setHasIndexFailure(true)
      setError(reason instanceof Error ? reason.message : String(reason))
      setPhase('stopped')
    } finally {
      // An in-flight embedding batch may finish after the settings view closes.
      // Refresh persisted status even when React no longer runs this hook's effects.
      try { await saveBookIndexSummary(withBookIndexAttempt(summarizeBookIndex(pdfId, await loadBookPages(pdfId), numPages), textInspection, attemptFailed)) }
      catch (reason) { setError(`索引の状態を保存できませんでした: ${String(reason)}`) }
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
    embeddingProgress, error, startIndexing, stopIndexing, answerContextRequest }
}
