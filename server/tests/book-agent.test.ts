import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import express from 'express'
import type { GoogleGenAI } from '@google/genai'
import { registerBookAgentRoute } from '../src/bookAgent'

const body = { questionImageData: 'data:image/png;base64,YQ==', question: 'なぜ制度ができた？',
  currentPage: 6, indexedPages: 4, totalPages: 20, includeLaterPages: false,
  clientCapabilities: ['search_book', 'read_book_pages'] }
const call = (name = 'search_book', args: object = { query: '制度 成立 背景', reason: '本文を確認' }) => ({
  candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'call-1', name, args }, thoughtSignature: 'opaque-signature' }] } }],
})

async function api(t: TestContext, generate: (request: any) => Promise<any>, secret = 'test-only-shared-key') {
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  registerBookAgentRoute(app, { models: { generateContent: generate } } as unknown as GoogleGenAI, 'gemini-3.8-flash', secret)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  return (data: object) => fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/book/ask-agent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
}

test('real Gemini function requests cross browser turns and preserve thought signatures across server instances', async t => {
  const requests: any[] = []
  const post = await api(t, async request => { requests.push(request); return call() })
  const first = await post(body)
  assert.equal(first.status, 200)
  const step = await first.json()
  assert.equal(step.status, 'needs-context')
  assert.equal(step.requests[0].query, '制度 成立 背景')
  assert.equal(requests[0].config.toolConfig.functionCallingConfig.mode, 'AUTO')
  assert.ok(requests[0].config.tools[0].functionDeclarations.some(tool => tool.name === 'read_book_pages'))
  assert.equal(step.continuation.includes('opaque-signature'), false)
  const otherInstance = await api(t, async request => {
    requests.push(request)
    return { text: '成立の背景です【PDF p.3】。引用できないページ【PDF p.19】。' }
  })
  const final = await otherInstance({ ...body, continuation: step.continuation,
    toolResults: [{ id: step.requests[0].id, indexedPages: 4, contexts: [{ pageNumber: 3, text: '制度成立の原文。' }] }] })
  assert.equal(final.status, 200)
  const answer = await final.json()
  assert.equal(answer.status, 'answered')
  assert.deepEqual(answer.result.referencePages, [3])
  assert.equal(answer.result.overallComment.includes('p.19'), false)
  assert.deepEqual(requests[1].contents[1], call().candidates[0].content)
  const response = requests[1].contents[2].parts[0].functionResponse
  assert.equal(response.name, 'search_book')
  assert.equal(response.id, 'call-1')
  assert.deepEqual(response.response.contexts, [{ pageNumber: 3, text: '制度成立の原文。' }])
})

test('the third AI generation must answer with tools disabled after two context rounds', async t => {
  const requests: any[] = []
  const post = await api(t, async request => {
    requests.push(request)
    return requests.length < 3 ? call('read_book_pages', { pageNumbers: [3], reason: '原文を確認' }) : { text: '確認できた本文をもとに回答します【PDF p.3】。' }
  })
  let turn: any = body
  for (let round = 1; round <= 2; round++) {
    const step = await (await post(turn)).json()
    assert.equal(step.round, round)
    turn = { ...body, continuation: step.continuation,
      toolResults: [{ id: step.requests[0].id, contexts: [{ pageNumber: 3, text: '本文' }], indexedPages: 4 }] }
  }
  const answer = await (await post(turn)).json()
  assert.equal(answer.status, 'answered')
  assert.equal(requests.length, 3)
  assert.equal(requests[2].config.toolConfig.functionCallingConfig.mode, 'NONE')
})

test('tampered continuations, changed questions and unauthorized book results are rejected before another AI call', async t => {
  let generations = 0
  const post = await api(t, async () => { generations++; return call('read_book_pages', { pageNumbers: [3], reason: '確認' }) })
  const step = await (await post(body)).json()
  const good = { ...body, continuation: step.continuation,
    toolResults: [{ id: step.requests[0].id, contexts: [{ pageNumber: 3, text: '本文' }], indexedPages: 4 }] }
  for (const bad of [
    { ...good, continuation: step.continuation.slice(0, -10) + 'aaaaaaaaaa' },
    { ...good, question: '別の質問' },
    { ...good, includeLaterPages: true },
    { ...good, toolResults: [{ id: step.requests[0].id, contexts: [{ pageNumber: 7, text: '先のページ' }], indexedPages: 4 }] },
    { ...good, toolResults: [{ id: step.requests[0].id, contexts: [{ pageNumber: 4, text: '指定していないページ' }], indexedPages: 4 }] },
    { ...good, toolResults: [{ id: step.requests[0].id, contexts: [{ pageNumber: 3, text: '本文'.repeat(2000) }], indexedPages: 4 }] },
    { ...good, toolResults: [] },
  ]) assert.equal((await post(bad)).status, 400)
  assert.equal(generations, 1)
})

test('expired continuations and excessive or unknown model tools cannot trigger unbounded AI calls', async t => {
  let generations = 0
  const post = await api(t, async () => { generations++; return call() })
  const step = await (await post(body)).json()
  const realNow = Date.now
  t.mock.method(Date, 'now', () => realNow() + 11 * 60_000)
  assert.equal((await post({ ...body, continuation: step.continuation,
    toolResults: [{ id: step.requests[0].id, contexts: [], indexedPages: 4 }] })).status, 400)
  assert.equal(generations, 1)
  const unsupported = await api(t, async () => call('upload_pdf'))
  assert.equal((await unsupported(body)).status, 502)
  const many = await api(t, async () => {
    const response = call()
    response.candidates[0].content.parts = Array.from({ length: 3 }, (_, index) => ({
      ...call().candidates[0].content.parts[0], functionCall: { ...call().candidates[0].content.parts[0].functionCall, id: `call-${index}` },
    }))
    return response
  })
  assert.equal((await many(body)).status, 502)
})

test('empty results reach the AI as missing evidence, while invalid initial requests never invoke AI', async t => {
  let generations = 0
  const post = await api(t, async request => {
    if (generations++ === 0) return call('read_book_pages', { pageNumbers: [3], reason: '確認' })
    assert.deepEqual(request.contents[2].parts[0].functionResponse.response.contexts, [])
    return { text: 'このPDFページには文字情報がなく、本文を確認できません。' }
  })
  for (const bad of [{}, { ...body, contexts: [] }, { ...body, currentPage: 21 },
    { ...body, clientCapabilities: ['upload_pdf'] }]) assert.equal((await post(bad)).status, 400)
  assert.equal(generations, 0)
  const step = await (await post(body)).json()
  const final = await post({ ...body, continuation: step.continuation,
    toolResults: [{ id: step.requests[0].id, contexts: [], indexedPages: 4, missingPages: [3], error: '文字情報がありません' }] })
  assert.equal((await final.json()).status, 'answered')
  assert.equal(generations, 2)
})
