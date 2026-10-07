import assert from 'node:assert/strict'
import test from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { createInstance } from 'i18next'
import en from '../src/i18n/locales/en.json'
import ja from '../src/i18n/locales/ja.json'
import { loadBookIndexSummary, loadBookPages, saveBookIndexSummary, saveBookPage, type BookPageIndex } from '../src/book/bookIndex'
import { bookIndexLabel, bookIndexDotState, summarizeBookIndex, withBookIndexAttempt, withPDFTextInspection } from '../src/book/bookIndexStatus'
import { loadOrRecoverBookIndexSummary } from '../src/book/bookIndexStatusLoader'

globalThis.indexedDB = new IDBFactory()

function page(pdfId: string, pageNumber: number, text = '本文', embedded = false): BookPageIndex {
  return { id: `${pdfId}:${pageNumber}`, pdfId, pageNumber, text,
    source: text ? 'pdf-text' : 'empty', passages: text ? [{ start: 0, end: text.length,
      ...(embedded ? { vector: [1, 0] } : {}) }] : [], updatedAt: 1 }
}

test('language switching preserves index state and counts, including legacy unknown page totals', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', defaultNS: 'doridori', interpolation: { escapeValue: false },
    resources: { en: { doridori: en }, ja: { doridori: ja } } })
  const t = i18n.getFixedT(null, 'doridori')
  const summary = summarizeBookIndex('book', [page('book', 1, '本文', true)], 3)
  const saved = structuredClone(summary)
  assert.equal(bookIndexLabel(summary, t), 'Index incomplete: text pages 1/3, search passages 1/1')
  assert.equal(bookIndexLabel({ ...summary, totalPages: 0 }, t), 'Index incomplete: text pages 1, search passages 1/1')
  assert.equal(bookIndexLabel(null, t), 'Checking index status')
  assert.match(bookIndexLabel({ ...summary, state: 'failed' }, t), /resume/)
  await i18n.changeLanguage('ja')
  assert.equal(bookIndexLabel(summary, t), '索引は途中：本文 1/3ページ、意味検索 1/1箇所')
  assert.deepEqual(summary, saved)
  await i18n.changeLanguage('en')
  assert.match(bookIndexLabel({ ...summary, state: 'complete' }, t), /1\/3 text pages/)
})

test('completion requires actual page count and embeddings, while empty covers do not prevent completion', () => {
  assert.equal(summarizeBookIndex('book', [], 3).state, 'none')
  assert.equal(summarizeBookIndex('book', [page('book', 1, '本文', true)], 3).state, 'partial')
  const pages = [page('book', 1, ''), page('book', 2), page('book', 3, '別の本文', true)]
  assert.equal(summarizeBookIndex('book', pages, 3).state, 'partial')
  pages[1].passages[0].vector = [1, 0]
  assert.deepEqual(summarizeBookIndex('book', pages, 3), { pdfId: 'book', state: 'complete', totalPages: 3,
    checkedPages: 3, textPages: 2, indexedPages: 2, totalPassages: 2, embeddedPassages: 2 })
  assert.equal(summarizeBookIndex('book', pages, 0).state, 'partial')
  assert.equal(summarizeBookIndex('book', [page('book', 1, ''), page('book', 2, '')], 2).state, 'no-text')
  pages[1].passages[0].vector = []
  assert.equal(summarizeBookIndex('book', pages, 3).state, 'partial')
})

test('duplicate, invalid and other-book pages cannot make an index appear complete', () => {
  const pages = [page('book', 1, '本文', true), page('book', 1, '本文', true),
    page('other', 2, '本文', true), page('book', 4, '本文', true), page('book', 1.5, '本文', true)]
  const summary = summarizeBookIndex('book', pages, 2)
  assert.equal(summary.state, 'partial')
  assert.equal(summary.checkedPages, 1)
})

test('only a complete no-text inspection establishes absence before indexing, and actual text wins', () => {
  const none = summarizeBookIndex('book', [], 0)
  const absent = { status: 'absent' as const, checkedPages: 3, totalPages: 3 }
  assert.equal(withPDFTextInspection(none, absent).state, 'no-text')
  assert.equal(withPDFTextInspection(none, absent).checkedPages, 3)
  assert.equal(withPDFTextInspection(none, { ...absent, status: 'unknown' }).state, 'none')
  assert.equal(withPDFTextInspection(none, { ...absent, status: 'present' }).state, 'none')
  assert.equal(withPDFTextInspection(none, { ...absent, checkedPages: 1 }).state, 'none')
  assert.equal(withPDFTextInspection(summarizeBookIndex('book', [], 4), absent).state, 'none')
  assert.equal(withPDFTextInspection(summarizeBookIndex('book', [page('book', 1)], 3), absent).state, 'partial')
})

