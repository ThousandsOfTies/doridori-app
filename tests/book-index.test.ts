import assert from 'node:assert/strict'
import test from 'node:test'
import { retrieveBookPassages, splitBookText, type BookPageIndex } from '../src/book/bookIndex'

function page(pageNumber: number, text: string, vector: number[], relatedPages: number[] = []): BookPageIndex {
  return {
    id: `book:${pageNumber}`, pdfId: 'book', pageNumber, text, source: 'pdf-text',
    passages: [{ start: 0, end: text.length, vector }], relatedPages, updatedAt: 1,
  }
}

test('text is split without losing characters', () => {
  const text = '長い文章。'.repeat(600)
  const ranges = splitBookText(text)
  assert.equal(ranges.map(range => text.slice(range.start, range.end)).join(''), text)
  assert.ok(ranges.every(range => range.end - range.start <= 1700))
})

test('semantic search finds another chapter and respects the reading boundary', () => {
  const pages = [
    page(1, '序章では音楽を紹介する。', [0, 1]),
    page(2, '主人公の転機について論じる。', [1, 0]),
    page(3, '転機の続きが明かされる。', [0.95, 0.05]),
  ]
  assert.equal(retrieveBookPassages(pages, '転機', [1, 0], 2, 2)[0].pageNumber, 2)
  assert.ok(retrieveBookPassages(pages, '転機', [1, 0], 2, 2).every(item => item.pageNumber <= 2))
  assert.equal(retrieveBookPassages(pages, '転機', [1, 0], 2, 3)[0].pageNumber, 2)
})

test('a related page is added without replacing direct results', () => {
  const pages = [
    page(1, '海の話', [1, 0], [3]),
    page(2, '山の話', [0.8, 0.2]),
    page(3, '港の話', [0.7, 0.3]),
  ]
  const results = retrieveBookPassages(pages, '海', [1, 0], 1, 3, 2)
  assert.deepEqual(results.map(item => item.pageNumber), [1, 2, 3])
})

test('the selected page stays in context and unrelated text is omitted without embeddings', () => {
  const pages = [
    page(1, '本の冒頭の説明。', [1, 0]),
    page(2, '現在のページの説明。', [0, 1]),
    page(3, '別章の説明。', [1, 0]),
  ]
  const results = retrieveBookPassages(pages, '固有名詞を教えて', null, 2, 3)
  assert.deepEqual(results.map(item => item.pageNumber), [2])
})
