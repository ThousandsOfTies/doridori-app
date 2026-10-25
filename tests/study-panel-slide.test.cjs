const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function harness() {
  const cells = [], effects = []
  let cursor = 0, dirty = false
  const equal = (a, b) => a?.length === b.length && b.every((value, i) => Object.is(value, a[i]))
  const react = {
    useRef(value) { const index = cursor++; cells[index] ??= { current: value }; return cells[index] },
    useState(initial) {
      const index = cursor++
      cells[index] ??= { value: initial }
      return [cells[index].value, next => {
        const value = typeof next === 'function' ? next(cells[index].value) : next
        if (!Object.is(value, cells[index].value)) { cells[index].value = value; dirty = true }
      }]
    },
    useCallback(callback, deps) {
      const index = cursor++
      if (!equal(cells[index]?.deps, deps)) cells[index] = { deps, value: callback }
      return cells[index].value
    },
    useLayoutEffect(callback, deps) {
      const index = cursor++
      if (!equal(cells[index]?.deps, deps)) {
        cells[index] = { deps }
        effects.push(callback)
      }
    },
  }
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
    '../src/hooks/useStudyPanelSlide.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: id => { assert.equal(id, 'react'); return react } })
  return { render(index, key, wait = false) {
    let view, passes = 0
    do {
      assert.ok(++passes < 10, 'Layout effects must settle without a render loop')
      dirty = false
      cursor = 0
      view = exports.useStudyPanelSlide(index, key, wait)
      effects.splice(0).forEach(callback => callback())
    } while (dirty)
    return view
  } }
}

test('a new question waits offscreen until its fitted canvas is ready, then slides one page to the right', () => {
  const h = harness()
  assert.equal(h.render(0, 'pdf').displayedIndex, 0)
  let view = h.render(1, 'answer:root:question', true)
  assert.equal(view.displayedIndex, 0)
  assert.equal(view.isPreparing, true)
  view.setPanelReady('answer:root:question', true)
  view = h.render(1, 'answer:root:question', true)
  assert.equal(view.displayedIndex, 1)
  assert.equal(view.isPreparing, false)
})

test('returning to the PDF or a prepared question does not wait for another readiness event', () => {
  const h = harness()
  h.render(0, 'pdf')
  let view = h.render(1, 'answer:root:question', true)
  view.setPanelReady('answer:root:question', true)
  assert.equal(h.render(1, 'answer:root:question', true).displayedIndex, 1)
  assert.equal(h.render(0, 'pdf').displayedIndex, 0)
  view = h.render(1, 'answer:root:question', true)
  assert.equal(view.displayedIndex, 1)
  assert.equal(view.isPreparing, false)
  assert.equal(h.render(2, 'grading:root:answer').displayedIndex, 2)
})

test('a slow earlier question cannot interrupt navigation back to the PDF or to another question', () => {
  const h = harness()
  h.render(0, 'pdf')
  const old = h.render(1, 'answer:old:question', true)
  h.render(0, 'pdf')
  old.setPanelReady('answer:old:question', true)
  assert.equal(h.render(0, 'pdf').displayedIndex, 0)
  let view = h.render(1, 'answer:new:question', true)
  old.setPanelReady('answer:old:question', true)
  view = h.render(1, 'answer:new:question', true)
  assert.equal(view.displayedIndex, 0)
  assert.equal(view.isPreparing, true)
  view.setPanelReady('answer:new:question', true)
  assert.equal(h.render(1, 'answer:new:question', true).displayedIndex, 1)
})

test('replaced or unmounted questions discard their readiness, including when their index is reused', () => {
  const h = harness()
  h.render(0, 'pdf')
  let view = h.render(1, 'answer:first:question', true)
  view.setPanelReady('answer:first:question', true)
  h.render(1, 'answer:first:question', true)
  h.render(0, 'pdf')
  view.setPanelReady('answer:first:question', false)
  view = h.render(1, 'answer:first:question', true)
  assert.equal(view.displayedIndex, 0)
  assert.equal(view.isPreparing, true)
  view = h.render(1, 'answer:replacement:question', true)
  assert.equal(view.displayedIndex, 0)
  view.setPanelReady('answer:replacement:question', true)
  assert.equal(h.render(1, 'answer:replacement:question', true).displayedIndex, 1)
})
