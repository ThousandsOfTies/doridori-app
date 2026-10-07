import type { BookPageIndex } from './bookIndex'
import { connectBookPages, throwIfIndexingStopped } from './connectBookPages'
import type { RelatedPages } from './bookRelatedPages'

export type IndexPhase = 'idle' | 'reading' | 'embedding' | 'connecting' | 'complete' | 'stopped'
export type IndexProgress = {
  phase: IndexPhase
  pages: BookPageIndex[]
  progress: number
  embeddingProgress: { done: number; total: number }
}
type Ports = {
  loadPages: () => Promise<BookPageIndex[]>
  readPage: (number: number) => Promise<BookPageIndex>
  savePage: (page: BookPageIndex) => Promise<void>
  embedTexts: (texts: string[]) => Promise<number[][]>
  connectPages?: (pages: BookPageIndex[], signal: AbortSignal) => Promise<RelatedPages[]>
  now?: () => number
}

// Keep expensive page snapshots at most every 150 ms, plus every phase boundary
// and stop. Reads and the existing eight-passage AI batches are unchanged.
export async function buildBookIndex(numPages: number, signal: AbortSignal, ports: Ports,
  onProgress: (progress: IndexProgress) => void): Promise<void> {
  const byPage = new Map((await ports.loadPages()).map(page => [page.pageNumber, page]))
  let phase: IndexPhase = 'reading', progress = 0
  let embeddingProgress = { done: 0, total: 0 }
  const now = ports.now ?? (() => performance.now())
  let lastPublished = -Infinity
  const publish = (force = false) => {
    const time = now()
    if (!force && time - lastPublished < 150) return
    lastPublished = time
    onProgress({ phase, progress, embeddingProgress,
      pages: [...byPage.values()].sort((a, b) => a.pageNumber - b.pageNumber) })
  }
  try {
    throwIfIndexingStopped(signal)
    publish(true)
    for (let number = 1; number <= numPages; number++) {
      throwIfIndexingStopped(signal)
      if (!byPage.has(number)) byPage.set(number, await ports.readPage(number))
      progress = number
      publish()
    }
    throwIfIndexingStopped(signal)
    phase = 'embedding'
    const pending = [...byPage.values()].flatMap(page => page.passages.map((passage, index) => ({ page, passage, index })))
      .filter(item => !item.passage.vector?.length)
    embeddingProgress = { done: 0, total: pending.length }
    publish(true)
    for (let offset = 0; offset < pending.length; offset += 8) {
      throwIfIndexingStopped(signal)
      const batch = pending.slice(offset, offset + 8)
      const vectors = await ports.embedTexts(batch.map(item => item.page.text.slice(item.passage.start, item.passage.end)))
      for (let i = 0; i < batch.length; i++) batch[i].page.passages[batch[i].index].vector = vectors[i]
      // Finish saving an in-flight batch even if stop was pressed, so it is reused.
      for (const page of new Set(batch.map(item => item.page))) await ports.savePage(page)
      embeddingProgress = { done: offset + batch.length, total: pending.length }
      publish()
    }
    throwIfIndexingStopped(signal)
    phase = 'connecting'
    publish(true)
    const indexed = [...byPage.values()]
    const related = await (ports.connectPages ?? connectBookPages)(indexed, signal)
    for (const item of related) {
      throwIfIndexingStopped(signal)
      const page = byPage.get(item.pageNumber)!
      page.relatedPages = item.relatedPages
      await ports.savePage(page)
    }
    throwIfIndexingStopped(signal)
    phase = 'complete'
    publish(true)
  } catch (reason) {
    phase = 'stopped'
    publish(true)
    throw reason
  }
}