test('dots represent known text and index progress; absent or unconfirmed text keeps a transparent slot', () => {
  const present = { status: 'present' as const, checkedPages: 2, totalPages: 3 }
  const absent = { status: 'absent' as const, checkedPages: 3, totalPages: 3 }
  const none = summarizeBookIndex('book', [], 3)
  const partial = summarizeBookIndex('book', [page('book', 2)], 3)
  const complete = summarizeBookIndex('book', [page('book', 1, ''), page('book', 2, '本文', true), page('book', 3, '')], 3)
  assert.equal(bookIndexDotState(none, present), 'none')
  assert.equal(bookIndexDotState(withBookIndexAttempt(none, present, false, true), present), 'partial')
  assert.equal(bookIndexDotState(partial), 'partial')
  assert.equal(bookIndexDotState(complete), 'complete')
  assert.equal(bookIndexDotState(withBookIndexAttempt(partial, present, true), present), 'failed')
  assert.equal(bookIndexDotState(none, present, true), 'failed')
  assert.equal(bookIndexDotState(withPDFTextInspection(none, absent), absent), 'transparent')
  assert.equal(bookIndexDotState(withBookIndexAttempt(none, absent, true), absent, true), 'transparent')
  assert.equal(bookIndexDotState(none, { ...absent, status: 'unknown' }), 'transparent')
  assert.equal(bookIndexDotState(null), 'transparent')
  // Text from an older saved index is sufficient even without import metadata.
  assert.equal(bookIndexDotState(partial, absent), 'partial')
})

test('failed attempts remain red after reopening; cancellation stays yellow and a successful retry becomes green', async () => {
  const pdfId = 'retry-book'
  const present = { status: 'present' as const, checkedPages: 1, totalPages: 1 }
  const saved = page(pdfId, 1)
  await saveBookPage(saved)
  const partial = summarizeBookIndex(pdfId, [saved], 1)
  const failed = withBookIndexAttempt(partial, present, true)
  await saveBookIndexSummary(failed)
  const reopened = await loadOrRecoverBookIndexSummary(pdfId, async () => { throw new Error('Cached failure must be retained') })
  assert.equal(bookIndexDotState(reopened, present), 'failed')
  assert.deepEqual(await loadBookPages(pdfId), [saved])
  assert.equal(bookIndexDotState(withBookIndexAttempt(partial, present), present), 'partial')
  await saveBookIndexSummary(withBookIndexAttempt(partial, present, false, true))
  assert.equal(bookIndexDotState(await loadBookIndexSummary(pdfId), present), 'partial')
  saved.passages[0].vector = [1, 0]
  await saveBookPage(saved)
  await saveBookIndexSummary(withBookIndexAttempt(summarizeBookIndex(pdfId, [saved], 1), present))
  assert.equal(bookIndexDotState(await loadBookIndexSummary(pdfId), present), 'complete')
})

test('legacy page records are retained; recovery reads the PDF count once and caches only status metadata', async () => {
  const original = page('legacy', 1, '保存済みの本文', true)
  await saveBookPage(original)
  let reads = 0
  const status = await loadOrRecoverBookIndexSummary('legacy', async () => { reads++; return 5 })
  assert.equal(status.state, 'partial')
  assert.equal(status.totalPages, 5)
  assert.deepEqual(await loadBookPages('legacy'), [original])
  assert.deepEqual(await loadBookIndexSummary('legacy'), status)
  assert.deepEqual(await loadOrRecoverBookIndexSummary('legacy', async () => { throw new Error('PDF must not be reparsed') }), status)
  assert.equal(reads, 1)
  assert.equal(JSON.stringify(status).includes(original.text), false)
  // Deployed older clients still open and read their version-1 database.
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('DoriDoriBookIndexDB', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  assert.equal(db.version, 1)
  db.close()
})

test('books without an index do not parse the PDF or call AI; updated status survives reopening', async () => {
  const empty = await loadOrRecoverBookIndexSummary('new-book', async () => { throw new Error('Unnecessary PDF parse') })
  assert.equal(empty.state, 'none')
  const partial = summarizeBookIndex('new-book', [page('new-book', 1)], 1)
  await saveBookIndexSummary(partial)
  assert.equal((await loadOrRecoverBookIndexSummary('new-book', async () => 1)).state, 'partial')
  const completed = summarizeBookIndex('new-book', [page('new-book', 1, '本文', true)], 1)
  await saveBookIndexSummary(completed)
  assert.deepEqual(await loadOrRecoverBookIndexSummary('new-book', async () => 1), completed)
})

test('a failed legacy PDF read does not mark completion or change cached book text', async () => {
  const original = page('failed-read', 1, '保持する本文', true)
  await saveBookPage(original)
  await assert.rejects(loadOrRecoverBookIndexSummary('failed-read', async () => { throw new Error('PDF unavailable') }), /PDF unavailable/)
  assert.equal(await loadBookIndexSummary('failed-read'), null)
  assert.deepEqual(await loadBookPages('failed-read'), [original])
  assert.equal((await loadOrRecoverBookIndexSummary('failed-read', async () => 1)).state, 'complete')
})
