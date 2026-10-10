const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { viewportCursorPosition, CanvasUndoHistory, answerPinchHarness } = require('../../home-teacher-common/tests/helpers/answerCanvasHarness.cjs')
const file = path.join(__dirname, '../src/components/study/AnswerPanel.tsx')
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function handler(name, adapters) {
  let initializer
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) initializer = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source); assert.ok(initializer, name)
  return vm.runInNewContext(ts.transpileModule('const run = ' + initializer.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText + '\nrun', { viewportCursorPosition, ...adapters })
}

test('Retina drawing coordinates follow the paper rather than its doubled backing pixels', () => {
  const canvas = { width: 1600, height: 2264,
    getBoundingClientRect: () => ({ left: 80, top: 60, width: 400, height: 566 }) }
  const getPos = handler('getPos', {
    drawCanvasRef: { current: canvas },
    getCanvasLogicalSize: () => ({ width: 800, height: 1132 }),
  })
  const point = getPos(180, 210)
  assert.equal(point.x, 200)
  assert.equal(point.y, 300)
})

test('higher display resolution does not enlarge the image sent for evaluation', async () => {
  const bgCanvas = { width: 2400, height: 1698 }, drawCanvas = { width: 2400, height: 1698 }
  const calls = []
  const output = { width: 0, height: 0, getContext: () => ({
    drawImage: (...args) => calls.push(args),
  }), toDataURL: () => 'image' }
  const compose = handler('getCompositeImage', {
    bgCanvasRef: { current: bgCanvas }, drawCanvasRef: { current: drawCanvas },
    document: { createElement: () => output },
    getCanvasLogicalSize: () => ({ width: 1200, height: 849 }),
    textAnnotationsRef: { current: [] }, drawAnswerText() {},
    writingBoundsRef: { current: null },
  })
  assert.equal(await compose(), 'image')
  assert.equal(output.width, 1200)
  assert.equal(output.height, 849)
  assert.deepEqual(calls, [[bgCanvas, 0, 0, 1200, 849], [drawCanvas, 0, 0, 1200, 849]])
})

test('book answer crops use backing pixels while preserving the selected image and writing layout', async () => {
  const bgCanvas = { width: 3200, height: 1800 }, drawCanvas = { width: 3200, height: 1800 }
  const writing = { x: 720, y: 90, width: 620, height: 500 }
  const calls = []
  const output = { width: 0, height: 0, getContext: () => ({
    fillRect() {}, drawImage: (...args) => calls.push(args),
  }), toDataURL: () => 'image' }
  class Image {
    naturalWidth = 600
    naturalHeight = 200
    set src(value) { this.onload() }
  }
  const compose = handler('getCompositeImage', {
    bgCanvasRef: { current: bgCanvas }, drawCanvasRef: { current: drawCanvas },
    writingBoundsRef: { current: writing }, questionImage: 'selection', Image,
    getCanvasLogicalSize: () => ({ width: 1600, height: 900 }),
    document: { createElement: () => output },
  })
  assert.equal(await compose(), 'image')
  assert.equal(output.width, 620)
  assert.equal(output.height, 724)
  assert.deepEqual(calls[1], [drawCanvas, 1440, 180, 1240, 1000, 0, 224, 620, 500])
})

