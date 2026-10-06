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
const panelWheelExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
    '../../home-teacher-common/src/utils/panelWheelNavigation.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: panelWheelExports });
const { getPanelWheelDestination } = panelWheelExports;

function answerWheelHarness() {
    class Element { constructor(control = false) { this.control = control; } closest() { return this.control ? this : null; } }
    const viewportRef = { current: { zoom: 1, panOffset: { x: 0, y: 0 } } };
    const updates = [];
    const run = handler('handleWheelNative', { Element, viewportRef,
        container: { clientHeight: 500, getBoundingClientRect: () => ({ left: 100, top: 80 }) },
        setZoom: value => updates.push(['zoom', value]), setPanOffset: value => updates.push(['pan', value]) }, 'AnswerPanel');
    const send = (options = {}) => {
        let prevented = false, stopped = false;
        run({ target: new Element(), buttons: 0, deltaY: 100, deltaMode: 0, clientX: 300, clientY: 280,
            preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, ...options });
        return { prevented, stopped };
    };
    return { viewportRef, updates, send, control: () => new Element(true) };
}

test('writing-area wheel leaves text editors and consumed or drawing events alone', () => {
    const h = answerWheelHarness();
    for (const options of [{ target: h.control() }, { target: h.control(), ctrlKey: true },
        { defaultPrevented: true }, { buttons: 1 }, { deltaY: 0 }, { deltaY: NaN }]) {
        assert.deepEqual(h.send(options), { prevented: false, stopped: false });
        assert.equal(h.updates.length, 0);
    }
    assert.deepEqual(h.send({ deltaY: 3, deltaMode: 1 }), { prevented: true, stopped: true });
    assert.equal(h.viewportRef.current.panOffset.y, -48);
    h.send({ deltaY: 1, deltaMode: 2 });
    assert.equal(h.viewportRef.current.panOffset.y, -548);
});

test('rapid writing-area wheel events accumulate and keep the zoom focus stable', () => {
    const h = answerWheelHarness();
    h.send({ deltaY: 10 });
    h.send({ deltaY: 20 });
    assert.equal(h.viewportRef.current.panOffset.y, -30);
    const focus = () => {
        const { zoom, panOffset } = h.viewportRef.current;
        return [(200 - panOffset.x) / zoom, (200 - panOffset.y) / zoom];
    };
    const before = focus();
    h.send({ deltaY: -100, ctrlKey: true });
    h.send({ deltaY: -100, metaKey: true });
    assert.ok(Math.abs(h.viewportRef.current.zoom - 1.21) < 1e-10);
    focus().forEach((value, index) => assert.ok(Math.abs(value - before[index]) < 1e-10));
    for (let i = 0; i < 30; i++) h.send({ deltaY: -100, ctrlKey: true });
    assert.equal(h.viewportRef.current.zoom, 5);
    for (let i = 0; i < 50; i++) h.send({ deltaY: 100, ctrlKey: true });
    assert.equal(h.viewportRef.current.zoom, 0.2);
});
function handler(name, adapters, component = 'StudyPanel') {
    const componentAst = component === 'StudyPanel' ? ast : ts.createSourceFile(component,
        fs.readFileSync(path.join(__dirname, '../src/components/study/' + component + '.tsx'), 'utf8'),
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let initializer;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(componentAst) === name) initializer = node.initializer;
        ts.forEachChild(node, visit);
    }
    visit(componentAst);
    assert.ok(initializer, name);
    const code = ts.transpileModule('const run = ' + initializer.getText(componentAst), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    return vm.runInNewContext(code + '\nrun', {
        traceUndo: { busy: false }, deletedTraceIdsRef: { current: new Set() }, handledTracePointerRef: { current: false },
        ...adapters,
    });
}

