import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = path.resolve(appRoot, '../home-teacher-api')
const command = process.argv[2]
if (!['dev', 'build', 'test', 'prepare:deploy'].includes(command)) throw new Error('Unsupported API command')
if (!existsSync(path.join(apiRoot, 'package.json'))) {
  throw new Error('Initialize the home-teacher-api submodule from the meta repository, then run npm ci in it')
}
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
const env = { ...process.env }
delete env.HOME_TEACHER_LEGACY_APP_ROOT
if (command === 'dev') env.HOME_TEACHER_LEGACY_APP_ROOT = appRoot
const result = spawnSync(process.execPath, [npmCli, 'run', command],
  { cwd: apiRoot, env, stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
process.exit(result.status ?? 1)
