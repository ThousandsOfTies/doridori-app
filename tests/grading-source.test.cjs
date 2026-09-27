const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Run the real component handlers with deterministic canvas/API/storage adapters.
const filename = path.join(__dirname, '../src/components/study/StudyPanel.tsx');
const source = fs.readFileSync(filename, 'utf8');
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name, adapters) {
    let initializer;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) initializer = node.initializer;
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(initializer, name);
    const code = ts.transpileModule('const run = ' + initializer.getText(ast), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    return vm.runInNewContext(code + '\nrun', adapters);
}

function capture({ activeTab = 'A', isSplitView = false, pageA = 1, pageB = 5 } = {}) {
    const bounds = (left, right) => ({ left, right, top: 0, bottom: 100, width: right - left, height: 100 });
    // A's zoomed canvas extends under B; it must be clipped at the pane edge.
    const pane = (left, right, canvasRight) => ({
        getBoundingClientRect: () => bounds(left, right),
        querySelector: () => ({ getBoundingClientRect: () => bounds(left, canvasRight) }),
    });
    const panes = { '.pane-a': pane(0, 100, 250), '.pane-b': pane(100, 200, 200) };
    return handler('captureSelectionArea', {
        activeTab, isSplitView, pageA, pageB,
        containerRef: { current: {
            getBoundingClientRect: () => bounds(0, 200),
            querySelector: selector => panes[selector],
        } },
        paneARef: { current: { getCanvas: () => ({ width: 250, height: 100 }) } },
        paneBRef: { current: { getCanvas: () => ({ width: 100, height: 100 }) } },
        document: { createElement: () => ({
            getContext: () => ({ drawImage() {}, fillRect() {} }),
            toDataURL: () => 'data:image/png;base64,test',
        }) },
    });
}
const rect = (x, width) => ({ x, y: 0, width, height: 100 });
test('captures A, B, both panes, duplicate pages and empty selections accurately', async () => {
    for (const [options, selection, expected] of [
        [{}, rect(0, 100), [1]],
        [{ activeTab: 'B' }, rect(100, 100), [5]],
        [{ isSplitView: true }, rect(110, 80), [5]],
        [{ isSplitView: true }, rect(0, 200), [1, 5]],
        [{ isSplitView: true, pageB: 1 }, rect(0, 200), [1]],
    ]) {
        const result = await capture(options)(selection);
        assert.deepEqual(Array.from(result.sourcePageNumbers), expected);
    }
    const zoomed = await capture({ isSplitView: true })(rect(0, 200));
    assert.equal(zoomed.regions.length, 2);
    assert.deepEqual(Array.from(zoomed.regions, region => [region.pageNumber, region.x, region.width]), [
        [1, 0, 0.4], [5, 0, 1],
    ]);
    assert.equal(await capture({ isSplitView: true })(rect(300, 100)), null);
});

test('history and grading panels retain captured pages despite later PDF navigation', async () => {
    const records = [], panels = [];
    const noop = () => {};
    const run = handler('confirmAndGrade', {
        setIsGrading: noop, setGradingError: noop, addStatusMessage: noop,
        panelStack: [{ type: 'answer', sourcePageNumbers: [5] }], activePanelIndex: 0,
        crypto: { randomUUID: () => 'test' },
        compressImageDataUrl: async value => value,
        Image: class {
            width = 100; height = 100;
            set src(_) { queueMicrotask(() => this.onload()); }
        },
        selectedModel: 'default', i18n: { language: 'ja' },
        gradeWork: async () => ({
            success: true,
            result: { problems: [{ problemNumber: '1', studentAnswer: '5', isCorrect: true }] },
        }),
        pushPanel: value => panels.push(value), updateGradingPanel: noop,
        pdfId: 'book', pdfRecord: { fileName: 'book.pdf' }, pageA: 99, pageB: 100,
        saveGradingImage: async () => 'image', generateGradingHistoryId: () => 'history',
        saveGradingHistory: async value => records.push(value),
        teacherMode: 'balanced', isPanesReversed: false, t: key => key, console,
    });
    await run('image', [5]);
    await run('image', [1, 5]);
    assert.deepEqual(records.map(record => record.pageNumber), [5, 1]);
    assert.deepEqual(records.map(record => record.sourcePageNumbers), [[5], [1, 5]]);
    assert.deepEqual(panels.map(panel => panel.sourcePageNumbers), [[5], [1, 5]]);
});