test('older teacher answers retain their layout while new answers include reference media', () => {
    const componentFile = path.join(__dirname, '../src/components/study/BookAnswer.tsx');
    const module = { exports: {} };
    const referenceComponent = () => null;
    const compiled = ts.transpileModule(fs.readFileSync(componentFile, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
            jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(compiled, { exports: module.exports, require: name => {
        if (name === 'react/jsx-runtime') return require(name);
        return name === './BookReferenceMedia' ? referenceComponent : () => null;
    } });
    const find = (element, predicate) => {
        if (!element || typeof element !== 'object') return undefined;
        if (predicate(element)) return element;
        const children = element.props?.children;
        return (Array.isArray(children) ? children : [children]).map(child => find(child, predicate)).find(Boolean);
    };
    const render = props => module.exports.default({ text: '保存済みの回答', referencePages: [], ...props });
    const oldAnswer = render({});
    assert.equal(find(oldAnswer, node => node.type === referenceComponent), undefined);
    assert.equal(find(oldAnswer, node => node.props?.className?.includes('book-answer-with-media')), undefined);
    const newAnswer = render({ question: '新しい質問' });
    assert.ok(find(newAnswer, node => node.type === referenceComponent));
    assert.ok(find(newAnswer, node => node.props?.className?.includes('book-answer-with-media')));
})

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
test('Undo removes only the last stroke on the selected PDF page and saves that page', () => {
    for (const activeTab of ['A', 'B']) {
        const pageA = 4, pageB = 9;
        const original = new Map([[pageA, [{ id: 'a1' }, { id: 'a2' }]], [pageB, [{ id: 'b1' }, { id: 'b2' }]]]);
        let drawings = original;
        const writes = new Map();
        const undo = handler('handleUndo', {
            activeTab, pageA, pageB,
            setDrawingPaths: update => { drawings = update(drawings); },
            pendingDrawingWritesRef: { current: writes },
        });
        const selected = activeTab === 'A' ? pageA : pageB;
        const other = activeTab === 'A' ? pageB : pageA;
        undo();
        assert.deepEqual(drawings.get(selected), original.get(selected).slice(0, 1));
        assert.equal(drawings.get(other), original.get(other));
        assert.equal(original.get(selected).length, 2);
        assert.deepEqual(Array.from(writes), [[selected, JSON.stringify(original.get(selected).slice(0, 1))]]);
        undo();
        assert.deepEqual(Array.from(drawings.get(selected)), []);
        assert.deepEqual(Array.from(writes), [[selected, '[]']]);
        undo();
        assert.equal(drawings.get(other), original.get(other));
        assert.deepEqual(Array.from(writes), [[selected, '[]']]);
    }
});

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
    assert.equal((await capture()(rect(0, 100))).pageDisplayWidth, 250);
    assert.deepEqual(Array.from(zoomed.regions, region => [region.pageNumber, region.x, region.width]), [
        [1, 0, 0.4], [5, 0, 1],
    ]);
    assert.equal(await capture({ isSplitView: true })(rect(300, 100)), null);
});

test('question panels retain captured pages despite later PDF navigation', async () => {
    const panels = [], requestedPages = [];
    const noop = () => {};
    const run = handler('confirmAndGrade', {
        setIsGrading: noop, setGradingError: noop, setBookAgentStatus: noop, addStatusMessage: noop,
        panelStack: [{ type: 'answer', sourcePageNumbers: [5] }], activePanelIndex: 0,
        crypto: { randomUUID: () => 'test' },
        compressImageDataUrl: async value => value,
        Image: class {
            width = 100; height = 100;
            set src(_) { queueMicrotask(() => this.onload()); }
        },
        selectedModel: 'default',
        readBookQuestion: async () => 'この箇所の意味は？',
        bookIndex: { textPageCount: 3, answerContextRequest: async (_, page) => {
            requestedPages.push(page);
            return { id: 'ai-search', contexts: [{ pageNumber: page, text: '本文' }], indexedPages: 3 };
        } },
        askBookQuestion: async (body, resolveContext) => {
            assert.equal('contexts' in body, false);
            await resolveContext({ id: 'ai-search', name: 'search_book', query: '確認', reason: '本文を確認' });
            return { success: true, result: { pageType: 'book-question', problems: [], overallComment: '説明' } };
        },
        pushPanel: value => panels.push(value),
        pdfId: 'book', pdfRecord: { fileName: 'book.pdf' }, pageA: 99, pageB: 100,
        includeLaterPages: false, numPages: 100, console,
    });
    await run('image', [5]);
    await run('image', [1, 5]);
    assert.deepEqual(requestedPages, [5, 1]);
    assert.deepEqual(panels.map(panel => panel.sourcePageNumbers), [[5], [1, 5]]);
    assert.ok(panels.every(panel => panel.result.pageType === 'book-question'));
});

