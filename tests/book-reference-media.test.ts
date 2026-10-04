import assert from 'node:assert/strict'
import test from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { createReferenceMediaLoader, normalizeReferenceMedia, type ReferenceMediaResult } from '../src/book/bookReferenceMedia'
import { saveBookReferenceMedia } from '../src/book/bookReferenceMediaStorage'

const item = {
  id: '101', title: '需要と供給', caption: '交点を見ます。',
  imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Test.svg/1280px-Test.svg.png',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Test.svg', sourceName: 'Wikimedia Commons',
  author: 'Alice', attribution: '', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  width: 1280, height: 900,
}
const ready: ReferenceMediaResult = { status: 'ready', items: [item] }

test('reference responses reject unsafe media and source links, including stored records', () => {
  assert.deepEqual(normalizeReferenceMedia(ready), ready)
  for (const changes of [
    { imageUrl: 'javascript:alert(1)' }, { imageUrl: 'https://upload.wikimedia.org.evil.example/wikipedia/commons/a.png' },
    { sourceUrl: 'https://evil.example/commons' }, { licenseUrl: 'http://creativecommons.org/licenses/by-sa/4.0/' },
    { imageUrl: 'https://user@upload.wikimedia.org/wikipedia/commons/a.png' }, { width: 0 }, { caption: undefined },
  ]) assert.deepEqual(normalizeReferenceMedia({ status: 'ready', items: [{ ...item, ...changes }] }), { status: 'empty', items: [] })
  assert.deepEqual(normalizeReferenceMedia(null), { status: 'unavailable', items: [] })
  assert.deepEqual(normalizeReferenceMedia({ status: 'ready', items: [item, item, item] }).items.length, 2)
})

test('simultaneous mounts share one lookup, while different questions remain separate', async () => {
  let requests = 0
  let resolveRequest: (value: unknown) => void
  const loader = createReferenceMediaLoader(async () => {
    requests++
    return new Promise(resolve => { resolveRequest = resolve })
  })
  const body = { question: '質問', answer: '回答', model: 'gemini-3.8-flash' }
  const first = loader(body), second = loader(body)
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(requests, 1)
  resolveRequest!(ready)
  assert.deepEqual(await first, ready)
  assert.equal(loader(body), first)
  const other = loader({ ...body, question: '別の質問' })
  await Promise.resolve()
  assert.equal(requests, 2)
  resolveRequest!({ status: 'empty', items: [] })
  await other
})

test('network failures and unavailable responses can be retried', async () => {
  let requests = 0
  const loader = createReferenceMediaLoader(async () => {
    requests++
    if (requests === 1) throw new Error('Network offline')
    return requests === 2 ? { status: 'unavailable', items: [] } : ready
  })
  const body = { question: '', answer: '回答' }
  await assert.rejects(loader(body), /Network offline/)
  assert.equal((await loader(body)).status, 'unavailable')
  assert.deepEqual(await loader(body), ready)
  assert.equal(requests, 3)
})

async function seedTrace() {
  globalThis.indexedDB = new IDBFactory()
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('ReferenceMediaTest', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('pdfStudyTraces', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const trace = { id: 'trace', pdfId: 'book', steps: [
    { id: 'question', type: 'answer' },
    { id: 'response', type: 'grading', result: { pageType: 'book-question', problems: [], overallComment: '回答', referenceQuestion: '質問' } },
    { id: 'later-question', type: 'answer', answerTexts: [{ text: '追加質問' }] },
  ] }
  await new Promise<void>(resolve => {
    const transaction = db.transaction('pdfStudyTraces', 'readwrite')
    transaction.objectStore('pdfStudyTraces').put(trace)
    transaction.oncomplete = () => resolve()
  })
  return { db, trace, read: () => new Promise<any>(resolve => {
    const request = db.transaction('pdfStudyTraces', 'readonly').objectStore('pdfStudyTraces').get('trace')
    request.onsuccess = () => resolve(request.result)
  }) }
}

test('reference media persists inside the existing answer without truncating subsequent questions', async t => {
  const fixture = await seedTrace()
  t.after(() => fixture.db.close())
  const updated = await saveBookReferenceMedia('ReferenceMediaTest', 'trace', 'response', '回答', ready)
  assert.deepEqual(updated?.referenceMedia, ready)
  assert.equal(updated?.referenceQuestion, '質問')
  const stored = await fixture.read()
  assert.equal(stored.steps.length, 3)
  assert.deepEqual(stored.steps[2], fixture.trace.steps[2])
  assert.deepEqual(stored.steps[1].result.referenceMedia, ready)
})

test('late lookups never overwrite replaced answers or recreate deleted histories', async t => {
  const fixture = await seedTrace()
  t.after(() => fixture.db.close())
  assert.equal(await saveBookReferenceMedia('ReferenceMediaTest', 'trace', 'response', '古い回答', ready), null)
  assert.equal(await saveBookReferenceMedia('ReferenceMediaTest', 'trace', 'gone-step', '回答', ready), null)
  assert.equal(await saveBookReferenceMedia('ReferenceMediaTest', 'deleted-trace', 'response', '回答', ready), null)
  assert.deepEqual(await fixture.read(), fixture.trace)
})
