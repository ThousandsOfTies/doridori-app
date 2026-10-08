import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import * as browser from '../shared/bookAgentProtocol.ts'
import * as api from '../../home-teacher-api/contracts/bookAgentProtocol.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'))
function fixture(t: test.TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'shared-api-app-'))
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()))
    assert.ok(path.basename(root).startsWith('shared-api-app-'))
    rmSync(root, { recursive: true, force: true })
  })
  const app = path.join(root, 'repos/app')
  const shared = path.join(root, 'repos/home-teacher-api')
  mkdirSync(path.join(app, 'scripts'), { recursive: true })
  mkdirSync(shared, { recursive: true })
  writeFileSync(path.join(shared, 'package.json'), '{"private":true}')
  return { root, app, shared }
}

test('browser and server share the exact same protocol limits and validators', () => {
  assert.equal(browser.BOOK_AGENT_LIMITS, api.BOOK_AGENT_LIMITS)
  assert.equal(browser.isBookContextRequest, api.isBookContextRequest)
  assert.equal(browser.BOOK_AGENT_LIMITS.rounds, 2)
})

test('app commands launch the sibling API from any working directory and pass legacy settings only in development', t => {
  const item = fixture(t)
  copyFileSync(path.join(appRoot, 'scripts/run-shared-api.mjs'), path.join(item.app, 'scripts/run-shared-api.mjs'))
  const fakeNpm = path.join(item.root, 'fake npm.cjs')
  writeFileSync(fakeNpm, 'console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),legacy:process.env.HOME_TEACHER_LEGACY_APP_ROOT||null}))')
  for (const command of ['dev', 'build', 'test', 'prepare:deploy']) {
    const result = spawnSync(process.execPath, [path.join(item.app, 'scripts/run-shared-api.mjs'), command], {
      cwd: item.root, env: { ...process.env, npm_execpath: fakeNpm, HOME_TEACHER_LEGACY_APP_ROOT: 'must-be-cleared' }, encoding: 'utf8', timeout: 10000,
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const called = JSON.parse(result.stdout)
    assert.equal(called.cwd, item.shared)
    assert.deepEqual(called.args, ['run', command])
    assert.equal(called.legacy, command === 'dev' ? item.app : null)
  }
})

for (const command of ['deploy:server', 'deploy:server:staging']) {
  test(command + ' stops with the central deployment instructions and makes no cloud call', t => {
    const item = fixture(t)
    writeFileSync(path.join(item.app, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: manifest.scripts }))
    copyFileSync(path.join(appRoot, 'scripts/block-shared-api-deploy.mjs'), path.join(item.app, 'scripts/block-shared-api-deploy.mjs'))
    const bin = path.join(item.root, 'bin')
    const sentinel = path.join(item.root, 'published')
    mkdirSync(bin)
    writeFileSync(path.join(bin, 'gcloud.cmd'), '@echo called>"%DEPLOY_TEST_CALLED%"\r\n@exit /b 0\r\n')
    writeFileSync(path.join(bin, 'gcloud'), '#!/bin/sh\nprintf called > "$DEPLOY_TEST_CALLED"\n', { mode: 0o755 })
    const env = { ...process.env, DEPLOY_TEST_CALLED: sentinel }
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH'
    env[pathKey] = bin + path.delimiter + (env[pathKey] || '')
    const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    const result = spawnSync(process.execPath, [npmCli, 'run', command], { cwd: item.app, env, encoding: 'utf8', timeout: 20000 })
    assert.ifError(result.error)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.ok((result.stdout + result.stderr).includes('home-teacher-api/DEPLOYMENT.md'))
    assert.equal(existsSync(sentinel), false)
    assert.equal(existsSync(path.join(item.app, '.cloud-run')), false)
  })
}
