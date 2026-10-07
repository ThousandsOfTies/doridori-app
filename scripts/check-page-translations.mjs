import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const output = path.resolve(process.argv[2] ?? 'dist')
const sw = fs.readFileSync(path.join(output, 'sw.js'), 'utf8')
for (const language of ['ja', 'en']) {
  const publishedPath = `locales/${language}/translation.json`
  const published = JSON.parse(fs.readFileSync(path.join(output, publishedPath), 'utf8'))
  const source = JSON.parse(fs.readFileSync(`src/i18n/locales/${language}.json`, 'utf8'))
  assert.deepEqual(published, source, language + ': standalone page translations are stale')
  assert.ok(sw.includes(publishedPath), language + ': translations must be available offline')
}
assert.ok(fs.existsSync(path.join(output, 'page-i18n.js')))
assert.ok(sw.includes('page-i18n.js'))
console.log('Verified canonical page translations and offline caching for both languages.')
