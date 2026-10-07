import messages from '../i18n/locales/ja.json'
import type { PDFStudyTraceRecord } from '@home-teacher/common/utils/indexedDB'
import type { BookQuestionResult, ReferenceMediaResult } from './bookReferenceMedia'

/** Update just one answer atomically; never restore deleted or replaced conversations. */
export async function saveBookReferenceMedia(
  dbName: string, traceId: string, stepId: string, answer: string, media: ReferenceMediaResult,
): Promise<BookQuestionResult | null> {
  if (!dbName?.trim()) throw new Error(messages.errors.databaseName)
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName)
    // A reference lookup must not create a new database after its PDF was removed.
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    if (!db.objectStoreNames.contains('pdfStudyTraces')) return null
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('pdfStudyTraces', 'readwrite')
      const store = transaction.objectStore('pdfStudyTraces')
      const request = store.get(traceId)
      let updated: BookQuestionResult | null = null
      request.onsuccess = () => {
        const trace = request.result as PDFStudyTraceRecord | undefined
        const step = trace?.steps.find(item => item.id === stepId && item.type === 'grading')
        if (!trace || !step?.result || (step.result.overallComment || step.result.rawResponse || '') !== answer) return
        updated = { ...step.result, referenceMedia: media }
        store.put({ ...trace, steps: trace.steps.map(item => item.id === stepId ? { ...item, result: updated } : item) })
      }
      transaction.oncomplete = () => resolve(updated)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
}
