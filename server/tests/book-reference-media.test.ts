import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import type { GoogleGenAI } from '@google/genai'
import { commonsCandidates, findBookReferenceMedia, registerBookReferenceMediaRoute } from '../src/bookReferenceMedia'
import { registerBookKnowledgeRoutes } from '../src/bookKnowledgeRoutes'

function page(id = 101, overrides: Record<string, unknown> = {}) {
  return { pageid: id, title: 'File:Supply and demand.svg', imageinfo: [{
    thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Supply.svg/1280px-Supply.svg.png?utm_source=commons',
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Supply_and_demand.svg',
    mime: 'image/svg+xml', thumbwidth: 1280, thumbheight: 900,
    extmetadata: {
      ImageDescription: { value: '<p>A supply and demand graph &amp; equilibrium.</p>' },
      Artist: { value: '<a href="https://example.org">Alice &amp; Bob</a>' },
      Attribution: { value: 'Alice and Bob, original diagram' },
      LicenseShortName: { value: 'CC BY-SA 4.0' },
      LicenseUrl: { value: 'http://creativecommons.org/licenses/by-sa/4.0/' },
    }, ...overrides,
  }] }
}
const dataset = (pages = [page()]) => ({ query: { pages } })

function fakeAi(responses: unknown[], requests: any[] = []) {
  return { models: { generateContent: async (request: unknown) => {
    requests.push(request)
    const response = responses.shift()
    if (response instanceof Error) throw response
    return { text: typeof response === 'string' ? response : JSON.stringify(response) }
  } } } as unknown as GoogleGenAI
}

function commonsResponse(url: string | URL | Request) {
  return new URL(String(url)).hostname === 'commons.wikimedia.org'
    ? new Response(JSON.stringify(dataset()))
    : new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cZ9sAAAAASUVORK5CYII=', 'base64'),
      { headers: { 'Content-Type': 'image/png' } })
}

test('Commons metadata retains attribution and only returns safe, reusable image URLs', () => {
  const [candidate] = commonsCandidates(dataset())
  assert.equal(candidate.author, 'Alice & Bob')
  assert.equal(candidate.description, 'A supply and demand graph & equilibrium.')
  assert.equal(candidate.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/')
  assert.ok(!candidate.imageUrl.includes('?'))
  assert.equal(candidate.attribution, 'Alice and Bob, original diagram')
  assert.deepEqual(commonsCandidates({ query: { pages: {} } }), [])
  for (const overrides of [
    { thumburl: 'http://thumb.wikimedia.org/wikipedia/commons/a.png' },
    { thumburl: 'https://thumb.wikimedia.org.evil.example/wikipedia/commons/a.png' },
    { thumburl: 'https://localhost/wikipedia/commons/a.png' },
    { thumburl: 'https://user:password@upload.wikimedia.org/wikipedia/commons/a.png' },
    { thumburl: 'https://upload.wikimedia.org:444/wikipedia/commons/a.png' },
    { descriptionurl: 'javascript:alert(1)' },
    { mime: 'text/html' },
    { thumbwidth: 0 },
    { extmetadata: {} },
  ]) assert.deepEqual(commonsCandidates(dataset([page(101, overrides)])), [], JSON.stringify(overrides))
})

test('licensed files with missing credit are excluded; public-domain works can have no named artist', () => {
  const original = page().imageinfo[0].extmetadata as any
  assert.equal(commonsCandidates(dataset([page(102, { extmetadata: { ...original, Artist: undefined, Attribution: undefined } })])).length, 0)
  assert.equal(commonsCandidates(dataset([page(102, { extmetadata: { ...original, LicenseUrl: { value: 'https://evil.example/license' } } })])).length, 0)
  assert.equal(commonsCandidates(dataset([page(102, { extmetadata: { LicenseShortName: { value: 'Public domain' } } })])).length, 1)
  assert.equal(commonsCandidates(dataset([page(102, { extmetadata: { ...original, LicenseShortName: { value: 'All rights reserved' } } })])).length, 0)
})

test('reference selection uses real candidate IDs, deduplicates them and never accepts invented URLs', async () => {
  const requests: any[] = [], urls: URL[] = []
  const ai = fakeAi([{ queries: ['unit supply demand diagram'] }, { items: [
    { id: 'invented', title: '偽の図', caption: '存在しない図', imageUrl: 'https://evil.example/a.png' },
    { id: '101', title: '需要と供給', caption: '2本の線の交点に注目します。', imageUrl: 'https://evil.example/a.png' },
    { id: '101', title: '重複', caption: '同じ図' },
  ] }], requests)
  const result = await findBookReferenceMedia(ai, 'gemini-3.8-flash', '需要と供給とは？', '交点で均衡します。',
    (async (url, init) => {
      urls.push(new URL(String(url)))
      assert.equal(init?.redirect, 'error')
      assert.ok(init?.signal)
      assert.match((init?.headers as Record<string, string>)['User-Agent'], /DoriDori/)
      return commonsResponse(url)
    }) as typeof fetch)
  assert.equal(result.status, 'ready')
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].title, '需要と供給')
  assert.match(result.items[0].imageUrl, /^https:\/\/thumb.wikimedia.org\//)
  assert.ok(!('description' in result.items[0]))
  assert.equal(urls[0].hostname, 'commons.wikimedia.org')
  assert.equal(urls[0].searchParams.get('gsrnamespace'), '6')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].config.responseMimeType, 'application/json')
  assert.ok(requests[1].contents[0].parts.some((part: any) => part.inlineData?.mimeType === 'image/png'))
})

