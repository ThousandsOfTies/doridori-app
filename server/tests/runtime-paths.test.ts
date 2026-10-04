import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { getServerPaths, loadServerEnvironment, resolveConfigFile } from '../src/runtimePaths.ts'

function fixture(t: test.TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'hometeacher-paths-'))
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()))
    assert.ok(path.basename(root).startsWith('hometeacher-paths-'))
    rmSync(root, { recursive: true, force: true })
  })
  const serverRoot = path.join(root, 'app/server')
  mkdirSync(path.join(serverRoot, 'src'), { recursive: true })
  return { root, serverRoot, appRoot: path.dirname(serverRoot),
    moduleUrl: pathToFileURL(path.join(serverRoot, 'src/index.ts')).href }
}

test('source and compiled entry points resolve the same server and app roots', (t) => {
  const item = fixture(t)
  for (const entry of ['src/index.ts', 'dist/index.js']) {
    assert.deepEqual(getServerPaths(pathToFileURL(path.join(item.serverRoot, entry)).href),
      { serverRoot: item.serverRoot, appRoot: item.appRoot })
  }
})

test('deployed variables win, then server/.env, then the legacy app/.env', (t) => {
  const item = fixture(t)
  writeFileSync(path.join(item.serverRoot, '.env'), 'EXISTING=server\nSHARED=server\n')
  writeFileSync(path.join(item.appRoot, '.env'), 'EXISTING=legacy\nSHARED=legacy\nLEGACY=kept\n')
  const env: NodeJS.ProcessEnv = { EXISTING: 'deployed' }
  loadServerEnvironment(item.moduleUrl, env)
  assert.deepEqual(env, { EXISTING: 'deployed', SHARED: 'server', LEGACY: 'kept' })
})

test('an existing app/.env still works without creating server/.env', (t) => {
  const item = fixture(t)
  writeFileSync(path.join(item.appRoot, '.env'), 'LEGACY=kept\n')
  const env: NodeJS.ProcessEnv = {}
  loadServerEnvironment(item.moduleUrl, env)
  assert.equal(env.LEGACY, 'kept')
})

test('Cloud Run can start without local environment files', (t) => {
  const item = fixture(t)
  const env: NodeJS.ProcessEnv = { GEMINI_API_KEY: 'injected' }
  loadServerEnvironment(item.moduleUrl, env)
  assert.deepEqual(env, { GEMINI_API_KEY: 'injected' })
})

test('credential paths support server-relative, legacy-relative and absolute files', (t) => {
  const item = fixture(t)
  const paths = getServerPaths(item.moduleUrl)
  const legacy = path.join(item.appRoot, 'credentials.json')
  const current = path.join(item.serverRoot, 'credentials.json')
  writeFileSync(legacy, '{}')
  assert.equal(resolveConfigFile('credentials.json', paths), legacy)
  writeFileSync(current, '{}')
  assert.equal(resolveConfigFile('credentials.json', paths), current)
  assert.equal(resolveConfigFile(legacy, paths), legacy)
})