test('answer export preserves the selected answer source across async panel navigation', async () => {
    let resolve;
    const image = new Promise(yes => { resolve = yes; });
    const stack = [{ type: 'answer', sourcePageNumbers: [5] }];
    let pages;
    const run = handler('handleGradeFromToolbar', {
        panelStack: stack, activePanelIndex: 0, teacherMode: 'balanced',
        answerPanelRef: { current: { getCompositeImage: () => image } },
        confirmAndGrade: async (_, value) => { pages = value; },
    });
    const pending = run();
    stack[0] = { type: 'answer', sourcePageNumbers: [9] };
    resolve('image');
    await pending;
    assert.deepEqual(pages, [5]);
});

test('a saved PDF mark restores the question, answer drawing, and grading panel in order', async () => {
    let panels, activeIndex;
    const run = handler('openStudyTrace', {
        pdfId: 'book',
        getPDFStudyTrace: async () => ({
            id: 'trace', pdfId: 'book', steps: [
                { id: 'answer', type: 'answer', sourcePageNumbers: [2] },
                { id: 'grading', type: 'grading', sourcePageNumbers: [2], result: { problems: [] } },
            ],
        }),
        getPDFStudyAsset: async (_traceId, _stepId, kind) => kind === 'question' ? { kind } : { kind },
        blobToDataUrl: async () => 'data:image/png;base64,question',
        setPanelStack: value => { panels = value; },
        setActivePanelIndex: value => { activeIndex = value; },
        setIsSelectionMode() {}, setIsGradingCaptureMode() {}, setSelectionRect() {},
        addStatusMessage() {}, console,
    });
    await run('trace');
    assert.deepEqual(Array.from(panels, panel => panel.type), ['pdf', 'answer', 'grading']);
    assert.equal(panels[1].questionImage, 'data:image/png;base64,question');
    assert.equal(panels[1].initialDrawing.kind, 'drawing');
    assert.equal(panels[2].traceId, 'trace');
    assert.equal(activeIndex, 1);
});

test('grading again from an earlier answer replaces the later saved branch', async () => {
    const appended = [];
    const panels = [];
    const noop = () => {};
    const run = handler('confirmAndGrade', {
        setIsGrading: noop, setGradingError: noop, addStatusMessage: noop,
        panelStack: [{ type: 'answer', traceId: 'trace', stepId: 'answer-original', sourcePageNumbers: [2] }],
        activePanelIndex: 0,
        answerPanelRef: { current: { getDrawingBlob: async () => null } },
        crypto: { randomUUID: () => 'replacement' },
        compressImageDataUrl: async value => value,
        Image: class {
            width = 100; height = 100;
            set src(_) { queueMicrotask(() => this.onload()); }
        },
        selectedModel: 'default', i18n: { language: 'ja' },
        gradeWork: async () => ({ success: true, result: { problems: [] } }),
        appendPDFStudyStep: async (...args) => appended.push(args),
        pushPanel: panel => panels.push(panel),
        pdfId: 'book', pdfRecord: { fileName: 'book.pdf' }, console,
    });
    await run('image', [2]);
    assert.equal(appended.length, 1);
    assert.equal(appended[0][0], 'trace');
    assert.equal(appended[0][1].type, 'grading');
    assert.equal(appended[0][3], 'answer-original');
    assert.equal(panels[0].traceId, 'trace');
});