test('no useful visual topic avoids both search and selection calls', async () => {
  const requests: any[] = []
  const result = await findBookReferenceMedia(fakeAi([{ queries: [] }], requests), 'gemini-3.8-flash', '', '抽象的な議論です。',
    (async () => { throw new Error('Must not fetch') }) as typeof fetch)
  assert.deepEqual(result, { status: 'empty', items: [] })
  assert.equal(requests.length, 1)
})

test('irrelevant search results can be rejected entirely', async () => {
  const result = await findBookReferenceMedia(fakeAi([{ queries: ['unit unrelated graph'] }, { items: [] }]),
    'gemini-3.8-flash', '質問', '回答', (async url => commonsResponse(url)) as typeof fetch)
  assert.deepEqual(result, { status: 'empty', items: [] })
})

test('partial search failures preserve valid candidates; complete failures remain retryable', async () => {
  const result = await findBookReferenceMedia(fakeAi([{ queries: ['unit failed topic', 'unit useful topic'] },
    { items: [{ id: '101', title: '参考図', caption: '図で確認します。' }] }]), 'gemini-3.8-flash', '質問', '回答',
    (async url => {
      if (new URL(String(url)).searchParams.get('gsrsearch')?.includes('failed')) throw new Error('Timeout')
      return commonsResponse(url)
    }) as typeof fetch)
  assert.equal(result.status, 'ready')
  const unavailable = await findBookReferenceMedia(fakeAi([{ queries: ['unit all failed'] }]), 'gemini-3.8-flash', '', '回答',
    (async () => new Response('{}', { status: 503 })) as typeof fetch)
  assert.deepEqual(unavailable, { status: 'unavailable', items: [] })
})

test('Commons results are cached without retaining readers questions or answers', async () => {
  let fetches = 0
  const fetcher = (async url => { if (new URL(String(url)).hostname === 'commons.wikimedia.org') fetches++; return commonsResponse(url) }) as typeof fetch
  for (const question of ['最初の質問', '別の質問']) {
    await findBookReferenceMedia(fakeAi([{ queries: ['unit cached topic'] }, { items: [] }]), 'gemini-3.8-flash', question, '回答', fetcher)
  }
  assert.equal(fetches, 1)
})

test('images that cannot be fetched are never presented as verified reference figures', async () => {
  const requests: any[] = []
  const result = await findBookReferenceMedia(fakeAi([{ queries: ['unit unavailable image'] }], requests),
    'gemini-3.8-flash', '質問', '回答', (async url => new URL(String(url)).hostname === 'commons.wikimedia.org'
      ? new Response(JSON.stringify(dataset([page(193)]))) : new Response('Unavailable', { status: 503 })) as typeof fetch)
  assert.deepEqual(result, { status: 'unavailable', items: [] })
  assert.equal(requests.length, 1)
})

test('media endpoint validates inputs and reports supplementary AI failure without failing the answer', async t => {
  const app = express()
  app.use(express.json())
  const requests: any[] = []
  registerBookReferenceMediaRoute(app, fakeAi([new Error('Offline')], requests), 'gemini-3.8-flash')
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/book/reference-media`
  for (const body of [{}, { question: '', answer: '' }, { question: 'x'.repeat(1001), answer: '回答' }, { question: '', answer: 'x'.repeat(16001) }]) {
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 400)
  }
  assert.equal(requests.length, 0)
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: '', answer: '既に表示済みの回答' }) })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'unavailable', items: [] })
})

test('book answers remain Markdown with the original PDF citation and spoiler restrictions', async t => {
  const app = express()
  app.use(express.json())
  const requests: any[] = []
  registerBookKnowledgeRoutes(app, fakeAi(['**回答**【PDF p.2】【PDF p.8】'], requests), 'gemini-3.8-flash')
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/book/ask`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      questionImageData: 'data:image/png;base64,YQ==', question: '質問', currentPage: 2,
      contexts: [{ pageNumber: 2, text: '今のページ' }, { pageNumber: 8, text: '先の展開' }], includeLaterPages: false,
    }),
  })
  const data = await response.json()
  assert.equal(response.status, 200)
  assert.equal(data.result.overallComment, '**回答**【PDF p.2】')
  assert.deepEqual(data.result.referencePages, [2])
  assert.equal(requests.length, 1)
  assert.ok(!requests[0].config.responseMimeType)
  assert.ok(!requests[0].contents[0].parts[1].text.includes('【PDF p.8】'))
})
