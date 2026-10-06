import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const commonFile = path.resolve(serverRoot, '../../home-teacher-common/src/constants/grading.ts')

async function unusedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

for (const mode of ['source', 'compiled']) {
  test(`${mode} server starts independently and retains its API routes`, { timeout: 30_000 }, async (t) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'hometeacher-smoke-'))
    const isolatedServer = path.join(fixture, 'repos/app/server')
    mkdirSync(path.join(isolatedServer, 'src'), { recursive: true })
    mkdirSync(path.join(isolatedServer, 'dist'))
    const commonTarget = path.join(fixture, 'repos/home-teacher-common/src/constants')
    mkdirSync(commonTarget, { recursive: true })
    copyFileSync(commonFile, path.join(commonTarget, 'grading.ts'))
    copyFileSync(path.resolve(serverRoot, '../../home-teacher-common/package.json'),
      path.join(fixture, 'repos/home-teacher-common/package.json'))
    copyFileSync(path.join(serverRoot, 'package.json'), path.join(isolatedServer, 'package.json'))
    copyFileSync(path.join(serverRoot, 'tsconfig.json'), path.join(isolatedServer, 'tsconfig.json'))
    for (const name of ['index.ts', 'bookKnowledgeRoutes.ts', 'bookAgent.ts', 'bookReferenceMedia.ts', 'runtimePaths.ts']) {
      copyFileSync(path.join(serverRoot, 'src', name), path.join(isolatedServer, 'src', name))
    }
    mkdirSync(path.join(isolatedServer, '../shared'), { recursive: true })
    copyFileSync(path.join(serverRoot, '../shared/bookAgentProtocol.ts'), path.join(isolatedServer, '../shared/bookAgentProtocol.ts'))
    copyFileSync(path.join(serverRoot, '../shared/package.json'), path.join(isolatedServer, '../shared/package.json'))
    copyFileSync(path.join(serverRoot, 'dist/index.js'), path.join(isolatedServer, 'dist/index.js'))
    symlinkSync(path.join(serverRoot, 'node_modules'), path.join(isolatedServer, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir')
    const port = await unusedPort()
    writeFileSync(path.join(isolatedServer, '.env'),
      `PORT=${port}\nGEMINI_API_KEY=test-only-placeholder\nGEMINI_MODEL=gemini-layout-test\nSTRIPE_SECRET_KEY=sk_test_dummy\n`)
    const env = { ...process.env, FIREBASE_SERVICE_ACCOUNT: '', GOOGLE_APPLICATION_CREDENTIALS: '', NODE_ENV: 'test' }
    for (const name of ['PORT', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'STRIPE_SECRET_KEY']) delete env[name]
    // Use an isolated configuration and invalid requests so no AI or billing call is made.
    const child = spawn(process.execPath,
      mode === 'source' ? ['--import', 'tsx', 'src/index.ts'] : ['dist/index.js'],
      { cwd: isolatedServer, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    t.after(async () => {
      if (child.exitCode === null) {
        const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
        child.kill()
        await exited
      }
      assert.equal(path.dirname(fixture), path.resolve(tmpdir()))
      assert.ok(path.basename(fixture).startsWith('hometeacher-smoke-'))
      rmSync(fixture, { recursive: true, force: true })
    })
    const base = `http://127.0.0.1:${port}`
    let ready = false
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })
        if (response.ok) { ready = true; break }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(ready, output)
    const health = await (await fetch(`${base}/api/health`)).json()
    assert.deepEqual(health, { status: 'ok', model: 'gemini-layout-test' })
    const models = await (await fetch(`${base}/api/models`)).json()
    assert.equal(models.default, 'gemini-layout-test')
    assert.ok(models.models.some((model: { id: string }) => model.id === 'gemini-3.8-flash'))
    assert.equal((await fetch(`${base}/api/subjects`)).status, 200)
    for (const endpoint of ['/api/grade-work', '/api/book/embed',
      '/api/book/read-question', '/api/book/ask', '/api/book/ask-agent', '/api/book/reference-media']) {
      const response = await fetch(`${base}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      assert.equal(response.status, 400, endpoint)
      assert.equal(typeof (await response.json()).error, 'string')
    }
    const ocr = await fetch(`${base}/api/book/ocr`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageData: 'data:image/png;base64,YQ==' }),
    })
    assert.equal(ocr.status, 410)
    assert.match((await ocr.json()).error, /PDF24/)
    const tutor = await fetch(`${base}/api/ask-question`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    assert.equal(tutor.status, 404)
    for (const endpoint of ['/api/create-checkout-session', '/api/create-portal-session', '/api/update-sns-time']) {
      const response = await fetch(`${base}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      assert.equal(response.status, 401, endpoint)
    }
  })
}
