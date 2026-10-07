import assert from 'node:assert/strict'
import test from 'node:test'
import type { BookPageIndex } from '../src/book/bookIndex'
import { averageBookPageVector, createRelatedPageCalculation, type PageVector } from '../src/book/bookRelatedPages'
import { connectBookPages } from '../src/book/connectBookPages'
import { buildBookIndex, type IndexProgress } from '../src/book/buildBookIndex'

function page(pageNumber: number, vector?: number[]): BookPageIndex {
  return { id: `book:${pageNumber}`, pdfId: 'book', pageNumber, text: `page ${pageNumber}`,
    passages: [{ start: 0, end: 20, ...(vector ? { vector } : {}) }], source: 'pdf-text', updatedAt: 1 }
}

function legacyRelatedPages(pages: PageVector[]) {
  return pages.filter(page => page.vector).map(item => ({ pageNumber: item.pageNumber,
    relatedPages: pages.filter(other => other !== item && other.vector)
      .map(other => ({ pageNumber: other.pageNumber,
        similarity: item.vector!.reduce((sum, value, i) => sum + value * other.vector![i], 0) }))
      .filter(other => other.similarity >= 0.7).sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3).map(other => other.pageNumber),
  }))
}
function calculate(pages: PageVector[], chunk = 512) {
  const calculation = createRelatedPageCalculation(pages)
  while (!calculation.step(chunk)) {}
  return calculation
}

test('paired calculation exactly matches the previous ranking, threshold, ties and missing-vector handling', () => {
  let randomState = 58211
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 2 ** 32 }
  for (let run = 0; run < 30; run++) {
    const pages = Array.from({ length: 25 }, (_, i) => page((i * 17) % 25 + 1,
      i % 7 === 0 ? undefined : Array.from({ length: 8 }, () => random() * 1.5 - 0.4)))
    pages[2].passages.push({ start: 0, end: 1, vector: [1, 0, 0, 0, 0, 0, 0, 0] })
    const vectors = pages.map(page => ({ pageNumber: page.pageNumber, vector: averageBookPageVector(page) }))
    assert.deepEqual(calculate(vectors, 3).result(), legacyRelatedPages(vectors))
  }
  const ties = [9, 2, 7, 3, 11].map(pageNumber => ({ pageNumber, vector: [1, 0] }))
  assert.deepEqual(calculate(ties).result(), legacyRelatedPages(ties))
  assert.deepEqual(calculate(ties).result()[0].relatedPages, [2, 7, 3])
  const threshold = [{ pageNumber: 1, vector: [1, 0] }, { pageNumber: 2, vector: [0.7, 0.5] },
    { pageNumber: 3, vector: [0.69999, 0.5] }]
  assert.deepEqual(calculate(threshold).result(), legacyRelatedPages(threshold))
  assert.deepEqual(calculate([{ pageNumber: 1, vector: null }]).result(), [])
  assert.deepEqual(calculate([]).result(), [])
})

test('legacy mismatched vector lengths retain directional results rather than gaining false related pages', () => {
  const vectors = [{ pageNumber: 1, vector: [1, 0] }, { pageNumber: 2, vector: [1, 0, 0.2] },
    { pageNumber: 3, vector: [0, 0] }]
  assert.deepEqual(calculate(vectors).result(), legacyRelatedPages(vectors))
  assert.equal(averageBookPageVector(page(1, [0, 0])), null)
})

test('1000 pages require 499500 comparisons and only retain three neighbors per page', () => {
  const calculation = calculate(Array.from({ length: 1000 }, (_, i) => ({ pageNumber: i + 1, vector: [1, 0] })))
  assert.equal(calculation.comparisons, 499500)
  assert.ok(calculation.result().every(page => page.relatedPages.length === 3))
})

test('worker results release the worker; stop terminates an in-flight worker immediately', async () => {
  const pages = [page(1, [1, 0]), page(2, [1, 0])]
  const worker = {
    onmessage: null, onerror: null, onmessageerror: null, terminated: 0,
    terminate() { this.terminated++ },
    postMessage(vectors: PageVector[]) { queueMicrotask(() => this.onmessage?.({ data: calculate(vectors).result() })) },
  }
  assert.deepEqual(await connectBookPages(pages, new AbortController().signal, () => worker as unknown as Worker),
    [{ pageNumber: 1, relatedPages: [2] }, { pageNumber: 2, relatedPages: [1] }])
  assert.equal(worker.terminated, 1); assert.equal(worker.onmessage, null)
  worker.terminated = 0; worker.postMessage = () => {}
  const controller = new AbortController()
  const pending = connectBookPages(pages, controller.signal, () => worker as unknown as Worker)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(worker.terminated, 1); assert.equal(worker.onmessage, null)
})