test('answer export preserves the selected answer source across async panel navigation', async () => {
    let resolve;
    const image = new Promise(yes => { resolve = yes; });
    const stack = [{ type: 'answer', sourcePageNumbers: [5] }];
    let pages;
    const run = handler('handleGradeFromToolbar', {
        panelStack: stack, activePanelIndex: 0, teacherMode: 'balanced',
        answerPanelRef: { current: { getCompositeImage: () => image, getQuestionText: () => '' } },
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
        studyTraces: [],
        pendingQuestionWritesRef: { current: new Map() },
        getPDFStudyTrace: async () => ({
            id: 'trace', pdfId: 'book',
            regions: [{ pageNumber: 2, x: 0.1, y: 0.2, width: 0.4, height: 0.3 }],
            steps: [
                { id: 'answer', type: 'answer', source: 'pdf', layoutMode: 'full-page-focus', sourcePageNumbers: [2] },
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
    assert.equal(panels[1].focusRegion.pageNumber, 2);
    assert.equal(panels[1].focusRegion.x, 0.1);
    assert.equal(panels[2].traceId, 'trace');
    assert.equal(activeIndex, 1);
});

test('a book question restores the full page focus and earlier typed text', async () => {
    let panels;
    const run = handler('openStudyTrace', {
        pdfId: 'book', studyTraces: [],
        getPDFStudyTrace: async () => ({
            id: 'trace', pdfId: 'book',
            regions: [{ pageNumber: 4, x: 0.2, y: 0.3, width: 0.5, height: 0.2 }],
            steps: [{ id: 'answer', type: 'answer', source: 'pdf', layoutMode: 'book-text',
                questionText: '著者はなぜそう考えた？', pageDisplayWidth: 980, sourcePageNumbers: [4] }],
        }),
        getPDFStudyAsset: async () => ({}), blobToDataUrl: async () => 'data:image/png;base64,question',
        setPanelStack: value => { panels = value; }, setActivePanelIndex() {},
        setIsSelectionMode() {}, setIsGradingCaptureMode() {}, setSelectionRect() {},
        pendingQuestionWritesRef: { current: new Map() }, addStatusMessage() {}, console,
    });
    await run('trace');
    assert.equal(panels[1].fullPageQuestion, true);
    assert.equal(panels[1].initialTexts[0].text, '著者はなぜそう考えた？');
    assert.equal(panels[1].focusRegion.pageNumber, 4);
    assert.equal(panels[1].pageDisplayWidth, 980);
});

test('new book-page history restores text annotations on the PDF page', async () => {
    let panels;
    const run = handler('openStudyTrace', {
        pdfId: 'book', studyTraces: [], pendingQuestionWritesRef: { current: new Map() },
        getPDFStudyTrace: async () => ({
            id: 'trace', pdfId: 'book', regions: [{ pageNumber: 2, x: 0.1, y: 0.2, width: 0.4, height: 0.3 }],
            steps: [{ id: 'answer', type: 'answer', source: 'pdf', layoutMode: 'book-page',
                sourcePageNumbers: [2], pageDisplayWidth: 900, answerTexts: [
                    { id: 'text', x: 100, y: 200, text: 'ここはどういう意味？', fontSize: 18,
                        color: '#222222', direction: 'horizontal' },
                ] }],
        }),
        getPDFStudyAsset: async () => ({}), blobToDataUrl: async () => 'data:image/png;base64,question',
        setPanelStack: value => { panels = value; }, setActivePanelIndex() {},
        setIsSelectionMode() {}, setIsGradingCaptureMode() {}, setSelectionRect() {},
        addStatusMessage() {}, console,
    });
    await run('trace');
    assert.equal(panels[1].fullPageQuestion, true);
    assert.equal(panels[1].initialTexts[0].text, 'ここはどういう意味？');
    assert.equal(panels[1].pageDisplayWidth, 900);
});

test('returning to PDF activates range selection and clears drawing tools', () => {
    const updates = [];
    const activatePanelMode = handler('activatePanelMode', {
        useCallback: callback => callback,
        setIsSelectionMode: value => updates.push(['selection', value]),
        setIsDrawingMode: value => updates.push(['pen', value]),
        setIsEraserMode: value => updates.push(['eraser', value]),
        setIsTextMode: value => updates.push(['text', value]),
        setSelectionRect: value => updates.push(['rect', value]),
        setIsHoveringStudyTrace() {}, setIsGradingCaptureMode() {}, setGradingCaptureRect() {},
        isSelectingRef: { current: false }, selectionStartRef: { current: null },
        isGradingCapturingRef: { current: false }, gradingCaptureStartRef: { current: null },
        gradingCaptureRectRef: { current: null },
    });
    const run = handler('navigateToPanel', {
        panelStack: [{ type: 'pdf' }, { type: 'answer' }], activatePanelMode,
        setActivePanelIndex: value => updates.push(['panel', value]),
    });
    run(0);
    assert.deepEqual(updates.map(([key, value]) => [key, value]), [
        ['selection', true], ['rect', null], ['pen', false], ['eraser', false],
        ['text', false], ['panel', 0],
    ]);
});

test('PDF horizontal navigation uses visible-page marks and never chooses between multiple ranges', () => {
    const root = { id: 'root', regions: [{ pageNumber: 1 }] };
    const other = { id: 'other', regions: [{ pageNumber: 2 }] };
    const panelStack = [{ type: 'pdf' }, { type: 'answer', traceId: 'root' }];
    const base = { activePanel: panelStack[0], panelStack, activePanelIndex: 0,
        studyTraces: [root, other], pageA: 1, pageB: 2, isSplitView: false, activeTab: 'A', getPanelWheelDestination };
    const read = overrides => handler('getWheelDestination', { ...base, ...overrides })(1);
    assert.deepEqual(JSON.parse(JSON.stringify(read())), { type: 'panel', index: 1 });
    assert.equal(read({ studyTraces: [root, { id: 'second', regions: [{ pageNumber: 1 }] }] }), null);
    assert.equal(read({ isSplitView: true }), null);
    assert.deepEqual(JSON.parse(JSON.stringify(read({ activeTab: 'B' }))), { type: 'marker', id: 'other' });
    assert.equal(read({ pageA: 3 }), null);
});

test('teacher-answer forks block right even with a retained child panel and always allow going left', () => {
    const activePanel = { type: 'grading', traceId: 'root', stepId: 'result' };
    const panelStack = [{ type: 'pdf' }, { type: 'answer' }, activePanel, { type: 'answer', traceId: 'a' }];
    const children = [{ id: 'a', parentTraceId: 'root', parentStepId: 'result' },
        { id: 'b', parentTraceId: 'root', parentStepId: 'result' },
        { id: 'later', parentTraceId: 'a', parentStepId: 'a-result' }];
    const base = { activePanel, panelStack, activePanelIndex: 2, studyTraces: children, getPanelWheelDestination };
    const read = handler('getWheelDestination', base);
    assert.equal(read(1), null);
    assert.deepEqual(JSON.parse(JSON.stringify(read(-1))), { type: 'panel', index: 1 });
    const single = handler('getWheelDestination', { ...base, studyTraces: children.slice(0, 1) });
    assert.deepEqual(JSON.parse(JSON.stringify(single(1))), { type: 'panel', index: 3 });
    const unsaved = handler('getWheelDestination', { ...base, activePanel: { type: 'grading' },
        studyTraces: [{ id: 'root' }, { id: 'other' }] });
    assert.deepEqual(JSON.parse(JSON.stringify(unsaved(1))), { type: 'panel', index: 3 });
});

test('horizontal movement opens an adjacent panel or its sole marker and does nothing at a fork', async () => {
    const calls = [];
    let destination = null;
    const run = handler('navigateWithWheel', {
        getWheelDestination: () => destination,
        navigateToPanel: index => calls.push(['panel', index]),
        openStudyTrace: async id => calls.push(['mark', id]),
    });
    await run(1); assert.deepEqual(calls, []);
    destination = { type: 'panel', index: 1 }; await run(-1);
    destination = { type: 'marker', id: 'child' }; await run(1);
    assert.deepEqual(calls, [['panel', 1], ['mark', 'child']]);
});

test('typed questions are sent directly without handwriting recognition', async () => {
    let asked;
    const run = handler('confirmAndGrade', {
        setIsGrading() {}, setGradingError() {}, setBookAgentStatus() {}, addStatusMessage() {},
        panelStack: [{ type: 'answer', sourcePageNumbers: [4] }],
        activePanelIndex: 0, compressImageDataUrl: async value => value,
        Image: class {
            width = 100; height = 100;
            set src(_) { queueMicrotask(() => this.onload()); }
        },
        crypto: { randomUUID: () => 'result' },
        selectedModel: 'default', includeLaterPages: false, numPages: 10, pageA: 4,
        readBookQuestion: async () => { throw new Error('handwriting recognition should not run'); },
        bookIndex: { textPageCount: 0, answerContextRequest: async () => { throw new Error('AI has not requested context'); } },
        askBookQuestion: async body => {
            asked = body;
            return { success: true, result: { pageType: 'book-question', problems: [] } };
        },
        pushPanel() {}, console,
    });
    await run('image', [4], '著者はなぜそう考えた？');
    assert.equal(asked.question, '著者はなぜそう考えた？');
    assert.equal(asked.currentPage, 4);
    assert.equal('contexts' in asked, false);
    assert.deepEqual(Array.from(asked.clientCapabilities), ['search_book', 'read_book_pages']);
});

test('answer selection is stored relative to the answer card', () => {
    const measure = handler('getResultCaptureGeometry', {});
    const result = measure(
        { x: 35, y: 55, width: 120, height: 90 },
        { left: 100, top: 100 },
        { left: 120, top: 140, width: 200, height: 300 },
    );
    assert.deepEqual(Array.from([result.x, result.y, result.width, result.height]), [35, 55, 120, 90]);
    assert.deepEqual(Array.from(Object.values(result.region)), [0.075, 0.05, 0.6, 0.3]);
});

test('marks open the selected question and keep its saved teacher answer in the breadcrumbs', async () => {
    const root = { id: 'root', pdfId: 'book', regions: [], steps: [
        { id: 'root-answer', type: 'answer', source: 'pdf', sourcePageNumbers: [1] },
        { id: 'root-result', type: 'grading', sourcePageNumbers: [1], result: { problems: [] } },
    ] };
    const child = id => ({ id, pdfId: 'book', parentTraceId: 'root', parentStepId: 'root-result', regions: [], steps: [
        { id: id + '-answer', type: 'answer', source: 'grading', sourcePageNumbers: [1] },
        { id: id + '-result', type: 'grading', sourcePageNumbers: [1], result: { problems: [] } },
    ] });
    const first = child('first'), second = child('second');
    let panels, activeIndex;
    const run = handler('openStudyTrace', {
        pdfId: 'book', studyTraces: [root, first, second],
        pendingQuestionWritesRef: { current: new Map() },
        getPDFStudyTrace: async id => [root, first, second].find(trace => trace.id === id),
        getPDFStudyAsset: async () => ({}), blobToDataUrl: async () => 'data:image/png;base64,test',
        setPanelStack: value => { panels = value; },
        setActivePanelIndex: value => { activeIndex = value; },
        setIsSelectionMode() {}, setIsGradingCaptureMode() {}, setSelectionRect() {},
        addStatusMessage() {}, console,
    });
    await run('root');
    assert.deepEqual(Array.from(panels, panel => panel.type), ['pdf', 'answer', 'grading']);
    assert.equal(activeIndex, 1);
    await run('second');
    assert.deepEqual(Array.from(panels, panel => panel.type), ['pdf', 'answer', 'grading', 'answer', 'grading']);
    assert.equal(panels[3].traceId, 'second');
    assert.equal(activeIndex, 3);
});

test('a PDF mark restores its single continuation while displaying the question after the PDF', async () => {
    const root = { id: 'root', pdfId: 'book', regions: [], steps: [
        { id: 'root-answer', type: 'answer', source: 'pdf', sourcePageNumbers: [1] },
        { id: 'root-result', type: 'grading', sourcePageNumbers: [1], result: { problems: [] } },
    ] };
    const child = { id: 'child', pdfId: 'book', parentTraceId: 'root', parentStepId: 'root-result',
        regions: [], steps: [{ id: 'child-answer', type: 'answer', source: 'grading', sourcePageNumbers: [1] }] };
    const savedChild = { ...child, steps: [{ ...child.steps[0], layoutMode: 'book-text',
        questionText: 'もう少し詳しく教えて' }] };
    let panels, activeIndex;
    const run = handler('openStudyTrace', {
        pdfId: 'book', studyTraces: [root, child],
        pendingQuestionWritesRef: { current: new Map() },
        getPDFStudyTrace: async id => id === 'root' ? root : savedChild,
        getPDFStudyAsset: async () => ({}), blobToDataUrl: async () => 'data:image/png;base64,test',
        setPanelStack: value => { panels = value; },
        setActivePanelIndex: value => { activeIndex = value; },
        setIsSelectionMode() {}, setIsGradingCaptureMode() {}, setSelectionRect() {},
        addStatusMessage() {}, console,
    });
    await run('root');
    assert.deepEqual(Array.from(panels, panel => panel.type), ['pdf', 'answer', 'grading', 'answer']);
    assert.equal(panels[3].initialTexts[0].text, 'もう少し詳しく教えて');
    assert.equal(activeIndex, 1);
    await run('child');
    assert.deepEqual(Array.from(panels, panel => panel.type), ['pdf', 'answer', 'grading', 'answer']);
    assert.equal(panels[3].traceId, 'child');
    assert.equal(panels[3].initialTexts[0].text, 'もう少し詳しく教えて');
    assert.equal(activeIndex, 3);
});

test('PDF breadcrumbs restore a chain up to the first fork without jumping past the first question', async () => {
    const makeTrace = (id, parent, graded = true) => ({
        id, pdfId: 'book', regions: [],
        ...(parent ? { parentTraceId: parent, parentStepId: parent + '-result' } : {}),
        steps: [
            { id: id + '-answer', type: 'answer', source: parent ? 'grading' : 'pdf', sourcePageNumbers: [1] },
            ...(graded ? [{ id: id + '-result', type: 'grading', sourcePageNumbers: [1], result: { problems: [] } }] : []),
        ],
    });
    for (const branches of [false, true]) {
        const traces = [makeTrace('root'), makeTrace('first', 'root'), makeTrace('second', 'first'),
            ...(branches ? [makeTrace('branch-a', 'second', false), makeTrace('branch-b', 'second', false)]
                : [makeTrace('last-question', 'second', false)])];
        let panels, activeIndex;
        const loaded = [];
        const run = handler('openStudyTrace', {
            pdfId: 'book', studyTraces: traces, pendingQuestionWritesRef: { current: new Map() },
            getPDFStudyTrace: async id => traces.find(trace => trace.id === id),
            getPDFStudyAsset: async (id, _, kind) => {
                if (kind === 'question') loaded.push(id);
                return { kind };
            },
            blobToDataUrl: async () => 'question-image',
            setPanelStack: value => { panels = value; }, setActivePanelIndex: value => { activeIndex = value; },
            setIsSelectionMode() {}, setIsGradingCaptureMode() {}, setSelectionRect() {},
            addStatusMessage: message => assert.fail(message), console,
        });
        await run('root');
        assert.equal(activeIndex, 1);
        assert.equal(panels[activeIndex].traceId, 'root');
        assert.deepEqual(Array.from(panels, panel => panel.traceId), [
            undefined, 'root', 'root', 'first', 'first', 'second', 'second',
            ...(branches ? [] : ['last-question']),
        ]);
        assert.deepEqual(loaded, branches ? ['root', 'first', 'second'] : ['root', 'first', 'second', 'last-question']);
        // An answer's mark still opens that chosen question without expanding further descendants.
        await run('first');
        assert.equal(activeIndex, 3);
        assert.deepEqual(Array.from(panels, panel => panel.traceId), [undefined, 'root', 'root', 'first', 'first']);
    }
});

test('PDF restoration stops at a fork inside older linear history', async () => {
    const root = { id: 'root', pdfId: 'book', regions: [], steps: [
        { id: 'root-answer', type: 'answer', source: 'pdf', sourcePageNumbers: [1] },
        { id: 'root-result', type: 'grading', sourcePageNumbers: [1], result: { problems: [] } },
        { id: 'older-answer', type: 'answer', source: 'grading', sourcePageNumbers: [1] },
        { id: 'older-result', type: 'grading', sourcePageNumbers: [1], result: { problems: [] } },
    ] };
    const children = ['a', 'b'].map(id => ({ id, parentTraceId: 'root', parentStepId: 'root-result' }));
    let panels, activeIndex;
    const loaded = [];
    const run = handler('openStudyTrace', {
        pdfId: 'book', studyTraces: [root, ...children], pendingQuestionWritesRef: { current: new Map() },
        getPDFStudyTrace: async id => { assert.equal(id, 'root'); return root; },
        getPDFStudyAsset: async (_, id) => { loaded.push(id); return {}; },
        blobToDataUrl: async () => 'question-image',
        setPanelStack: value => { panels = value; }, setActivePanelIndex: value => { activeIndex = value; },
        setIsSelectionMode() {}, setIsGradingCaptureMode() {}, setSelectionRect() {},
        addStatusMessage: message => assert.fail(message), console,
    });
    await run('root');
    assert.equal(activeIndex, 1);
    assert.deepEqual(Array.from(panels, panel => panel.stepId), [undefined, 'root-answer', 'root-result']);
    assert.deepEqual(loaded, ['root-answer', 'root-answer']);
});

test('answer selection leaves scrollbars and controls native while selecting within the text viewport', () => {
    class Element { constructor(control = false) { this.control = control; } closest() { return this.control ? this : null; } }
    const viewport = { clientLeft: 0, clientTop: 0, clientWidth: 385, clientHeight: 460,
        getBoundingClientRect: () => ({ left: 100, top: 80, width: 400, height: 460 }) };
    const panel = { getBoundingClientRect: () => ({ left: 100, top: 80, width: 400, height: 500 }),
        querySelector: () => viewport };
    const capturing = { current: false }, start = { current: null }, selection = { current: null };
    const adapters = { Element, gradingPanelRef: { current: panel }, isGradingCapturingRef: capturing,
        gradingCaptureStartRef: start, gradingCaptureRectRef: selection, setGradingCaptureRect() {},
        getResultViewportBounds: handler('getResultViewportBounds', {}), getStudyTraceAtPoint: () => null };
    const begin = handler('handleGradingCaptureStart', adapters);
    let prevented = 0;
    const down = (clientX, clientY, target = new Element()) => begin({
        button: 0, clientX, clientY, target, preventDefault() { prevented++; },
    });
    for (const [x, y, target] of [[492, 200], [485, 200], [150, 555], [99, 180], [150, 180, new Element(true)]]) {
        down(x, y, target);
        assert.equal(capturing.current, false);
        assert.equal(selection.current, null);
        assert.equal(prevented, 0);
    }
    // An RTL scrollbar occupies the left edge and must also retain native dragging.
    viewport.clientLeft = 15;
    down(108, 180);
    assert.equal(capturing.current, false);
    assert.equal(prevented, 0);
    viewport.clientLeft = 0;
    down(150, 180);
    assert.equal(capturing.current, true);
    assert.equal(prevented, 1);
    assert.deepEqual({ ...start.current }, { x: 50, y: 100 });
    handler('handleGradingCaptureMove', adapters)({ clientX: 900, clientY: 900 });
    assert.deepEqual({ ...selection.current }, { x: 50, y: 100, width: 335, height: 360 });
});

test('scrolling discards an unfinished answer selection without creating a follow-up', async () => {
    const capturing = { current: true }, start = { current: { x: 20, y: 30 } };
    const selection = { current: { x: 20, y: 30, width: 100, height: 50 } };
    const changes = [];
    const adapters = { isGradingCapturingRef: capturing, gradingCaptureStartRef: start,
        gradingCaptureRectRef: selection, setGradingCaptureRect: value => changes.push(value) };
    const scroll = handler('handleGradingCaptureScroll', adapters);
    scroll();
    assert.equal(capturing.current, false);
    assert.equal(start.current, null);
    assert.equal(selection.current, null);
    assert.deepEqual(changes, [null]);
    await handler('handleGradingCaptureEnd', { ...adapters, panelStack: [{ type: 'grading' }], activePanelIndex: 0,
        gradingPanelRef: { current: {} }, pushPanel: () => assert.fail('Scrolling must not create a question') })();
    scroll();
    assert.deepEqual(changes, [null]);
});

test('a teacher answer selection saves the whole paper, focus, size and scroll position', async () => {
    const sourcePanel = { type: 'grading', traceId: 'root', stepId: 'result', sourcePageNumbers: [4] };
    const inner = { getBoundingClientRect: () => ({ left: 120, top: -500, width: 1000, height: 2000 }) };
    const overlay = { style: { display: '' } }, markers = { style: { display: '' } };
    const panel = {
        getBoundingClientRect: () => ({ left: 100, top: 80 }),
        querySelector: selector => ({
            '.result-inner': inner, '.result-content': { scrollTop: 600 },
            '.grading-capture-overlay': overlay, '.grading-study-markers': markers,
        })[selector],
    };
    let saved, opened;
    const run = handler('handleGradingCaptureEnd', {
        panelStack: [sourcePanel], activePanelIndex: 0,
        gradingPanelRef: { current: panel }, isGradingCapturingRef: { current: true },
        gradingCaptureRectRef: { current: { x: 300, y: 200, width: 200, height: 100 } },
        getResultCaptureGeometry: handler('getResultCaptureGeometry', {}),
        captureResultPage: async element => {
            assert.equal(element, inner);
            assert.equal(overlay.style.display, 'none');
            assert.equal(markers.style.display, 'none');
            return { toDataURL: () => 'full-answer-image' };
        },
        crypto: { randomUUID: () => 'followup' }, pdfId: 'book',
        dataUrlToBlob: async image => {
            assert.equal(image, 'full-answer-image');
            return image;
        },
        createPDFStudyTrace: async trace => { saved = trace; },
        setStudyTraces() {}, pushPanel: value => { opened = value; },
        setIsGradingCaptureMode() {}, setGradingCaptureRect() {},
        addStatusMessage: message => assert.fail(message), console,
    });
    await run();
    assert.equal(opened.questionImage, 'full-answer-image');
    assert.equal(opened.fullPageQuestion, true);
    assert.equal(opened.pageDisplayWidth, 1000);
    assert.equal(opened.pageScrollTop, 600);
    assert.deepEqual(Array.from(Object.values(opened.imageFocusRegion)), [0.28, 0.39, 0.2, 0.05]);
    assert.equal(saved.steps[0].layoutMode, 'book-result-focus');
    assert.equal(saved.steps[0].imageFocusRegion, opened.imageFocusRegion);
    assert.equal(saved.steps[0].pageDisplayWidth, 1000);
    assert.equal(saved.steps[0].pageScrollTop, 600);
    assert.equal(overlay.style.display, '');
    assert.equal(markers.style.display, '');
});

test('new answer selection anchors to the text even when reference media changes the card height', async () => {
    const captures = [];
    for (const cardHeight of [900, 1600]) {
        const body = { getBoundingClientRect: () => ({ left: 120, top: -320, width: 600, height: 800 }) };
        const panel = {
            getBoundingClientRect: () => ({ left: 100, top: 80 }),
            querySelector: selector => ({
                '[data-book-answer-anchor]': body,
                '.result-inner': { getBoundingClientRect: () => ({ left: 120, top: -400, width: 1000, height: cardHeight }) },
                '.result-content': { scrollTop: 500, getBoundingClientRect: () => ({ top: 80 }) },
            })[selector],
        };
        await handler('handleGradingCaptureEnd', {
            panelStack: [{ type: 'grading', sourcePageNumbers: [1] }], activePanelIndex: 0,
            gradingPanelRef: { current: panel }, isGradingCapturingRef: { current: true },
            gradingCaptureRectRef: { current: { x: 80, y: 100, width: 120, height: 80 } },
            getResultCaptureGeometry: handler('getResultCaptureGeometry', {}),
            captureResultPage: async element => {
                assert.equal(element, body);
                return { toDataURL: () => 'text-answer-image' };
            },
            crypto: { randomUUID: () => 'followup' },
            pushPanel: value => captures.push(value),
            setIsGradingCaptureMode() {}, setGradingCaptureRect() {}, console,
        })();
    }
    assert.equal(captures.length, 2);
    assert.deepEqual({ ...captures[0].imageFocusRegion }, { ...captures[1].imageFocusRegion });
    assert.equal(captures[0].pageDisplayWidth, 600);
    assert.equal(captures[0].pageScrollTop, 400);
    assert.deepEqual(Array.from(Object.values(captures[0].imageFocusRegion)), [0.1, 0.625, 0.2, 0.1]);
});

test('reopening a teacher follow-up restores its full-paper focus and viewport', async () => {
    const root = { id: 'root', pdfId: 'book', regions: [], steps: [
        { id: 'root-answer', type: 'answer', source: 'pdf', sourcePageNumbers: [1] },
        { id: 'root-result', type: 'grading', sourcePageNumbers: [1], result: { problems: [] } },
    ] };
    const region = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 };
    const child = { id: 'child', pdfId: 'book', parentTraceId: 'root', parentStepId: 'root-result',
        regions: [], resultRegion: region, steps: [
            { id: 'child-answer', type: 'answer', source: 'grading', sourcePageNumbers: [1],
                layoutMode: 'book-result-focus', imageFocusRegion: region,
                pageDisplayWidth: 1000, pageScrollTop: 480, answerTexts: [{ text: 'なぜですか？' }] },
        ] };
    let panels, activeIndex;
    await handler('openStudyTrace', {
        pdfId: 'book', pendingQuestionWritesRef: { current: new Map() },
        getPDFStudyTrace: async id => id === 'root' ? root : child,
        getPDFStudyAsset: async () => ({}), blobToDataUrl: async () => 'full-answer-image',
        setPanelStack: value => { panels = value; }, setActivePanelIndex: value => { activeIndex = value; },
        setIsSelectionMode() {}, setIsGradingCaptureMode() {}, setSelectionRect() {},
        addStatusMessage: message => assert.fail(message), console,
    })('child');
    assert.equal(activeIndex, 3);
    assert.equal(panels[3].fullPageQuestion, true);
    assert.equal(panels[3].focusRegion, undefined);
    assert.equal(panels[3].imageFocusRegion, region);
    assert.equal(panels[3].pageDisplayWidth, 1000);
    assert.equal(panels[3].pageScrollTop, 480);
    assert.equal(panels[3].initialTexts[0].text, 'なぜですか？');
});

test('the question canvas keeps the original paper size and fades only outside the focus', () => {
    const region = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 };
    for (const pixelRatio of [1, 2]) {
        const images = [], fills = [], outlines = [];
        const bg = { getContext: () => ({
            drawImage: (...args) => images.push(args.slice(1)),
            fillRect: (...args) => fills.push(args),
            strokeRect: (...args) => outlines.push(args), setLineDash() {},
        }) };
        const drawing = { getContext: () => ({ clearRect() {} }) };
        const constants = Object.fromEntries(['SIDE_MARGIN', 'TOP_MARGIN', 'BOTTOM_MARGIN',
            'MIN_IMAGE_WIDTH', 'BOOK_PAGE_WIDTH', 'BOOK_WRITING_WIDTH']
            .map(name => [name, handler(name, {}, 'AnswerPanel')]));
        handler('initCanvas', {
            ...constants, bgCanvasRef: { current: bg }, drawCanvasRef: { current: drawing },
            writingBoundsRef: { current: null }, historyRef: { current: [] },
            fullPageQuestion: true, imageFocusRegion: region, pageDisplayWidth: 1000,
            setCanUndo() {}, onCanUndoChange: undefined, console: { log() {} },
        }, 'AnswerPanel')({ naturalWidth: 1000 * pixelRatio, naturalHeight: 800 * pixelRatio }, region);
        assert.deepEqual([bg.width, bg.height, drawing.width, drawing.height], [1000, 800, 1000, 800]);
        assert.deepEqual(images, [[0, 0, 1000, 800]]);
        assert.deepEqual(outlines, [[200, 240, 400, 160]]);
        assert.deepEqual(fills.slice(1), [
            [0, 0, 1000, 240], [0, 400, 1000, 400], [0, 240, 200, 160], [600, 240, 400, 160],
        ]);
    }
});

test('an image focus loads the whole answer image and preserves the scrolled view', async () => {
    const region = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 };
    let loaded, pan;
    await handler('restore', {
        Image: class { set src(value) { this.source = value; queueMicrotask(() => this.onload()); } },
        pdfContext: undefined, imageFocusRegion: region, questionImage: 'full-answer-image',
        initialDrawing: undefined, initialTexts: [], cancelled: false,
        initCanvas: (image, focus) => { loaded = [image.source, focus]; },
        bgCanvasRef: { current: { width: 1000 } }, containerRef: { current: { clientWidth: 1032 } },
        textAnnotationsRef: { current: [] }, fullPageQuestion: true, pageScrollTop: 480,
        setTextAnnotations() {}, setZoom() {}, setIsReady() {},
        setPanOffset: value => { pan = value; }, console,
    }, 'AnswerPanel')();
    assert.equal(loaded[0], 'full-answer-image');
    assert.equal(loaded[1], region);
    assert.deepEqual(Array.from(Object.values(pan)), [0, -480]);
});

test('asking again from an earlier question replaces the later saved branch', async () => {
    const appended = [];
    const panels = [];
    const noop = () => {};
    const run = handler('confirmAndGrade', {
        setIsGrading: noop, setGradingError: noop, setBookAgentStatus: noop, addStatusMessage: noop,
        panelStack: [{ type: 'answer', traceId: 'trace', stepId: 'answer-original', sourcePageNumbers: [2] }],
        activePanelIndex: 0,
        answerPanelRef: { current: { getDrawingBlob: async () => null } },
        crypto: { randomUUID: () => 'replacement' },
        compressImageDataUrl: async value => value,
        Image: class {
            width = 100; height = 100;
            set src(_) { queueMicrotask(() => this.onload()); }
        },
        selectedModel: 'default', includeLaterPages: false, numPages: 10, pageA: 1,
        readBookQuestion: async () => 'なぜですか？',
        bookIndex: { textPageCount: 0, answerContextRequest: async () => { throw new Error('AI has not requested context'); } },
        askBookQuestion: async () => ({ success: true, result: { pageType: 'book-question', problems: [] } }),
        appendPDFStudyStep: async (...args) => appended.push(args),
        getPDFStudyTrace: async () => ({ id: 'trace', steps: [{ id: 'answer-original', type: 'answer' }] }),
        setStudyTraces: noop,
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
