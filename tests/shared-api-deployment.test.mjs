import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scripts = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')).scripts
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')

for (const command of ['deploy:server', 'deploy:server:staging']) {
  test(`${command} stops before preparing or publishing the shared API`, (t) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'doridori-deploy-'))
    t.after(() => {
      if (path.dirname(fixture) !== path.resolve(tmpdir()) || !path.basename(fixture).startsWith('doridori-deploy-')) {
        throw new Error('Unexpected test directory')
      }
      rmSync(fixture, { recursive: true, force: true })
    })
    const fakeBin = path.join(fixture, 'bin')
    mkdirSync(fakeBin)
    mkdirSync(path.join(fixture, 'scripts'))
    mkdirSync(path.join(fixture, '.cloud-run'))
    writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts }))
    copyFileSync(path.join(appRoot, 'scripts/block-shared-api-deploy.mjs'),
      path.join(fixture, 'scripts/block-shared-api-deploy.mjs'))
    // Any regression to the old deployment command is contained in this fixture.
    writeFileSync(path.join(fixture, 'scripts/prepare-cloud-run.mjs'),
      "import { writeFileSync } from 'node:fs'; writeFileSync('prepared', 'called')\n")
    writeFileSync(path.join(fakeBin, 'gcloud.cmd'), '@echo called>"%DEPLOY_TEST_CALLED%"\r\n@exit /b 0\r\n')
    writeFileSync(path.join(fakeBin, 'gcloud'), '#!/bin/sh\nprintf called > "$DEPLOY_TEST_CALLED"\n', { mode: 0o755 })
    const existingBundle = path.join(fixture, '.cloud-run/sentinel')
    writeFileSync(existingBundle, 'existing upload')
    const env = { ...process.env, DEPLOY_TEST_CALLED: path.join(fixture, 'published') }
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH'
    env[pathKey] = `${fakeBin}${path.delimiter}${env[pathKey] || ''}`
    const result = spawnSync(process.execPath, [npmCli, 'run', command], {
      cwd: fixture, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.match(result.stdout + result.stderr, /TutoTuto\/repos\/tutotuto-app/)
    assert.match(result.stdout + result.stderr, /\/api\/ask-question/)
    assert.equal(existsSync(path.join(fixture, 'prepared')), false)
    assert.equal(existsSync(path.join(fixture, 'published')), false)
    assert.equal(readFileSync(existingBundle, 'utf8'), 'existing upload')
  })
}
