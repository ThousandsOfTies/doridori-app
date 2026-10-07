import type { BookPageIndex } from './bookIndex'
import { averageBookPageVector, createRelatedPageCalculation, type PageVector, type RelatedPages } from './bookRelatedPages'

export function throwIfIndexingStopped(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Indexing stopped', 'AbortError')
}

const createWorker = () => new Worker(new URL('./bookRelatedPages.worker.ts', import.meta.url), { type: 'module' })

function runWorker(vectors: PageVector[], signal: AbortSignal, worker: Worker): Promise<RelatedPages[]> {
  return new Promise((resolve, reject) => {
    const dispose = () => {
      signal.removeEventListener('abort', abort)
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
    }
    const abort = () => { dispose(); reject(new DOMException('Indexing stopped', 'AbortError')) }
    worker.onmessage = (event: MessageEvent<RelatedPages[]>) => { dispose(); resolve(event.data) }
    worker.onerror = event => { event.preventDefault(); dispose(); reject(new Error('Related-page worker failed')) }
    worker.onmessageerror = () => { dispose(); reject(new Error('Related-page worker message failed')) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    try { worker.postMessage(vectors) }
    catch (reason) { dispose(); reject(reason) }
  })
}

export async function connectBookPages(pages: BookPageIndex[], signal: AbortSignal,
  workerFactory: (() => Worker) | null = typeof Worker === 'undefined' ? null : createWorker): Promise<RelatedPages[]> {
  throwIfIndexingStopped(signal)
  const vectors = pages.map(page => ({ pageNumber: page.pageNumber, vector: averageBookPageVector(page) }))
  if (workerFactory) {
    try { return await runWorker(vectors, signal, workerFactory()) }
    catch (reason) { throwIfIndexingStopped(signal); console.warn('Related-page worker unavailable; using local chunks:', reason) }
  }
  const calculation = createRelatedPageCalculation(vectors)
  while (!calculation.step()) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    throwIfIndexingStopped(signal)
  }
  throwIfIndexingStopped(signal)
  return calculation.result()
}
