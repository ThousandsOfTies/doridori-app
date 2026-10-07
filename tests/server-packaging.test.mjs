import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
const files = [
  'server/Dockerfile', 'server/package.json', 'server/package-lock.json', 'server/tsconfig.json',
  'server/src/index.ts', 'server/src/bookKnowledgeRoutes.ts', 'server/src/bookAgent.ts', 'server/src/bookReferenceMedia.ts', 'server/src/runtimePaths.ts',
  'shared/bookAgentProtocol.ts', 'shared/package.json',
]

function listFiles(root, relative = '') {
  return readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const name = relative ? `${relative}/${entry.name}` : entry.name
    return entry.isDirectory() ? listFiles(root, name) : [name]
  }).sort()
}

test('prepared Cloud Run sources exclude secrets and build independently', { timeout: 30_000 }, (t) => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'hometeacher-package-'))
  t.after(() => {
    assert.equal(path.dirname(fixture), path.resolve(tmpdir()))
    assert.ok(path.basename(fixture).startsWith('hometeacher-package-'))
    rmSync(fixture, { recursive: true, force: true })
  })
  const app = path.join(fixture, 'repos/app')
  mkdirSync(path.join(app, 'scripts'), { recursive: true })
  copyFileSync(path.join(appRoot, 'scripts/prepare-cloud-run.mjs'), path.join(app, 'scripts/prepare-cloud-run.mjs'))
  for (const file of files) {
    mkdirSync(path.dirname(path.join(app, file)), { recursive: true })
    copyFileSync(path.join(appRoot, file), path.join(app, file))
  }
  for (const file of ['src/constants/grading.ts', 'src/i18n/locales/ja.json', 'src/i18n/locales/en.json']) {
    const target = path.join(fixture, 'repos/home-teacher-common', file)
    mkdirSync(path.dirname(target), { recursive: true })
    copyFileSync(path.resolve(appRoot, '../home-teacher-common', file), target)
  }
  for (const file of ['.env', 'server/.env', 'server/credentials.json', 'server/tests/private.ts']) {
    mkdirSync(path.dirname(path.join(app, file)), { recursive: true })
    writeFileSync(path.join(app, file), 'must not be uploaded')
  }
  const prepared = spawnSync(process.execPath, [path.join(app, 'scripts/prepare-cloud-run.mjs')],
    { cwd: fixture, encoding: 'utf8', timeout: 10_000 })
  assert.ifError(prepared.error)
  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr)
  const output = path.join(app, '.cloud-run')
  assert.deepEqual(listFiles(output), [
    '.gcloudignore', 'Dockerfile', 'app/server/package-lock.json', 'app/server/package.json',
    'app/server/src/bookAgent.ts', 'app/server/src/bookKnowledgeRoutes.ts', 'app/server/src/bookReferenceMedia.ts', 'app/server/src/index.ts', 'app/server/src/runtimePaths.ts',
    'app/server/tsconfig.json', 'app/shared/bookAgentProtocol.ts', 'app/shared/package.json', 'home-teacher-common/src/constants/grading.ts',
    'home-teacher-common/src/i18n/locales/en.json', 'home-teacher-common/src/i18n/locales/ja.json',
  ])
  const preparedServer = path.join(output, 'app/server')
  symlinkSync(path.join(appRoot, 'server/node_modules'), path.join(preparedServer, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir')
  const built = spawnSync(process.execPath, [npmCli, 'run', 'build'],
    { cwd: preparedServer, encoding: 'utf8', timeout: 20_000 })
  assert.ifError(built.error)
  assert.equal(built.status, 0, built.stdout + built.stderr)
  assert.match(readFileSync(path.join(preparedServer, 'dist/index.js'), 'utf8'), /gemini-3\.8-flash/)
})