test('eraser cursor stays at the screen tip across paper zoom, pan and viewport scroll', () => {
  const viewport = {
    clientLeft: 2, clientTop: 2, scrollLeft: 0, scrollTop: 0,
    getBoundingClientRect: () => ({ left: 80, top: 60, width: 900, height: 700 }),
  }
  let paperRect
  const cursorAt = handler('getEraserCursorPos', {
    containerRef: { current: viewport }, eraserSize: 24,
    drawCanvasRef: { current: { getBoundingClientRect: () => paperRect } },
  })
  for (const [zoom, panX, panY, scrollLeft, scrollTop] of [
    [1, 0, 0, 0, 0], [0.5, 70, 90, 0, 0], [2.5, -40, -30, 0, 0], [1.4, -80, 20, 15, 25],
  ]) {
    Object.assign(viewport, { scrollLeft, scrollTop })
    paperRect = { left: 102 + panX - scrollLeft, top: 82 + panY - scrollTop,
      width: 600 * zoom, height: 800 * zoom }
    const clientX = paperRect.left + 110 * zoom, clientY = paperRect.top + 80 * zoom
    const cursor = cursorAt(clientX, clientY), bounds = viewport.getBoundingClientRect()
    assert.equal(bounds.left + viewport.clientLeft + cursor.x - scrollLeft, clientX)
    assert.equal(bounds.top + viewport.clientTop + cursor.y - scrollTop, clientY)
    assert.equal(cursor.diameter, 24)
  }
})

test('pinch follows every intermediate scale without an animation and resets on release or cancellation', () => {
  const app = answerPinchHarness(file)
  const event = distance => ({ touches: [{ clientX: 150 - distance / 2, clientY: 100 },
    { clientX: 150 + distance / 2, clientY: 100 }] })
  app.start(event(100))
  assert.equal(app.transition(), 'none')
  for (const distance of [101, 103, 119, 141, 163, 187, 201]) {
    app.move(event(distance))
    assert.ok(Math.abs(app.state.zoom - distance / 100) < 1e-9)
    assert.equal(app.transition(), 'none')
  }
  app.end({ touches: [event(100).touches[0]] })
  assert.equal(app.state.isPinching, false)
  app.start(event(100)); app.cancel()
  assert.equal(app.state.isPinching, false)
  assert.equal(app.state.gestureRef.current, null)
})

test('answer handlers clear the full paper on pixel-capped canvases and undo drawings with their metadata', () => {
  const pixels = new Uint8ClampedArray(16 * 16 * 4), events = []
  const canvas = { width: 16, height: 16, getContext: () => ({
    getImageData: () => ({ width: 16, height: 16, data: pixels.slice() }),
    putImageData: image => pixels.set(image.data), clearRect: (x, y, width, height) => {
      assert.equal(width, 32); assert.equal(height, 32); pixels.fill(0)
    },
  }) }
  const historyRef = { current: new CanvasUndoHistory() }
  const texts = { current: [] }, strokes = { current: [] }
  const updateTexts = value => { texts.current = value }
  const adapters = { drawCanvasRef: { current: canvas }, historyRef,
    textAnnotationsRef: texts, strokesRef: strokes, activeStrokeRef: { current: null },
    getCanvasLogicalSize: () => ({ width: 32, height: 32 }),
    editingTextRef: { current: null }, setEditingText() {}, updateTexts,
    updateTextAnnotations: updateTexts, persistDrawing: () => events.push('saved'),
    setCanUndo: value => events.push(value), onCanUndoChange() {},
  }
  const saveSnapshot = handler('saveSnapshot', adapters)
  const undo = handler('handleUndo', adapters), clear = handler('handleClear', { ...adapters, saveSnapshot })
  saveSnapshot(); pixels.set([21, 62, 89, 177], 12)
  texts.current = [{ text: 'first' }]; strokes.current = [{ points: [[0, 0], [2, 4]] }]
  const first = pixels.slice()
  saveSnapshot(); pixels.set([89, 31, 43, 212], 72)
  texts.current = [{ text: 'second' }]; strokes.current = []
  undo(); assert.deepEqual(pixels, first); assert.equal(historyRef.current.length, 1)
  assert.equal(texts.current[0].text, 'first')
  
  clear(); assert.ok(pixels.every(value => value === 0))
  undo(); assert.deepEqual(pixels, first)
  assert.equal(texts.current[0].text, 'first')
  undo(); assert.ok(pixels.every(value => value === 0)); assert.equal(historyRef.current.length, 0)
  assert.equal(events.filter(value => typeof value === 'boolean').at(-1), false)
})
