import assert from 'node:assert/strict'
import test from 'node:test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { PDFBlobRangeTransport, getRangePDFDocument } from '../../home-teacher-common/src/utils/pdfRange'
import { retrieveBookPassages, splitBookText, type BookPageIndex } from '../src/book/bookIndex'
import { readBookPageText } from '../src/book/bookPageText'

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

test('image-only books are read without rendering pages or requesting AI OCR', async t => {
  const document = await PDFDocument.create()
  const image = await document.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cZ9sAAAAASUVORK5CYII=', 'base64'))
  const font = await document.embedFont(StandardFonts.Helvetica)
  for (let index = 0; index < 30; index++) {
    document.addPage([300, 400]).drawImage(image, { x: 0, y: 0, width: 300, height: 400 })
  }
  const ocrPage = document.addPage([300, 400])
  ocrPage.drawImage(image, { x: 0, y: 0, width: 300, height: 400 })
  ocrPage.drawText('Short OCR text', { font, size: 12, x: 10, y: 200, opacity: 0 })
  const bytes = await document.save()
  const blob = new Blob([bytes])
  const range = new PDFBlobRangeTransport(blob.size, (begin, end) => blob.slice(begin, end).arrayBuffer(), error => { throw error })
  const loading = getRangePDFDocument(range)
  let renders = 0, requests = 0
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('Indexing must not upload an image') })
  try {
    const pdf = await loading.promise
    for (let number = 1; number <= pdf.numPages; number++) {
      const pdfPage = await pdf.getPage(number)
      t.mock.method(pdfPage, 'render', () => { renders++; throw new Error('Indexing must not render an image') })
      const result = await readBookPageText('scanned-book', number, pdfPage)
      if (number <= 30) {
        assert.equal(result.text, '')
        assert.equal(result.source, 'empty')
        assert.deepEqual(result.passages, [])
      } else {
        assert.equal(result.text, 'Short OCR text')
        assert.equal(result.source, 'pdf-text')
        assert.equal(result.passages.length, 1)
      }
      assert.equal(result.pageNumber, number)
    }
    assert.equal(renders, 0)
    assert.equal(requests, 0)
  } finally {
    range.abort()
    await loading.destroy()
  }
})

test('text extraction errors do not fall back to paid OCR', async () => {
  const page = { getTextContent: async () => { throw new Error('Damaged PDF text') } }
  await assert.rejects(readBookPageText('damaged-book', 1, page), /Damaged PDF text/)
})
