import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectPDFText } from '@home-teacher/common/utils/pdfTextInspection'

function document(items: Array<Array<{ str?: string }> | Error>) {
  const read: number[] = [], cleaned: number[] = []
  return { read, cleaned, pdf: { numPages: items.length, getPage: async (number: number) => {
    read.push(number)
    return { getTextContent: async () => {
      const page = items[number - 1]
      if (page instanceof Error) throw page
      return { items: page }
    }, cleanup: () => { cleaned.push(number) } }
  } } }
}

test('a text-free cover does not hide text on a later page, and detection stops at the first text', async () => {
  const fixture = document([[], [{ str: ' \t\n' }], [{ str: '本文の文字' }], [{ str: '読む必要はないページ' }]])
  const progress: number[] = []
  const result = await inspectPDFText(fixture.pdf as any, value => { progress.push(value.checkedPages) })
  assert.deepEqual(result, { status: 'present', checkedPages: 3, totalPages: 4 })
  assert.deepEqual(fixture.read, [1, 2, 3])
  assert.deepEqual(fixture.cleaned, [1, 2, 3])
  assert.deepEqual(progress, [0, 1, 2, 3])
  assert.equal(JSON.stringify(result).includes('本文の文字'), false)
})

test('absence requires successful reading of every page; marked content and whitespace are not text', async () => {
  const fixture = document([[], [{}], [{ str: '\n \t' }]])
  assert.deepEqual(await inspectPDFText(fixture.pdf as any), { status: 'absent', checkedPages: 3, totalPages: 3 })
  assert.deepEqual(fixture.read, [1, 2, 3])
})

test('unreadable pages produce unknown rather than a false no-text result', async () => {
  const fixture = document([[], new Error('page read failed'), []])
  assert.equal((await inspectPDFText(fixture.pdf as any)).status, 'unknown')
  assert.deepEqual(fixture.read, [1, 2, 3])
  assert.equal((await inspectPDFText({ numPages: 0, getPage: async () => { throw new Error('no page') } })).status, 'unknown')
  const laterText = document([new Error('first page unavailable'), [{ str: 'Readable later text' }]])
  assert.equal((await inspectPDFText(laterText.pdf as any)).status, 'present')
})
