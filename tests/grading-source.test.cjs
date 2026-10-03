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
        setIsGrading: noop, setGradingError: noop, addStatusMessage: noop,
        panelStack: [{ type: 'answer', sourcePageNumbers: [5] }], activePanelIndex: 0,
        crypto: { randomUUID: () => 'test' },
        compressImageDataUrl: async value => value,
        Image: class {
            width = 100; height = 100;
            set src(_) { queueMicrotask(() => this.onload()); }
        },
        selectedModel: 'default',
        readBookQuestion: async () => 'この箇所の意味は？',
        bookIndex: { searchBook: async (_, page) => {
            requestedPages.push(page);
            return { passages: [{ pageNumber: page, text: '本文' }], indexedPages: 3 };
        } },
        askBookQuestion: async () => ({
            success: true,
            result: { pageType: 'book-question', problems: [], overallComment: '説明' },
        }),
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
    const run = handler('navigateToPanel', {
        panelStack: [{ type: 'pdf' }, { type: 'answer' }],
        setIsSelectionMode: value => updates.push(['selection', value]),
        setIsDrawingMode: value => updates.push(['pen', value]),
        setIsEraserMode: value => updates.push(['eraser', value]),
        setIsTextMode: value => updates.push(['text', value]),
        setSelectionRect: value => updates.push(['rect', value]),
        setIsHoveringStudyTrace() {}, cancelGradingCapture() {},
        setActivePanelIndex: value => updates.push(['panel', value]),
    });
    run(0);
    assert.deepEqual(updates.map(([key, value]) => [key, value]), [
        ['selection', true], ['rect', null], ['pen', false], ['eraser', false],
        ['text', false], ['panel', 0],
    ]);
});

test('typed questions are sent directly without handwriting recognition', async () => {
    let asked;
    const run = handler('confirmAndGrade', {
        setIsGrading() {}, setGradingError() {}, addStatusMessage() {},
        panelStack: [{ type: 'answer', sourcePageNumbers: [4] }],
        activePanelIndex: 0, compressImageDataUrl: async value => value,
        Image: class {
            width = 100; height = 100;
            set src(_) { queueMicrotask(() => this.onload()); }
        },
        crypto: { randomUUID: () => 'result' },
        selectedModel: 'default', includeLaterPages: false, numPages: 10, pageA: 4,
        readBookQuestion: async () => { throw new Error('handwriting recognition should not run'); },
        bookIndex: { searchBook: async () => ({ passages: [], indexedPages: 0 }) },
        askBookQuestion: async body => {
            asked = body;
            return { success: true, result: { pageType: 'book-question', problems: [] } };
        },
        pushPanel() {}, console,
    });
    await run('image', [4], '著者はなぜそう考えた？');
    assert.equal(asked.question, '著者はなぜそう考えた？');
    assert.equal(asked.currentPage, 4);
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
        selectedModel: 'default', includeLaterPages: false, numPages: 10, pageA: 1,
        readBookQuestion: async () => 'なぜですか？',
        bookIndex: { searchBook: async () => ({ passages: [], indexedPages: 0 }) },
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
