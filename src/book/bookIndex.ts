export interface BookPassage {
  start: number
  end: number
  vector?: number[]
}

export interface BookPageIndex {
  id: string
  pdfId: string
  pageNumber: number
  text: string
  source: 'pdf-text' | 'ocr' | 'empty'
  passages: BookPassage[]
  relatedPages?: number[]
  updatedAt: number
}

export interface RetrievedPassage {
  pageNumber: number
  text: string
  score: number
}

const DB_NAME = 'DoriDoriBookIndexDB'
const STORE_NAME = 'pages'

function openIndexDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      store.createIndex('pdfId', 'pdfId')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadBookPages(pdfId: string): Promise<BookPageIndex[]> {
  const db = await openIndexDB()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).index('pdfId').getAll(pdfId)
      request.onsuccess = () => resolve((request.result as BookPageIndex[]).sort((a, b) => a.pageNumber - b.pageNumber))
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function saveBookPage(page: BookPageIndex): Promise<void> {
  const db = await openIndexDB()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(page)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

async function existingPdfIds(): Promise<Set<string>> {
  const name = import.meta.env.VITE_INDEXED_DB_NAME
  const main = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    if (!main.objectStoreNames.contains('pdfFiles')) return new Set()
    return await new Promise((resolve, reject) => {
      const request = main.transaction('pdfFiles', 'readonly').objectStore('pdfFiles').getAllKeys()
      request.onsuccess = () => resolve(new Set(request.result.map(String)))
      request.onerror = () => reject(request.error)
    })
  } finally {
    main.close()
  }
}

export async function removeDeletedBookIndexes(): Promise<void> {
  const validPdfIds = await existingPdfIds()
  const db = await openIndexDB()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const cursor = store.openCursor()
      cursor.onsuccess = () => {
        const item = cursor.result
        if (item) {
          if (!validPdfIds.has((item.value as BookPageIndex).pdfId)) item.delete()
          item.continue()
        }
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export function splitBookText(text: string): BookPassage[] {
  const passages: BookPassage[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + 1700, text.length)
    if (end < text.length) {
      const breakAt = Math.max(text.lastIndexOf('。', end), text.lastIndexOf('\n', end))
      if (breakAt > start + 850) end = breakAt + 1
    }
    passages.push({ start, end })
    start = end
  }
  return passages
}

function dot(a: number[], b: number[]): number {
  let value = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) value += a[i] * b[i]
  return value
}

function queryTerms(query: string): string[] {
  const segmenter = new Intl.Segmenter('ja', { granularity: 'word' })
  return [...segmenter.segment(query.toLowerCase())]
    .filter(item => item.isWordLike && item.segment.length >= 2)
    .map(item => item.segment)
    .filter(term => !['です', 'ます', 'こと', 'これ', 'それ', 'どこ', 'なぜ', 'どう', '説明', 'ください'].includes(term))
}

export function retrieveBookPassages(
  pages: BookPageIndex[], query: string, vector: number[] | null,
  currentPage: number, maxPage: number, limit = 5,
): RetrievedPassage[] {
  const terms = queryTerms(query)
  const candidates: RetrievedPassage[] = []
  for (const page of pages) {
    if (page.pageNumber > maxPage || !page.text) continue
    for (const passage of page.passages) {
      const text = page.text.slice(passage.start, passage.end)
      const lower = text.toLowerCase()
      const lexical = terms.length ? terms.filter(term => lower.includes(term)).length / terms.length : 0
      const semantic = vector && passage.vector?.length === vector.length
        ? Math.max(0, dot(vector, passage.vector)) : 0
      const score = semantic * 0.8 + lexical * 0.2 + (page.pageNumber === currentPage ? 0.035 : 0)
      candidates.push({ pageNumber: page.pageNumber, text, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const selected: RetrievedPassage[] = []
  const seenPages = new Set<number>()
  // The selected excerpt is the reader's primary context even when a short
  // question happens to match vocabulary elsewhere in the book more strongly.
  const current = candidates.find(candidate => candidate.pageNumber === currentPage)
  if (current) {
    selected.push(current)
    seenPages.add(currentPage)
  }
  for (const candidate of candidates) {
    if (candidate.score <= 0) continue
    if (seenPages.has(candidate.pageNumber)) continue
    seenPages.add(candidate.pageNumber)
    selected.push(candidate)
    if (selected.length === limit) break
  }
  // Add one neighboring page from the page-similarity graph without displacing
  // a stronger direct search result.
  if (selected.length > 1) {
    const first = pages.find(page => page.pageNumber === selected[0].pageNumber)
    const related = first?.relatedPages?.find(pageNumber =>
      pageNumber <= maxPage && !seenPages.has(pageNumber))
    const other = candidates.find(candidate => candidate.pageNumber === related)
    if (other && other.score > 0.3) selected.push(other)
  }
  return selected
}
