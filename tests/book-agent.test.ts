import assert from 'node:assert/strict'
import test from 'node:test'
import { runBookAgent } from '../src/book/bookAgent'
import { resolveBookContext } from '../src/book/bookContextTools'
import type { BookAgentQuestion, BookAgentStep, BookAgentTurn, BookContextRequest } from '../shared/bookAgentProtocol'
import type { BookPageIndex } from '../src/book/bookIndex'

const question: BookAgentQuestion = {
  questionImageData: 'data:image/png;base64,YQ==', question: 'この制度ができた理由は？',
  currentPage: 6, totalPages: 20, indexedPages: 6, includeLaterPages: false,
  clientCapabilities: ['search_book', 'read_book_pages'],
}
const search: BookContextRequest = { id: 'search-1', name: 'search_book', query: '制度 成立 背景', reason: '本文の根拠を確認する' }
const read: BookContextRequest = { id: 'read-1', name: 'read_book_pages', pageNumbers: [3], reason: '成立の経緯を詳しく読む' }
const page = (pageNumber: number, text: string): BookPageIndex => ({
  id: `book:${pageNumber}`, pdfId: 'book', pageNumber, text, source: text ? 'pdf-text' : 'empty',
  passages: [], updatedAt: 0,
})
const answer: BookAgentStep = { status: 'answered', success: true, modelName: 'test', responseTime: 1,
  result: { pageType: 'book-question', problems: [], overallComment: '本文に基づく説明【PDF p.3】', referencePages: [3] } }

test('the AI requests context before any browser search, then reads a requested page and answers', async () => {
  const turns: BookAgentTurn[] = []
  const resolved: BookContextRequest[] = []
  const phases: string[] = []
  const steps: BookAgentStep[] = [
    { status: 'needs-context', continuation: 'token-1', requests: [search], round: 1, maxRounds: 2, modelName: 'test' },
    { status: 'needs-context', continuation: 'token-2', requests: [read], round: 2, maxRounds: 2, modelName: 'test' },
    answer,
  ]
  const result = await runBookAgent(question, async body => {
    if (!turns.length) assert.equal(resolved.length, 0)
    turns.push(body)
    return steps.shift()!
  }, async request => {
    resolved.push(request)
    return { id: request.id, contexts: [{ pageNumber: 3, text: '制度成立の経緯。' }], indexedPages: 6 }
  }, progress => phases.push(progress.phase))
  assert.equal(turns.length, 3)
  assert.equal('contexts' in turns[0], false)
  assert.equal('toolResults' in turns[0], false)
  assert.deepEqual(turns[0].clientCapabilities, ['search_book', 'read_book_pages'])
  assert.equal(turns[1].continuation, 'token-1')
  assert.equal(turns[2].continuation, 'token-2')
  assert.deepEqual(resolved, [search, read])
  assert.deepEqual(phases, ['asking', 'searching', 'asking', 'searching', 'asking'])
  assert.deepEqual(result.result.contextRequests?.map(entry => entry.request.name), ['search_book', 'read_book_pages'])
})

test('tool failure returns a bounded error to the AI instead of sending book images or aborting the answer', async () => {
  let turns = 0
  const result = await runBookAgent(question, async body => {
    if (turns++) {
      assert.deepEqual(body.toolResults?.[0].contexts, [])
      assert.match(body.toolResults![0].error!, /Damaged PDF/)
      return answer
    }
    return { status: 'needs-context', continuation: 'token', requests: [read], round: 1, maxRounds: 2, modelName: 'test' }
  }, async () => { throw new Error('Damaged PDF') })
  assert.equal(result.status, 'answered')
  assert.equal(result.result.contextRequests?.[0].result.contexts.length, 0)
})

test('client refuses unsupported, duplicated and excessive AI tool requests before executing them', async () => {
  for (const requests of [[{ ...search, name: 'upload_whole_pdf' }], [search, search], [search, read, { ...read, id: 'third' }]]) {
    let calls = 0
    await assert.rejects(runBookAgent(question, async () => ({ status: 'needs-context', continuation: 'token', requests,
      round: 1, maxRounds: 2, modelName: 'test' } as BookAgentStep), async () => {
      calls++; return { id: 'never', contexts: [], indexedPages: 0 }
    }), /正しくない/)
    assert.equal(calls, 0)
  }
  let turns = 0
  await assert.rejects(runBookAgent(question, async () => ({ status: 'needs-context', continuation: 'token', requests: [search],
    round: ++turns, maxRounds: 2, modelName: 'test' }), async request => ({ id: request.id, contexts: [], indexedPages: 0 })), /上限/)
  assert.equal(turns, 3)
})

test('requested page reads enforce the reading boundary and limit text without network or image OCR', async () => {
  const reads: number[] = []
  const result = await resolveBookContext({ ...read, pageNumbers: [3, 7, 4] }, {
    currentPage: 6, totalPages: 20, includeLaterPages: false,
    search: async () => { throw new Error('Must not search when reading specified pages') },
    readPage: async number => { reads.push(number); return page(number, number === 3 ? '本文'.repeat(2000) : '') },
    indexedPages: () => 7,
  })
  assert.deepEqual(reads, [3, 4])
  assert.equal(result.contexts.length, 1)
  assert.equal(result.contexts[0].text.length, 2400)
  assert.equal(result.contexts[0].truncated, true)
  assert.deepEqual(result.missingPages, [4])
  assert.match(result.error!, /参照を許可/)
  assert.match(result.error!, /画像OCRは行いません/)
})

test('future-page permission allows only existing PDF pages and search sends at most three passages', async () => {
  const reads: number[] = []
  const tools = {
    currentPage: 6, totalPages: 20, includeLaterPages: true,
    search: async () => ({ passages: Array.from({ length: 9 }, (_, index) => ({ pageNumber: index + 1,
      text: '関連本文'.repeat(1000), score: 1 })), indexedPages: 10 }),
    readPage: async (number: number) => { reads.push(number); return page(number, '先のページの本文') },
    indexedPages: () => 11,
  }
  const result = await resolveBookContext({ ...read, pageNumbers: [7, 21] }, tools)
  assert.deepEqual(reads, [7])
  assert.deepEqual(result.contexts.map(context => context.pageNumber), [7])
  const found = await resolveBookContext(search, tools)
  assert.equal(found.contexts.length, 3)
  assert.ok(found.contexts.every(context => context.text.length === 2400))
})
