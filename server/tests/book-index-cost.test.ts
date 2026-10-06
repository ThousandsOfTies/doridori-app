import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import express from 'express'
import type { GoogleGenAI } from '@google/genai'
import { registerBookKnowledgeRoutes } from '../src/bookKnowledgeRoutes'

async function api(t: TestContext, ai: GoogleGenAI) {
  const app = express()
  app.use(express.json())
  registerBookKnowledgeRoutes(app, ai, 'gemini-3.8-flash')
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/book`
  return (path: string, body: unknown) => fetch(`${base}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

test('legacy book OCR requests are refused before any billable AI operation', async t => {
  let calls = 0
  const fail = async () => { calls++; throw new Error('Must not charge for book OCR') }
  const post = await api(t, { models: { generateContent: fail, embedContent: fail } } as unknown as GoogleGenAI)
  for (const body of [{}, { imageData: 'data:image/png;base64,YQ==' },
    { imageData: `data:image/jpeg;base64,${'YQ=='.repeat(2000)}` }]) {
    const response = await post('ocr', body)
    assert.equal(response.status, 410)
    assert.match((await response.json()).error, /PDF24/)
  }
  assert.equal(calls, 0)
})

test('the index endpoint accepts only text and never invokes image generation or OCR', async t => {
  const embedded: any[] = []
  let generations = 0
  const ai = { models: {
    generateContent: async () => { generations++; throw new Error('Indexing must not use the chat model') },
    embedContent: async (request: unknown) => {
      embedded.push(request)
      return { embeddings: [{ values: Array(768).fill(0) }] }
    },
  } } as unknown as GoogleGenAI
  const post = await api(t, ai)
  for (const body of [{ imageData: 'data:image/png;base64,YQ==' }, { texts: [{ inlineData: { data: 'YQ==' } }] }]) {
    assert.equal((await post('embed', body)).status, 400)
  }
  assert.equal(embedded.length, 0)
  const texts = ['PDF24で認識した本文。', '別のページにある説明。']
  const response = await post('embed', { texts })
  assert.equal(response.status, 200)
  assert.deepEqual(embedded.map(request => request.contents), texts)
  assert.ok(embedded.every(request => request.model === 'gemini-embedding-2'))
  assert.equal((await response.json()).vectors.length, 2)
  assert.equal(generations, 0)
})

test('questions about a selected image still work without a full-book index', async t => {
  const generated: any[] = []
  const post = await api(t, { models: { generateContent: async (request: unknown) => {
    generated.push(request)
    return { text: '選択した画像についての説明です。' }
  } } } as unknown as GoogleGenAI)
  const response = await post('ask', {
    questionImageData: 'data:image/png;base64,YQ==', question: 'この図の意味は？',
    currentPage: 1, contexts: [], indexedPages: 0, totalPages: 100, includeLaterPages: false,
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).success, true)
  assert.equal(generated.length, 1)
  assert.equal(generated[0].contents[0].parts[0].inlineData.mimeType, 'image/png')
})
