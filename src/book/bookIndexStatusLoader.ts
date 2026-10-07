import messages from '../i18n/locales/ja.json'
import type { PDFFileRecord } from '@home-teacher/common/utils/indexedDB'
import { loadBookIndexSummary, loadBookPages, saveBookIndexSummary } from './bookIndex'
import { summarizeBookIndex, type BookIndexSummary } from './bookIndexStatus'

const recovering = new Map<string, Promise<BookIndexSummary>>()

export async function loadOrRecoverBookIndexSummary(pdfId: string, readTotalPages: () => Promise<number>): Promise<BookIndexSummary> {
  const cached = await loadBookIndexSummary(pdfId)
  if (cached) return cached
  const pending = recovering.get(pdfId)
  if (pending) return pending
  const work = (async () => {
    const pages = await loadBookPages(pdfId)
    if (!pages.length) return summarizeBookIndex(pdfId, [], 0)
    // Legacy indexes did not store the PDF's total page count. The last indexed
    // page cannot establish completion; read the actual count once, without AI.
    const totalPages = await readTotalPages()
    const summary = summarizeBookIndex(pdfId, pages, totalPages)
    await saveBookIndexSummary(summary)
    return summary
  })()
  recovering.set(pdfId, work)
  try { return await work } finally { recovering.delete(pdfId) }
}

export function getSavedBookIndexSummary(record: PDFFileRecord): Promise<BookIndexSummary> {
  return loadOrRecoverBookIndexSummary(record.id, async () => {
    const [{ fetchPDFRange, fetchPDFData }, { PDFBlobRangeTransport, getRangePDFDocument }] = await Promise.all([
      import('@home-teacher/common/utils/indexedDB'),
      import('@home-teacher/common/utils/pdfRange'),
    ])
    const size = record.fileData instanceof Blob ? record.fileData.size : 0
    const fallback = size ? null : await fetchPDFData(record.id)
    let rejectRead: (error: Error) => void = () => {}
    const failure = new Promise<never>((_, reject) => { rejectRead = reject })
    const range = new PDFBlobRangeTransport(size || fallback!.byteLength,
      size ? (begin, end) => fetchPDFRange(record.id, begin, end) : async (begin, end) => fallback!.slice(begin, end),
      rejectRead)
    // Use the same PDF.js instance and worker configured by usePDFRenderer.
    const loading = getRangePDFDocument(range, { useWorkerFetch: false, isEvalSupported: false, stopAtErrors: true })
    let timeout: ReturnType<typeof setTimeout>
    try {
      const document = await Promise.race([loading.promise, failure, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(messages.errors.pageCount)), 30000)
      })])
      return document.numPages
    } finally { clearTimeout(timeout!); range?.abort(); await loading.destroy() }
  })
}
