import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const output = path.resolve(process.argv[2] ?? 'dist')
const assets = fs.readdirSync(path.join(output, 'assets'))
const workers = assets.filter(name => /^bookRelatedPages\.worker-[\w-]+\.js$/.test(name))
assert.equal(workers.length, 1, 'Related-page calculation must be packaged as one worker')
const worker = workers[0]
assert.ok(fs.readFileSync(path.join(output, 'assets', worker), 'utf8').includes('onmessage'), 'Worker must accept calculation messages')
assert.ok(assets.filter(name => name.endsWith('.js') && name !== worker)
  .some(name => fs.readFileSync(path.join(output, 'assets', name), 'utf8').includes(worker)), 'Client must reference the emitted worker URL')
assert.ok(fs.readFileSync(path.join(output, 'sw.js'), 'utf8').includes('assets/' + worker), 'Worker must be available from the offline cache')
console.log('Verified worker packaging, its client URL and offline availability.')