test('worker creation or message failure falls back to cancellable local chunks with the same result', async t => {
  t.mock.method(console, 'warn', () => {})
  const pages = [page(1, [1, 0]), page(2, [1, 0])]
  const expected = await connectBookPages(pages, new AbortController().signal, null)
  assert.deepEqual(await connectBookPages(pages, new AbortController().signal, () => { throw new Error('Unavailable') }), expected)
  let terminated = 0
  const worker = { onmessage: null, onerror: null, onmessageerror: null,
    terminate() { terminated++ }, postMessage() { queueMicrotask(() => this.onmessageerror?.()) } }
  assert.deepEqual(await connectBookPages(pages, new AbortController().signal, () => worker as unknown as Worker), expected)
  assert.equal(terminated, 1)
  const controller = new AbortController()
  const large = connectBookPages(Array.from({ length: 100 }, (_, i) => page(i + 1, [1, 0])), controller.signal, null)
  controller.abort()
  await assert.rejects(large, { name: 'AbortError' })
})

test('indexing reuses existing text/vectors, embeds only missing passages in batches of eight and throttles page snapshots', async () => {
  const saved = new Map<number, BookPageIndex>([[2, page(2, [1, 0])]])
  const read: number[] = [], batches: string[][] = [], updates: IndexProgress[] = []
  await buildBookIndex(18, new AbortController().signal, {
    loadPages: async () => [...saved.values()],
    readPage: async number => { read.push(number); const value = page(number); saved.set(number, value); return value },
    savePage: async value => { saved.set(value.pageNumber, value) },
    embedTexts: async texts => { batches.push(texts); return texts.map(() => [1, 0]) }, now: () => 10,
  }, update => updates.push(update))
  assert.deepEqual(batches.map(batch => batch.length), [8, 8, 1])
  assert.ok(!batches.flat().includes('page 2'))
  assert.equal(read.length, 17); assert.ok(!read.includes(2))
  assert.deepEqual(updates.map(update => update.phase), ['reading', 'embedding', 'connecting', 'complete'])
  assert.equal(updates.at(-1)!.progress, 18)
  assert.deepEqual(updates.at(-1)!.embeddingProgress, { done: 17, total: 17 })
  assert.deepEqual(updates.at(-1)!.pages.map(page => page.pageNumber), Array.from({ length: 18 }, (_, i) => i + 1))
  await buildBookIndex(18, new AbortController().signal, {
    loadPages: async () => [...saved.values()], readPage: async () => { throw new Error('Already read') },
    savePage: async () => {}, embedTexts: async () => { throw new Error('Already embedded') }, now: () => 10,
  }, () => {})
})

test('stopping an embedding batch saves its completed vectors for resume without starting another AI request', async () => {
  const saved = Array.from({ length: 12 }, (_, i) => page(i + 1)), controller = new AbortController()
  const writes: BookPageIndex[] = [], updates: IndexProgress[] = []
  let finish: (vectors: number[][]) => void, requested: string[][] = []
  const running = buildBookIndex(12, controller.signal, {
    loadPages: async () => saved, readPage: async () => { throw new Error('Already read') },
    savePage: async value => { writes.push(value) },
    embedTexts: texts => { requested.push(texts); return new Promise(resolve => { finish = resolve }) }, now: () => 10,
  }, update => updates.push(update))
  while (!requested.length) await Promise.resolve()
  controller.abort(); finish!(requested[0].map(() => [1, 0]))
  await assert.rejects(running, { name: 'AbortError' })
  assert.equal(requested.length, 1); assert.equal(writes.length, 8)
  assert.equal(updates.at(-1)!.phase, 'stopped')
  assert.equal(updates.at(-1)!.embeddingProgress.done, 8)
  assert.equal(saved.filter(page => page.passages[0].vector).length, 8)
})

test('an empty-text book finishes without any embedding request and failures preserve partial progress', async () => {
  const updates: IndexProgress[] = []
  await buildBookIndex(3, new AbortController().signal, {
    loadPages: async () => [], readPage: async number => ({ ...page(number), text: '', passages: [], source: 'empty' }),
    savePage: async () => {}, embedTexts: async () => { throw new Error('No AI OCR allowed') }, now: () => 10,
  }, update => updates.push(update))
  assert.equal(updates.at(-1)!.phase, 'complete')
  assert.equal(updates.at(-1)!.pages.length, 3)
  await assert.rejects(buildBookIndex(3, new AbortController().signal, {
    loadPages: async () => [], readPage: async number => { if (number === 2) throw new Error('Read failed'); return page(number) },
    savePage: async () => {}, embedTexts: async () => [], now: () => 10,
  }, update => updates.push(update)), /Read failed/)
  assert.equal(updates.at(-1)!.phase, 'stopped'); assert.equal(updates.at(-1)!.progress, 1)
})
