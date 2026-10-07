import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createPageTranslator } from '../public/page-i18n.js'

const resources = Object.fromEntries(['ja', 'en'].map(language => [language,
  JSON.parse(fs.readFileSync(new URL(`../src/i18n/locales/${language}.json`, import.meta.url), 'utf8'))]))

test('every standalone page label is defined in both canonical language files', () => {
  for (const name of ['manage', 'timeout', 'tokushoho']) {
    const html = fs.readFileSync(new URL(`../public/${name}.html`, import.meta.url), 'utf8')
    const keys = [...html.matchAll(/data-i18n(?:-lines)?="([^"]+)"/g)].map(match => match[1])
    assert.ok(keys.length, name)
    assert.ok(html.includes('loadPageTranslations()'), name)
    for (const language of ['ja', 'en']) {
      const t = createPageTranslator(resources[language])
      for (const key of keys) assert.ok(t(key).trim(), `${name}: ${language}: ${key}`)
      for (const match of html.matchAll(/\bt\('([^']+)'/g)) assert.equal(typeof t(match[1]), 'string')
    }
  }
})

test('page interpolation keeps dynamic names as text and preserves numbers and line breaks', () => {
  const t = createPageTranslator(resources.en)
  const name = '<img src=x onerror=alert(1)>$&'
  assert.equal(t('pages.manage.countdownTitle', { name }), `${name} — Countdown`)
  assert.equal(t('pages.manage.limit', { minutes: 60 }), 'Time limit: 60 minutes')
  assert.equal(t('pages.manage.notificationBody', { minutes: 5 }),
    'Your 5 minutes are over.\nClose the social media tab and return to the app.')
  assert.throws(() => t('pages.missing'), /Missing page translation/)
})
