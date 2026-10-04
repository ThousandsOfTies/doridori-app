import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(appRoot, '.cloud-run')
// Explicit allowlist: never upload local .env files, credentials, or frontend assets.
const files = [
  ['server/Dockerfile', 'Dockerfile'],
  ['server/package.json', 'app/server/package.json'],
  ['server/package-lock.json', 'app/server/package-lock.json'],
  ['server/tsconfig.json', 'app/server/tsconfig.json'],
  ['server/src/index.ts', 'app/server/src/index.ts'],
  ['server/src/bookKnowledgeRoutes.ts', 'app/server/src/bookKnowledgeRoutes.ts'],
  ['server/src/bookReferenceMedia.ts', 'app/server/src/bookReferenceMedia.ts'],
  ['server/src/runtimePaths.ts', 'app/server/src/runtimePaths.ts'],
  ['../home-teacher-common/src/constants/grading.ts', 'home-teacher-common/src/constants/grading.ts'],
]

// Read all inputs first so an incomplete checkout fails before replacing the bundle.
const inputs = files.map(([source, target]) => [target, readFileSync(path.resolve(appRoot, source))])
if (path.dirname(output) !== appRoot || path.basename(output) !== '.cloud-run') {
  throw new Error('Invalid deployment output directory')
}
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })
for (const [target, contents] of inputs) {
  const destination = path.join(output, target)
  mkdirSync(path.dirname(destination), { recursive: true })
  writeFileSync(destination, contents)
}
// Do not inherit workspace ignore rules into this self-contained upload.
writeFileSync(path.join(output, '.gcloudignore'), '.git\nnode_modules\ndist\n')
console.log('Cloud Run source prepared in .cloud-run')
