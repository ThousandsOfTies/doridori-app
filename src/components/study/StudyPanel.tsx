
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_MODEL_ID } from '@home-teacher/common/constants/grading'
import { GradingResponseResult, getAvailableModels, ModelInfo } from '@home-teacher/common/services/api'
import GradingResult from './GradingResult'
import AnswerPanel, { AnswerPanelHandle } from './AnswerPanel'
import { flushDrawingSaves, getAllDrawings, getAllTextAnnotations, updatePDFRecord, getAllSNSLinks, SNSLinkRecord, PDFFileRecord, scheduleDrawingSave, saveTextAnnotation, PDFStudyRegion, PDFStudyTraceRecord, PDFStudyStep, PDFStudyAnswerState, createPDFStudyTrace, appendPDFStudyStep, getPDFStudyTrace, getPDFStudyTracesByPdfId, getPDFStudyAsset, savePDFStudyDrawing, savePDFStudyAnswerTexts, dataUrlToBlob, blobToDataUrl } from '@home-teacher/common/utils/indexedDB'
import { DrawingPath } from '@thousands-of-ties/drawing-common'
import { PDFPane, PDFPaneHandle } from '@home-teacher/common/components/study/PDFPane'
import { StudyToolbar } from './StudyToolbar'
import { usePDFRenderer } from '@home-teacher/common/hooks/pdf/usePDFRenderer'
import { useWheelPanelNavigation } from '@home-teacher/common/hooks/useWheelPanelNavigation'
import { PanelForwardButton } from '@home-teacher/common/components/study/PanelForwardButton'
import { StudyRegionMarker } from '@home-teacher/common/components/study/StudyRegionMarker'
import { getPanelWheelDestination } from '@home-teacher/common/utils/panelWheelNavigation'
import './StudyPanel.css'
import { compressImageDataUrl } from '@home-teacher/common/utils/image'
import { useAuth } from '@home-teacher/common/contexts/AuthContext'
import { askBookQuestion, readBookQuestion } from '../../book/bookKnowledgeApi'
import { saveBookReferenceMedia } from '../../book/bookReferenceMediaStorage'
import type { BookQuestionResult, ReferenceMediaResult } from '../../book/bookReferenceMedia'
import { useBookIndex } from '../../book/useBookIndex'
import { BookCoverThumbnail } from '../book/BookCoverThumbnail'
import { BookReferenceOptions } from '../book/BookReferenceOptions'
import { useStudyTraceUndo } from '@home-teacher/common/hooks/useStudyTraceUndo'
import { deletePDFStudyTraceTree, restorePDFStudyTraceDeletion } from '@home-teacher/common/utils/indexedDB'

// テキストアノテーションの型定義
export type TextDirection = 'horizontal' | 'vertical-rl' | 'vertical-lr'
export interface TextAnnotation {
  id: string
  x: number // 正規化座標 (0-1)
  y: number // 正規化座標 (0-1)
  text: string
  fontSize: number // ピクセル
  color: string
  direction: TextDirection
}

interface StudyPanelProps {
  pdfRecord: PDFFileRecord
  pdfId: string
  onBack?: () => void
  onOpenSettings?: () => void
}

const SPLIT_RATIO_STORAGE_KEY = 'doridori.splitRatio'

type ResultRegion = { x: number; y: number; width: number; height: number }
type BookStudyStep = PDFStudyStep & {
  layoutMode?: 'full-page-focus' | 'book-page' | 'book-text' | 'book-result-focus'
  pageDisplayWidth?: number
  pageScrollTop?: number
  imageFocusRegion?: ResultRegion
  questionText?: string
}
type BookStudyTrace = PDFStudyTraceRecord & {
  parentTraceId?: string
  parentStepId?: string
  resultRegion?: ResultRegion
}

const getResultCaptureGeometry = (
  selection: ResultRegion,
  panelRect: Pick<DOMRect, 'left' | 'top'>,
  innerRect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
) => {
  const innerX = innerRect.left - panelRect.left
  const innerY = innerRect.top - panelRect.top
  const x = Math.max(selection.x, innerX)
  const y = Math.max(selection.y, innerY)
  const width = Math.min(selection.x + selection.width, innerX + innerRect.width) - x
  const height = Math.min(selection.y + selection.height, innerY + innerRect.height) - y
  if (width < 10 || height < 10) return null
  return {
    x, y, width, height,
    region: { x: (x - innerX) / innerRect.width, y: (y - innerY) / innerRect.height,
      width: width / innerRect.width, height: height / innerRect.height },
  }
}

const getResultViewportBounds = (panel: HTMLElement) => {
  const viewport = panel.querySelector<HTMLElement>('.result-content')
  if (!viewport) return null
  const bounds = viewport.getBoundingClientRect()
  const left = bounds.left + viewport.clientLeft
  const top = bounds.top + viewport.clientTop
  // clientLeft also excludes a left-side scrollbar in RTL layouts.
  return { left, top, right: left + viewport.clientWidth, bottom: top + viewport.clientHeight }
}

const captureResultPage = async (element: HTMLElement) => {
  const html2canvas = (await import('html2canvas')).default
  const bounds = element.getBoundingClientRect()
  return html2canvas(element, {
    scale: window.devicePixelRatio || 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    width: bounds.width,
    height: bounds.height,
  })
}

type PanelData =
  | { type: 'pdf' }
  | { type: 'answer'; questionImage: string; sourcePageNumbers: number[]; source?: 'grading'; traceId?: string; stepId?: string; initialDrawing?: Blob | null; initialTexts?: PDFStudyAnswerState['texts']; focusRegion?: PDFStudyRegion; imageFocusRegion?: ResultRegion; pageDisplayWidth?: number; pageScrollTop?: number; fullPageQuestion?: boolean }
  | { type: 'grading'; result: GradingResponseResult; modelName: string | null; responseTime: number | null; sourcePageNumbers: number[]; traceId?: string; stepId?: string }

const StudyPanel = ({ pdfRecord, pdfId, onBack, onOpenSettings }: StudyPanelProps) => {
  const { t } = useTranslation()
  // Refs
  const paneARef = useRef<PDFPaneHandle>(null)
  const paneBRef = useRef<PDFPaneHandle>(null)
  const panelNavigationRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const answerPanelRef = useRef<AnswerPanelHandle>(null)
  const pendingQuestionWritesRef = useRef(new Map<string, Promise<void>>())
  const pendingStudyDrawingWritesRef = useRef(new Set<Promise<void>>())
  const deletedTraceIdsRef = useRef(new Set<string>())
  const handledTracePointerRef = useRef(false)
  const traceUndo = useStudyTraceUndo(pdfId, {
    remove: (id: string) => deletePDFStudyTraceTree(pdfId, id),
    restore: restorePDFStudyTraceDeletion,
  })
  const gradingPanelRef = useRef<HTMLDivElement>(null)
  const isGradingCapturingRef = useRef(false)
  const gradingCaptureStartRef = useRef<{ x: number; y: number } | null>(null)
  const gradingCaptureRectRef = useRef<ResultRegion | null>(null)
  const [gradingCaptureRect, setGradingCaptureRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [isGradingCaptureMode, setIsGradingCaptureMode] = useState(false)

  // Layout State
  const [isSplitView, setIsSplitView] = useState(false)
  const [activeTab, setActiveTab] = useState<'A' | 'B'>('B')
  // PDFを開くたびに選択跡を表示し、非表示への切替は今回の閲覧中だけ適用する。
  const [showStudyMarkers, setShowStudyMarkers] = useState(true)

  const toggleStudyMarkers = () => setShowStudyMarkers(visible => !visible)

  // Split Ratio
  const [splitRatio, setSplitRatio] = useState(() => {
    const saved = localStorage.getItem(SPLIT_RATIO_STORAGE_KEY)
    const parsed = saved === null ? NaN : Number(saved)
    return Number.isFinite(parsed) ? Math.max(0.2, Math.min(0.8, parsed)) : 0.5
  })
  const [isResizing, setIsResizing] = useState(false)
  const splitContainerRef = useRef<HTMLDivElement>(null)

  // Page State
  const [pageA, setPageA] = useState(pdfRecord.lastPageNumberA || 1)
  const [pageB, setPageB] = useState(pdfRecord.lastPageNumberB || 1)

  // PDF Retry
  const [retryCount, setRetryCount] = useState(0)

  // PDF Document Loading
  const { pdfDoc, numPages, isLoading, error: pdfError } = usePDFRenderer(pdfRecord, {
    retryTrigger: retryCount,
    onLoadSuccess: (pages) => {
      // PDF Loaded
      // ページ番号の整合性チェック（総ページ数を超えていたら1に戻す）
      if (pageA > pages) {
        console.warn(`⚠️ ページ番号補正: A面 ${pageA} -> 1 (総ページ数: ${pages})`)
        setPageA(1)
        updatePDFRecord(pdfRecord.id, { lastPageNumberA: 1 }).catch(() => { })
      }
      if (pageB > pages) {
        console.warn(`⚠️ ページ番号補正: B面 ${pageB} -> 1 (総ページ数: ${pages})`)
        setPageB(1)
        updatePDFRecord(pdfRecord.id, { lastPageNumberB: 1 }).catch(() => { })
      }
    },
    onLoadError: (err) => {
      console.error(err)
    }
  })
  const bookIndex = useBookIndex(pdfId, pdfDoc, numPages, pdfRecord.textInspection)
  const [showBookReferenceOptions, setShowBookReferenceOptions] = useState(false)
  const [includeLaterPages, setIncludeLaterPages] = useState(false)

  // Grading State (Additional)
  const [gradingError, setGradingError] = useState<string | null>(null)

  // AI Model State
  const [selectedModel, setSelectedModel] = useState<string>('default')
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [defaultModelName, setDefaultModelName] = useState<string>(DEFAULT_MODEL_ID)

  useEffect(() => {
    getAvailableModels()
      .then(response => {
        if (response.models) {
          setAvailableModels(response.models.filter(m => m.id !== 'default' && m.id !== response.default))
        }
        if (response.default) {
          setDefaultModelName(response.default)
        }
      })
      .catch(err => console.error('Failed to load models:', err))
  }, [])

  // Selection State
  const [isSelectionMode, setIsSelectionMode] = useState(true)
  const [selectionRect, setSelectionRect] = useState<{ x: number, y: number, width: number, height: number } | null>(null)
  const isSelectingRef = useRef(false)
  const selectionStartRef = useRef<{ x: number, y: number } | null>(null)
  const [isGrading, setIsGrading] = useState(false)
  const [bookAgentStatus, setBookAgentStatus] = useState('')

  // Tool State
  const [isDrawingMode, setIsDrawingMode] = useState(false)
  const [isEraserMode, setIsEraserMode] = useState(false)
  const [isTextMode, setIsTextMode] = useState(false)
  const [penColor, setPenColor] = useState('#FF0000') // Updated to match bottom block default
  const [penSize, setPenSize] = useState(3)
  const [eraserSize, setEraserSize] = useState(50)

  // Text State
  const [textFontSize, setTextFontSize] = useState(16)
  const [textDirection, setTextDirection] = useState<TextDirection>('horizontal')
  const [editingText, setEditingText] = useState<{
    pageNum: number
    x: number
    y: number
    screenX: number
    screenY: number
    existingId?: string
    initialText?: string
  } | null>(null)
  const [textAnnotations, setTextAnnotations] = useState<Map<number, TextAnnotation[]>>(new Map())

  // SNS State
  const [snsLinks, setSnsLinks] = useState<SNSLinkRecord[]>([])
  const { userData } = useAuth()
  const snsTimeLimit = userData?.snsRewardMinutes || 60

  useEffect(() => {
    const loadSNSData = async () => {
      try {
        const links = await getAllSNSLinks()
        setSnsLinks(links)
      } catch (error) {
        console.error('Failed to load SNS data:', error)
      }
    }
    loadSNSData()
  }, [])

  // Drawing State
  const [drawingPaths, setDrawingPaths] = useState<Map<number, DrawingPath[]>>(new Map())
  const pendingDrawingWritesRef = useRef(new Map<number, string>())

  useEffect(() => {
    pendingDrawingWritesRef.current.forEach((data, page) => scheduleDrawingSave(pdfId, page, data))
    pendingDrawingWritesRef.current.clear()
  }, [drawingPaths, pdfId])

  useEffect(() => {
    const flushPendingDrawings = () => {
      pendingDrawingWritesRef.current.forEach((data, page) => scheduleDrawingSave(pdfId, page, data))
      pendingDrawingWritesRef.current.clear()
      void flushDrawingSaves(pdfId)
    }
    window.addEventListener('pagehide', flushPendingDrawings)
    return () => {
      window.removeEventListener('pagehide', flushPendingDrawings)
      flushPendingDrawings()
    }
  }, [pdfId])
  const EMPTY_PATHS: DrawingPath[] = useMemo(() => [], [])
  const drawingPathsA = useMemo(() => drawingPaths.get(pageA) ?? EMPTY_PATHS, [drawingPaths, pageA, EMPTY_PATHS])

  // Load Drawings Effect
  useEffect(() => {
    const loadDrawings = async () => {
      try {
        const drawings = await getAllDrawings(pdfId)

        const newMap = new Map<number, DrawingPath[]>()
        for (const [pageStr, pathsJson] of Object.entries(drawings)) {
          const page = parseInt(pageStr, 10)
          const paths = JSON.parse(pathsJson) as DrawingPath[]
          if (paths.length > 0) {
            newMap.set(page, paths)
          }
        }

        if (newMap.size > 0) {
          setDrawingPaths(newMap)
        }
      } catch (e) {
        console.error('Failed to load drawings:', e)
      }
    }
    loadDrawings()
  }, [pdfId])

  // Load Text Annotations Effect
  useEffect(() => {
    const loadTextAnnotations = async () => {
      try {
        const savedAnnotations = await getAllTextAnnotations(pdfId)
        const newMap = new Map<number, TextAnnotation[]>()
        for (const [pageStr, annotationsJson] of Object.entries(savedAnnotations)) {
          const page = parseInt(pageStr, 10)
          const annotations = JSON.parse(annotationsJson as string) as TextAnnotation[]
          if (annotations.length > 0) {
            newMap.set(page, annotations)
          }
        }
        if (newMap.size === 0) return
        setTextAnnotations(newMap)
      } catch (e) {
      }
    }
    loadTextAnnotations()
  }, [pdfId])


  // Panel stack state
  const [panelStack, setPanelStack] = useState<PanelData[]>([{ type: 'pdf' }])
  const [activePanelIndex, setActivePanelIndex] = useState(0)
  const [studyTraces, setStudyTraces] = useState<BookStudyTrace[]>([])
  const [isHoveringStudyTrace, setIsHoveringStudyTrace] = useState(false)
  const undoTrace = useMemo(() => {
    const traces = (traceUndo.undoSnapshot?.traces ?? []) as BookStudyTrace[]
    const ids = new Set(traces.map(trace => trace.id))
    return traces.find(trace => !trace.parentTraceId || !ids.has(trace.parentTraceId))
  }, [traceUndo.undoSnapshot])
  const pdfRegionMarkers = useMemo(() => showStudyMarkers
    ? [...studyTraces.flatMap(trace => trace.regions.map(region => ({
        id: trace.id, region, completed: trace.steps.some(step => step.type === 'grading'),
      }))), ...(undoTrace && !undoTrace.parentTraceId
        ? undoTrace.regions.map(region => ({ id: undoTrace.id, region, completed: false, undo: true })) : [])]
    : [], [showStudyMarkers, studyTraces, undoTrace])

  useEffect(() => {
    let active = true
    getPDFStudyTracesByPdfId(pdfId).then(traces => {
      if (active) setStudyTraces(traces as BookStudyTrace[])
    }).catch(error => console.error('質問の記録を読み込めませんでした:', error))
    return () => { active = false }
  }, [pdfId])

  const getPanelLabel = (panel: PanelData): string => {
    switch (panel.type) {
      case 'pdf': return 'PDF'
      case 'answer': return '質問記入'
      case 'grading': return panel.result.pageType === 'book-question' ? '先生の回答' : '採点結果'
    }
  }

  const pushPanel = (panel: PanelData) => {
    setPanelStack(prev => [...prev.slice(0, activePanelIndex + 1), panel])
    setActivePanelIndex(prev => prev + 1)
  }

  const handleReferenceMediaResolved = async (panel: Extract<PanelData, { type: 'grading' }>, media: ReferenceMediaResult) => {
    const answer = panel.result.overallComment || panel.result.rawResponse || ''
    const result: BookQuestionResult = { ...panel.result, referenceMedia: media }
    setPanelStack(previous => previous.map(item => item === panel ||
      item.type === 'grading' && item.traceId === panel.traceId && item.stepId === panel.stepId &&
      !!panel.traceId && (item.result.overallComment || item.result.rawResponse || '') === answer
      ? { ...item, result } : item))
    if (!panel.traceId || !panel.stepId || deletedTraceIdsRef.current.has(panel.traceId)) return
    try {
      await saveBookReferenceMedia(import.meta.env.VITE_INDEXED_DB_NAME, panel.traceId, panel.stepId, answer, media)
      const updated = await getPDFStudyTrace(panel.traceId) as BookStudyTrace | null
      if (updated) setStudyTraces(previous => previous.map(trace => trace.id === panel.traceId ? updated : trace))
    } catch (error) {
      console.error('参考資料の保存に失敗しました:', error)
    }
  }

  const queueQuestionTextSave = (traceId: string, stepId: string, texts: PDFStudyAnswerState['texts']) => {
    if (deletedTraceIdsRef.current.has(traceId)) return
    const key = `${traceId}:${stepId}`
    const previous = pendingQuestionWritesRef.current.get(key) ?? Promise.resolve()
    const pending = previous.catch(() => {}).then(() => savePDFStudyAnswerTexts(traceId, stepId, texts))
    pendingQuestionWritesRef.current.set(key, pending)
    void pending.catch(error => {
      console.error('質問文を保存できませんでした:', error)
    }).finally(() => {
      if (pendingQuestionWritesRef.current.get(key) === pending) pendingQuestionWritesRef.current.delete(key)
    })
  }

  const queueStudyDrawingSave = (traceId: string, stepId: string, drawing: Blob) => {
    if (deletedTraceIdsRef.current.has(traceId)) return
    const pending = savePDFStudyDrawing(traceId, stepId, drawing)
    pendingStudyDrawingWritesRef.current.add(pending)
    void pending.catch(error => {
      if (deletedTraceIdsRef.current.has(traceId)) return
      console.error('質問の書き込みを保存できませんでした:', error)
    }).finally(() => pendingStudyDrawingWritesRef.current.delete(pending))
  }

  const openStudyTrace = async (traceId: string) => {
    if (traceUndo.busy || deletedTraceIdsRef.current.has(traceId)) return
    try {
      await Promise.all([...pendingQuestionWritesRef.current.values()].map(write => write.catch(() => {})))
      const ancestry: BookStudyTrace[] = []
      const visited = new Set<string>()
      let currentId: string | undefined = traceId
      while (currentId) {
        if (visited.has(currentId)) throw new Error('質問履歴の接続が不正です')
        visited.add(currentId)
        const trace = await getPDFStudyTrace(currentId) as BookStudyTrace | null
        if (!trace || trace.pdfId !== pdfId) throw new Error('質問の記録が見つかりません')
        ancestry.unshift(trace)
        currentId = trace.parentTraceId
      }
      const panels: PanelData[] = [{ type: 'pdf' }]
      const appendPanels = async (trace: BookStudyTrace, throughStepId?: string, stopAtBranches = false) => {
        let end = throughStepId ? trace.steps.findIndex(step => step.id === throughStepId) : trace.steps.length - 1
        if (end < 0) throw new Error('質問履歴の接続が不正です')
        if (stopAtBranches) {
          const branchIndex = trace.steps.findIndex(step => step.type === 'grading' && step.result &&
            studyTraces.filter(child => child.parentTraceId === trace.id && child.parentStepId === step.id).length > 1)
          if (branchIndex >= 0) end = Math.min(end, branchIndex)
        }
        const restored = await Promise.all(trace.steps.slice(0, end + 1).map(async (step): Promise<PanelData | null> => {
          if (step.type === 'grading') {
            return step.result ? {
              type: 'grading', result: step.result, modelName: step.modelName ?? null,
              responseTime: step.responseTime ?? null, sourcePageNumbers: step.sourcePageNumbers,
              traceId: trace.id, stepId: step.id,
            } : null
          }
          const bookStep = step as BookStudyStep
          const layoutMode = bookStep.layoutMode
          const fullPageQuestion = layoutMode === 'book-page' || layoutMode === 'book-text' || layoutMode === 'book-result-focus'
          const [question, drawing] = await Promise.all([
            getPDFStudyAsset(trace.id, step.id, 'question'),
            getPDFStudyAsset(trace.id, step.id, 'drawing'),
          ])
          if (!question) throw new Error('質問画像が見つかりません')
          const oldQuestionText = bookStep.questionText
          const initialTexts = step.answerTexts ?? (oldQuestionText?.trim() ? [{
            id: `legacy_${step.id}`, x: 80, y: 80, text: oldQuestionText,
            fontSize: 20, color: '#1e293b', direction: 'horizontal' as const,
          }] : [])
          return {
            type: 'answer', questionImage: await blobToDataUrl(question), initialDrawing: drawing,
            sourcePageNumbers: step.sourcePageNumbers, source: step.source === 'grading' ? 'grading' : undefined,
            focusRegion: step.source === 'pdf' && (layoutMode === 'full-page-focus' || fullPageQuestion) && trace.regions.length === 1
              ? trace.regions[0] : undefined,
            imageFocusRegion: bookStep.imageFocusRegion,
            pageDisplayWidth: bookStep.pageDisplayWidth,
            pageScrollTop: bookStep.pageScrollTop,
            fullPageQuestion, initialTexts,
            traceId: trace.id, stepId: step.id,
          }
        }))
        panels.push(...restored.filter((panel): panel is PanelData => panel !== null))
      }
      const restorePDFRoute = ancestry.length === 1
      let questionPanelIndex = 1
      for (let index = 0; index < ancestry.length; index++) {
        if (index === ancestry.length - 1) questionPanelIndex = panels.length
        await appendPanels(ancestry[index], ancestry[index + 1]?.parentStepId, restorePDFRoute)
      }
      // A PDF mark restores its unbranched route. Answer marks still open one question.
      let tip = ancestry[ancestry.length - 1]
      while (restorePDFRoute && panels[panels.length - 1]?.type === 'grading') {
        const last = panels[panels.length - 1]
        const children = studyTraces.filter(child => child.parentTraceId === tip.id &&
          child.parentStepId === (last.type === 'grading' ? last.stepId : undefined))
        if (children.length !== 1 || visited.has(children[0].id)) break
        const child = await getPDFStudyTrace(children[0].id) as BookStudyTrace | null
        if (!child || child.pdfId !== pdfId) throw new Error('続きの質問が見つかりません')
        tip = child
        visited.add(tip.id)
        await appendPanels(tip, undefined, true)
      }
      setPanelStack(panels)
      // Keep the restored route in breadcrumbs and show the question immediately after its source.
      setActivePanelIndex(questionPanelIndex)
      setIsSelectionMode(false)
      setIsGradingCaptureMode(false)
      setSelectionRect(null)
    } catch (error) {
      console.error('質問の記録を開けませんでした:', error)
    }
  }

  const getStudyTraceControlAtPoint = (clientX: number, clientY: number) => {
    const control = document.elementsFromPoint(clientX, clientY)
      .find(element => element.hasAttribute('data-study-trace-id') || element.hasAttribute('data-study-trace-delete-id') ||
        element.hasAttribute('data-study-trace-undo-id'))
    if (!control) return null
    const deleteId = control.getAttribute('data-study-trace-delete-id')
    const undoId = control.getAttribute('data-study-trace-undo-id')
    const id = undoId || deleteId || control.getAttribute('data-study-trace-id')
    return id ? { id, action: undoId ? 'undo' : deleteId ? 'delete' : 'open' } : null
  }

  const getStudyTraceAtPoint = (clientX: number, clientY: number): string | null =>
    getStudyTraceControlAtPoint(clientX, clientY)?.id ?? null

  const handleTraceOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    handledTracePointerRef.current = false
    if (event.button !== 0) return
    const control = getStudyTraceControlAtPoint(event.clientX, event.clientY)
    if (!control) return
    event.preventDefault()
    handledTracePointerRef.current = true
    isSelectingRef.current = false
    isGradingCapturingRef.current = false
    if (control.action === 'undo') {
      if (!isGrading) void undoStudyTraceDeletion()
    } else if (control.action === 'delete') void deleteStudyTrace(control.id)
    else void openStudyTrace(control.id)
  }

  const handleTraceOverlayPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    setIsHoveringStudyTrace(event.buttons === 0 && !isSelectingRef.current &&
      getStudyTraceAtPoint(event.clientX, event.clientY) !== null)
  }

  const handleSelectionStart = (e: React.MouseEvent) => {
    // Only left click
    if (e.button !== 0) return
    if (handledTracePointerRef.current) return
    if (getStudyTraceAtPoint(e.clientX, e.clientY)) return

    // Get relative position within the container
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    isSelectingRef.current = true
    selectionStartRef.current = { x, y }
    setSelectionRect({ x, y, width: 0, height: 0 })
  }

  const handleSelectionMove = (e: React.MouseEvent) => {
    if (!isSelectingRef.current || !selectionStartRef.current || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const startX = selectionStartRef.current.x
    const startY = selectionStartRef.current.y

    setSelectionRect({
      x: Math.min(startX, x),
      y: Math.min(startY, y),
      width: Math.abs(x - startX),
      height: Math.abs(y - startY)
    })
  }

  /* 共通: オーバーレイでピンチズームを直接処理 */
  const overlayGestureRef = useRef<{
    type: 'selection' | 'pinch'
    targetPane: 'A' | 'B'
    startZoom: number
    startPan: { x: number, y: number }
    startDist: number
    startCenter: { x: number, y: number }
  } | null>(null)

  // タッチ位置からターゲットペインを判定
  const getTargetPane = (touchX: number): 'A' | 'B' => {
    // 非スプリットビューでは現在表示中のタブが対象
    if (!isSplitView) return activeTab

    // スプリットコンテナ内でのX位置を確認
    const splitContainer = splitContainerRef.current
    if (!splitContainer) return activeTab

    const containerRect = splitContainer.getBoundingClientRect()
    const relativeX = touchX - containerRect.left
    const splitPoint = containerRect.width * splitRatio

    return relativeX < splitPoint ? 'A' : 'B'
  }

  const getTargetPaneRef = (pane: 'A' | 'B') => {
    return pane === 'A' ? paneARef : paneBRef
  }

  const handleOverlayTouchStart = (e: React.TouchEvent, onSingleTouch?: (x: number, y: number) => void) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    if (e.touches.length >= 2) {
      // 2本指: ピンチズーム開始
      e.preventDefault()
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
      const center = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2
      }

      // タッチ中心からターゲットペインを判定
      const targetPane = getTargetPane(center.x)
      const paneRef = getTargetPaneRef(targetPane)

      // 現在のズーム/パン状態を取得
      const currentZoom = paneRef.current?.getZoom() ?? 1
      const currentPan = paneRef.current?.getPanOffset() ?? { x: 0, y: 0 }

      overlayGestureRef.current = {
        type: 'pinch',
        targetPane,
        startZoom: currentZoom,
        startPan: { ...currentPan },
        startDist: dist,
        startCenter: center
      }

      // 選択をキャンセル
      isSelectingRef.current = false
      selectionStartRef.current = null
      return
    }

    if (e.touches.length !== 1) return

    // 1本指: 選択開始 or カスタム処理
    overlayGestureRef.current = null
    if (onSingleTouch) {
      const x = e.touches[0].clientX - rect.left
      const y = e.touches[0].clientY - rect.top
      onSingleTouch(x, y)
    }
  }

  const handleOverlayTouchMove = (e: React.TouchEvent, onSingleTouchMove?: (x: number, y: number) => void) => {
    if (e.touches.length >= 2 && overlayGestureRef.current?.type === 'pinch') {
      // ピンチズーム処理
      e.preventDefault()
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
      const center = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2
      }

      const { targetPane, startZoom, startPan, startDist, startCenter } = overlayGestureRef.current
      const paneRef = getTargetPaneRef(targetPane)
      const paneRect = paneRef.current?.getContainerRect()
      if (!paneRect) return

      // 新しいズームレベルを計算
      const scale = dist / startDist
      const newZoom = Math.min(Math.max(startZoom * scale, 0.1), 5.0)

      // ピンチ中心を基準にパン調整
      const startCenterRelX = startCenter.x - paneRect.left
      const startCenterRelY = startCenter.y - paneRect.top
      const contentX = (startCenterRelX - startPan.x) / startZoom
      const contentY = (startCenterRelY - startPan.y) / startZoom
      const centerRelX = center.x - paneRect.left
      const centerRelY = center.y - paneRect.top
      const newPanX = centerRelX - (contentX * newZoom)
      const newPanY = centerRelY - (contentY * newZoom)

      // 対象のPDFPaneに適用
      paneRef.current?.setZoomValue(newZoom)
      paneRef.current?.setPanOffsetValue({ x: newPanX, y: newPanY })
      return
    }

    if (e.touches.length === 1 && onSingleTouchMove) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = e.touches[0].clientX - rect.left
      const y = e.touches[0].clientY - rect.top
      onSingleTouchMove(x, y)
    }
  }

  const handleOverlayTouchEnd = (e: React.TouchEvent, onTouchEnd?: () => void) => {
    if (e.touches.length === 0) {
      overlayGestureRef.current = null
      if (onTouchEnd) onTouchEnd()
    }
  }

  /* Selection Mode Touch Handlers */
  const handleTouchSelectionStart = (e: React.TouchEvent) => {
    if (handledTracePointerRef.current) return
    if (e.touches.length === 1 && getStudyTraceAtPoint(e.touches[0].clientX, e.touches[0].clientY)) return
    handleOverlayTouchStart(e, (x, y) => {
      isSelectingRef.current = true
      selectionStartRef.current = { x, y }
      setSelectionRect({ x, y, width: 0, height: 0 })
    })
  }

  const handleTouchSelectionMove = (e: React.TouchEvent) => {
    handleOverlayTouchMove(e, (x, y) => {
      if (!isSelectingRef.current || !selectionStartRef.current) return
      const startX = selectionStartRef.current.x
      const startY = selectionStartRef.current.y
      setSelectionRect({
        x: Math.min(startX, x),
        y: Math.min(startY, y),
        width: Math.abs(x - startX),
        height: Math.abs(y - startY)
      })
    })
  }

  const handleTouchSelectionEnd = async (e: React.TouchEvent) => {
    handleOverlayTouchEnd(e, async () => {
      if (!isSelectingRef.current) return
      await handleSelectionEnd()
    })
  }

  const handleSelectionEnd = async () => {
    if (!isSelectingRef.current || !selectionRect) return

    isSelectingRef.current = false

    // Check if selection is large enough
    if (selectionRect.width < 10 || selectionRect.height < 10) {
      setSelectionRect(null)
      return
    }

    // Capture Image Logic (Stitching)
    try {
      const capturedImage = await captureSelectionArea(selectionRect)
      if (capturedImage) {
        const traceId = `trace_${crypto.randomUUID()}`
        const stepId = `answer_${crypto.randomUUID()}`
        const trace: PDFStudyTraceRecord = {
          id: traceId,
          pdfId,
          createdAt: Date.now(),
          regions: capturedImage.regions,
          steps: [{ id: stepId, type: 'answer', source: 'pdf', sourcePageNumbers: capturedImage.sourcePageNumbers,
            layoutMode: 'book-page', answerTexts: [], pageDisplayWidth: capturedImage.pageDisplayWidth } as PDFStudyStep & { layoutMode: 'book-page'; pageDisplayWidth?: number }],
        }
        await createPDFStudyTrace(trace, await dataUrlToBlob(capturedImage.image))
        setStudyTraces(previous => [...previous, trace])
        pushPanel({ type: 'answer', questionImage: capturedImage.image, sourcePageNumbers: capturedImage.sourcePageNumbers,
          focusRegion: capturedImage.regions.length === 1 ? capturedImage.regions[0] : undefined,
          pageDisplayWidth: capturedImage.pageDisplayWidth,
          fullPageQuestion: true, initialTexts: [], traceId, stepId })
        setIsSelectionMode(false)
        setSelectionRect(null)
      } else {
        setSelectionRect(null)
      }
    } catch (error) {
      console.error("Capture error:", error)
      setSelectionRect(null)
    }
  }

  // 採点結果パネル用の範囲選択ハンドラ
  const handleGradingCaptureStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (e.target instanceof Element && e.target.closest(
      'button, a, input, textarea, select, summary, [contenteditable="true"], dialog, .book-reference-media, .book-context-history',
    )) return
    if (getStudyTraceAtPoint(e.clientX, e.clientY)) return
    const panel = gradingPanelRef.current
    if (!panel) return
    const viewport = getResultViewportBounds(panel)
    if (!viewport || e.clientX < viewport.left || e.clientX >= viewport.right ||
      e.clientY < viewport.top || e.clientY >= viewport.bottom) return
    const rect = panel.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    e.preventDefault()
    isGradingCapturingRef.current = true
    gradingCaptureStartRef.current = { x, y }
    gradingCaptureRectRef.current = { x, y, width: 0, height: 0 }
    setGradingCaptureRect(gradingCaptureRectRef.current)
  }

  const handleGradingCaptureMove = (e: React.MouseEvent) => {
    if (!isGradingCapturingRef.current || !gradingCaptureStartRef.current || !gradingPanelRef.current) return
    const rect = gradingPanelRef.current.getBoundingClientRect()
    const viewport = getResultViewportBounds(gradingPanelRef.current)
    if (!viewport) return
    const x = Math.max(viewport.left, Math.min(viewport.right, e.clientX)) - rect.left
    const y = Math.max(viewport.top, Math.min(viewport.bottom, e.clientY)) - rect.top
    const sx = gradingCaptureStartRef.current.x
    const sy = gradingCaptureStartRef.current.y
    gradingCaptureRectRef.current = {
      x: Math.min(sx, x),
      y: Math.min(sy, y),
      width: Math.abs(x - sx),
      height: Math.abs(y - sy)
    }
    setGradingCaptureRect(gradingCaptureRectRef.current)
  }

  const handleGradingCaptureScroll = () => {
    if (!isGradingCapturingRef.current) return
    // Scrolling changes the answer's coordinates; discard only the unfinished selection.
    isGradingCapturingRef.current = false
    gradingCaptureStartRef.current = null
    gradingCaptureRectRef.current = null
    setGradingCaptureRect(null)
  }

  const handleGradingCaptureEnd = async () => {
    const sourcePanel = panelStack[activePanelIndex]
    if (sourcePanel?.type !== 'grading') return
    const captureRect = gradingCaptureRectRef.current
    if (!isGradingCapturingRef.current || !captureRect || !gradingPanelRef.current) return
    isGradingCapturingRef.current = false

    if (captureRect.width < 10 || captureRect.height < 10) {
      gradingCaptureRectRef.current = null
      setGradingCaptureRect(null)
      return
    }

    try {
      const panel = gradingPanelRef.current
      const bodyAnchor = panel.querySelector('[data-book-answer-anchor]') as HTMLElement | null
      const resultInner = bodyAnchor || panel.querySelector('.result-inner') as HTMLElement | null
      if (!resultInner) throw new Error('回答の表示領域が見つかりません')
      const resultBounds = resultInner.getBoundingClientRect()
      const geometry = getResultCaptureGeometry(captureRect, panel.getBoundingClientRect(), resultBounds)
      if (!geometry) throw new Error('回答の内側を選択してください')
      const resultContent = panel.querySelector('.result-content') as HTMLElement | null
      const pageScrollTop = bodyAnchor && resultContent
        ? Math.max(0, resultContent.getBoundingClientRect().top - resultBounds.top)
        : resultContent?.scrollTop ?? 0
      const overlay = panel.querySelector('.grading-capture-overlay') as HTMLElement | null
      const markers = panel.querySelector('.grading-study-markers') as HTMLElement | null
      const previousOverlayDisplay = overlay?.style.display
      const previousMarkerDisplay = markers?.style.display
      let fullCanvas: HTMLCanvasElement
      try {
        if (overlay) overlay.style.display = 'none'
        if (markers) markers.style.display = 'none'
        fullCanvas = await captureResultPage(resultInner)
      } finally {
        if (overlay) overlay.style.display = previousOverlayDisplay || ''
        if (markers) markers.style.display = previousMarkerDisplay || ''
      }

      const capturedImage = fullCanvas.toDataURL('image/png')
      const stepId = `answer_${crypto.randomUUID()}`
      let childTraceId: string | undefined
      if (sourcePanel.traceId && sourcePanel.stepId) {
        childTraceId = `trace_${crypto.randomUUID()}`
        const child: BookStudyTrace = {
          id: childTraceId, pdfId, createdAt: Date.now(), regions: [],
          parentTraceId: sourcePanel.traceId, parentStepId: sourcePanel.stepId,
          resultRegion: geometry.region,
          steps: [{ id: stepId, type: 'answer', source: 'grading', sourcePageNumbers: sourcePanel.sourcePageNumbers,
            layoutMode: 'book-result-focus', answerTexts: [], imageFocusRegion: geometry.region,
            pageDisplayWidth: resultBounds.width, pageScrollTop } as BookStudyStep],
        }
        await createPDFStudyTrace(child, await dataUrlToBlob(capturedImage))
        setStudyTraces(previous => [...previous, child])
      }
      pushPanel({
        type: 'answer', questionImage: capturedImage, sourcePageNumbers: sourcePanel.sourcePageNumbers,
        source: 'grading', fullPageQuestion: true, initialTexts: [], imageFocusRegion: geometry.region,
        pageDisplayWidth: resultBounds.width, pageScrollTop,
        traceId: childTraceId, stepId: childTraceId ? stepId : undefined,
      })
      setIsGradingCaptureMode(false)
      gradingCaptureRectRef.current = null
      setGradingCaptureRect(null)
    } catch (error) {
      console.error('Grading capture error:', error)
      gradingCaptureRectRef.current = null
      setGradingCaptureRect(null)
    }
  }

  const cancelGradingCapture = () => {
    setIsGradingCaptureMode(false)
    gradingCaptureRectRef.current = null
    setGradingCaptureRect(null)
    isGradingCapturingRef.current = false
  }

  const activatePanelMode = useCallback((panelType: PanelData['type']) => {
    setIsSelectionMode(panelType === 'pdf')
    setSelectionRect(null)
    isSelectingRef.current = false
    selectionStartRef.current = null
    setIsDrawingMode(false)
    setIsEraserMode(false)
    setIsTextMode(panelType === 'answer')
    setIsGradingCaptureMode(panelType === 'grading')
    gradingCaptureStartRef.current = null
    gradingCaptureRectRef.current = null
    setGradingCaptureRect(null)
    isGradingCapturingRef.current = false
    setIsHoveringStudyTrace(false)
  }, [])

  const captureSelectionArea = async (rect: { x: number, y: number, width: number, height: number }) => {
    if (!containerRef.current) return null

    // Create a temporary canvas to draw the result
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = rect.width
    tempCanvas.height = rect.height
    const ctx = tempCanvas.getContext('2d')
    if (!ctx) return null
    const sourcePageNumbers: number[] = []
    const regions: PDFStudyRegion[] = []
    let pageDisplayWidth: number | undefined

    // ペインからキャプチャするヘルパー
    const captureFromPane = (paneRef: React.RefObject<PDFPaneHandle>, paneClassName: string, pageNumber: number) => {
      const paneEl = containerRef.current?.querySelector(`.${paneClassName}`)
      const compositeCanvas = paneRef.current?.getCanvas()
      const visibleCanvas = paneEl?.querySelector('.pdf-canvas') as HTMLCanvasElement | null

      if (!paneEl || !compositeCanvas || !visibleCanvas) return

      const paneRect = paneEl.getBoundingClientRect()
      const containerRect = containerRef.current!.getBoundingClientRect()
      const canvasRect = visibleCanvas.getBoundingClientRect()

      const selectionScreenX = containerRect.left + rect.x
      const selectionScreenY = containerRect.top + rect.y
      const selectionScreenW = rect.width
      const selectionScreenH = rect.height

      // Only include pixels visible inside this pane, including when zoomed.
      const intersectX = Math.max(selectionScreenX, canvasRect.left, paneRect.left)
      const intersectY = Math.max(selectionScreenY, canvasRect.top, paneRect.top)
      const intersectW = Math.min(selectionScreenX + selectionScreenW, canvasRect.right, paneRect.right) - intersectX
      const intersectH = Math.min(selectionScreenY + selectionScreenH, canvasRect.bottom, paneRect.bottom) - intersectY

      if (intersectW <= 0 || intersectH <= 0) return

      const scaleX = compositeCanvas.width / canvasRect.width
      const scaleY = compositeCanvas.height / canvasRect.height

      const sx = (intersectX - canvasRect.left) * scaleX
      const sy = (intersectY - canvasRect.top) * scaleY
      const sw = intersectW * scaleX
      const sh = intersectH * scaleY

      const dx = intersectX - selectionScreenX
      const dy = intersectY - selectionScreenY

      ctx.drawImage(compositeCanvas, sx, sy, sw, sh, dx, dy, intersectW, intersectH)
      if (!sourcePageNumbers.includes(pageNumber)) sourcePageNumbers.push(pageNumber)
      pageDisplayWidth = canvasRect.width
      regions.push({
        pageNumber,
        x: (intersectX - canvasRect.left) / canvasRect.width,
        y: (intersectY - canvasRect.top) / canvasRect.height,
        width: intersectW / canvasRect.width,
        height: intersectH / canvasRect.height,
      })
    }

    if (activeTab === 'A' || isSplitView) {
      captureFromPane(paneARef, 'pane-a', pageA)
    }

    if (activeTab === 'B' || isSplitView) {
      captureFromPane(paneBRef, 'pane-b', pageB)
    }

    return sourcePageNumbers.length ? {
      image: tempCanvas.toDataURL('image/png'), sourcePageNumbers, regions,
      pageDisplayWidth: regions.length === 1 ? pageDisplayWidth : undefined,
    } : null
  }



  // パス追加ハンドラ
  const handlePathAdd = (page: number, newPath: DrawingPath) => {
    setDrawingPaths(prev => {
      const newMap = new Map(prev)
      const currentPaths = newMap.get(page) || []
      const newPaths = [...currentPaths, newPath]
      newMap.set(page, newPaths)

      // Save to DB
      pendingDrawingWritesRef.current.set(page, JSON.stringify(newPaths))

      return newMap
    })
  }

  // Ctrl Key Tracking
  const [isCtrlPressed, setIsCtrlPressed] = useState(false)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setIsCtrlPressed(true)
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setIsCtrlPressed(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  // パス変更ハンドラ（Undo/Redo/Eraserなど）
  const handlePathsChange = (page: number, newPaths: DrawingPath[]) => {
    setDrawingPaths(prev => {
      const newMap = new Map(prev)
      if (newPaths.length === 0) {
        newMap.delete(page)
      } else {
        newMap.set(page, newPaths)
      }
      return newMap
    })
    pendingDrawingWritesRef.current.set(page, JSON.stringify(newPaths))
  }

  // 本の選択箇所について質問し、AIが要求した本文をブラウザで取得する。
  const confirmAndGrade = async (compositeImage: string, sourcePageNumbers: number[], typedQuestion?: string) => {
    if (traceUndo.busy) return
    setIsGrading(true)
    setBookAgentStatus('質問を確認しています…')
    setGradingError(null)
    const answerPanel = panelStack[activePanelIndex]
    const traceId = answerPanel?.type === 'answer' ? answerPanel.traceId : undefined
    const answerStepId = answerPanel?.type === 'answer' ? answerPanel.stepId : undefined

    try {
      if (traceId && answerPanelRef.current && answerPanel.type === 'answer' && answerPanel.stepId) {
        try {
          const drawing = await answerPanelRef.current.getDrawingBlob()
          if (drawing) await savePDFStudyDrawing(traceId, answerPanel.stepId, drawing)
        } catch (error) {
          console.error('質問の保存に失敗しました:', error)
        }
      }
      const croppedImageData = await compressImageDataUrl(compositeImage, 2048)

      // Validate image size (minimum 50x50)
      const img = new Image()
      img.src = croppedImageData
      await new Promise((resolve, reject) => {
        img.onload = () => {
          if (img.width < 50 || img.height < 50) {
            setGradingError('選択範囲が小さすぎます。もう少し大きく選択してください。')
            setIsGrading(false)
            reject(new Error('Image too small'))
          } else {
            resolve(undefined)
          }
        }
        img.onerror = () => {
          setGradingError('画像の読み込みに失敗しました。')
          setIsGrading(false)
          reject(new Error('Image load error'))
        }
      })
      const currentPage = sourcePageNumbers[0] || pageA
      const question = typedQuestion?.trim() || await readBookQuestion(croppedImageData)
      const preceding = panelStack[activePanelIndex - 1]
      const previousAnswer = preceding?.type === 'grading' ? preceding.result.overallComment : undefined
      const startTime = Date.now()
      const response = await askBookQuestion({
        questionImageData: croppedImageData, question, currentPage,
        indexedPages: bookIndex.textPageCount, totalPages: numPages,
        includeLaterPages,
        previousAnswer: previousAnswer?.slice(0, 6000), model: selectedModel !== 'default' ? selectedModel : undefined,
        clientCapabilities: ['search_book', 'read_book_pages'],
      }, request => bookIndex.answerContextRequest(request, currentPage, includeLaterPages), progress => {
        setBookAgentStatus(progress.phase === 'searching'
          ? `先生が本文を確認: ${progress.request?.reason.slice(0, 100) || '関連する箇所を検索しています'}`
          : '先生が回答を考えています…')
      })
      const endTime = Date.now()
      const clientResponseTimeSeconds = parseFloat(((endTime - startTime) / 1000).toFixed(1))

      setGradingError(null)

      const gradingResult: BookQuestionResult = { ...response.result, referenceQuestion: question, referenceRegionAnchor: 'answer-body' }
      const gradingStepId = `grading_${crypto.randomUUID()}`
      let savedTraceId: string | undefined
      if (traceId) {
        try {
          await appendPDFStudyStep(traceId, {
            id: gradingStepId, type: 'grading', sourcePageNumbers,
            result: gradingResult, modelName: response.modelName ?? null,
            responseTime: response.responseTime ?? clientResponseTimeSeconds,
          }, undefined, answerStepId)
          savedTraceId = traceId
          const updated = await getPDFStudyTrace(traceId) as BookStudyTrace | null
          if (updated) setStudyTraces(previous => previous.map(trace => trace.id === traceId ? updated : trace))
        } catch (error) {
          console.error('先生の回答の保存に失敗しました:', error)
        }
      }
      pushPanel({
        type: 'grading',
        sourcePageNumbers,
        result: gradingResult,
        modelName: response.modelName ?? null,
        responseTime: response.responseTime ?? clientResponseTimeSeconds,
        traceId: savedTraceId, stepId: savedTraceId ? gradingStepId : undefined,
      })

    } catch (e) {
      console.error(e)
      setGradingError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsGrading(false)
      setBookAgentStatus('')
    }
  }

  // Grade handler called from toolbar
  const handleGradeFromToolbar = async () => {
    const sourcePanel = panelStack[activePanelIndex]
    if (sourcePanel?.type !== 'answer') return
    const compositeImage = await answerPanelRef.current?.getCompositeImage()
    if (sourcePanel.traceId && sourcePanel.stepId) {
      await pendingQuestionWritesRef.current.get(`${sourcePanel.traceId}:${sourcePanel.stepId}`)?.catch(() => {})
    }
    if (compositeImage) await confirmAndGrade(compositeImage, sourcePanel.sourcePageNumbers,
      answerPanelRef.current?.getQuestionText())
  }

  // 描画モードの切り替え
  const toggleDrawingMode = () => {
    if (!isDrawingMode) {
      cancelGradingCapture()
      setIsDrawingMode(true)
      setIsEraserMode(false)
      setIsTextMode(false)
      setIsSelectionMode(false)
      setSelectionRect(null)
    }
  }

  // 消しゴムモードの切り替え
  const toggleEraserMode = () => {
    if (!isEraserMode) {
      cancelGradingCapture()
      setIsEraserMode(true)
      setIsDrawingMode(false)
      setIsTextMode(false)
      setIsSelectionMode(false)
      setSelectionRect(null)
    }
  }

  // 採点開始（範囲選択モードに切り替え）
  const startGrading = () => {
    const currentPanel = panelStack[activePanelIndex]
    if (currentPanel?.type === 'grading') {
      // 採点結果パネル上での範囲選択（html2canvasでキャプチャ）
      activatePanelMode('grading')
      return
    }
    // PDFパネルが表示されていない場合は先にPDFパネルへ移動
    const pdfIndex = panelStack.findIndex(p => p.type === 'pdf')
    if (pdfIndex >= 0 && activePanelIndex !== pdfIndex) {
      setActivePanelIndex(pdfIndex)
    }
    setIsSelectionMode(true)
    setIsDrawingMode(false)
    setIsEraserMode(false)
    setIsTextMode(false)
    setSelectionRect(null)
  }

  // テキストモードのトグル
  const toggleTextMode = () => {
    if (!isTextMode) {
      cancelGradingCapture()
      setIsTextMode(true)
      setIsDrawingMode(false)
      setIsEraserMode(false)
      setIsSelectionMode(false)
    }
  }

  // テキスト追加のハンドラ（PDFPaneからのクリックイベント用）
  const handleTextClick = (pageNum: number, normalizedX: number, normalizedY: number, screenX: number, screenY: number) => {
    if (!isTextMode) return
    setEditingText({
      pageNum,
      x: normalizedX,
      y: normalizedY,
      screenX,
      screenY
    })
  }

  const persistTextAnnotations = (pageNum: number, annotations: TextAnnotation[]) => {
    void saveTextAnnotation(pdfId, pageNum, JSON.stringify(annotations)).catch(error => {
      console.error('テキストの保存に失敗しました:', error)
    })
  }

  // テキスト確定（編集・新規追加・削除を統合）
  const confirmText = (text: string) => {
    if (!editingText) return

    const trimmedText = text.trim()
    const finish = () => setEditingText(null)

    // 1. 既存テキストの削除（空文字になった場合）
    if (editingText.existingId && trimmedText === '') {
      deleteTextAnnotation(editingText.pageNum, editingText.existingId)
      finish()
      return
    }

    // 2. 既存テキストの更新
    if (editingText.existingId) {
      setTextAnnotations(prev => {
        const newMap = new Map(prev)
        const current = newMap.get(editingText.pageNum) || []
        const updated = current.map(a =>
          a.id === editingText.existingId
            ? { ...a, text: trimmedText }
            : a
        )
        newMap.set(editingText.pageNum, updated)

        // Save to IndexedDB
        persistTextAnnotations(editingText.pageNum, updated)

        return newMap
      })
      finish()
      return
    }

    // 3. 新規テキストが空の場合（キャンセル扱い）
    if (trimmedText === '') {
      finish()
      return
    }

    // 4. 新規テキストの追加
    const newAnnotation: TextAnnotation = {
      id: `text - ${Date.now()} `,
      x: editingText.x,
      y: editingText.y,
      text: trimmedText,
      fontSize: textFontSize,
      color: penColor,
      direction: textDirection
    }

    setTextAnnotations(prev => {
      const newMap = new Map(prev)
      const current = newMap.get(editingText.pageNum) || []
      const updatedAnnotations = [...current, newAnnotation]
      newMap.set(editingText.pageNum, updatedAnnotations)

      // Save to IndexedDB
      persistTextAnnotations(editingText.pageNum, updatedAnnotations)

      return newMap
    })
    finish()
  }

  // テキスト削除
  const deleteTextAnnotation = (pageNum: number, annotationId: string) => {
    setTextAnnotations(prev => {
      const newMap = new Map(prev)
      const current = newMap.get(pageNum) || []
      const filtered = current.filter(a => a.id !== annotationId)
      if (filtered.length === 0) {
        newMap.delete(pageNum)
      } else {
        newMap.set(pageNum, filtered)
      }

      // Save to IndexedDB (empty array to clear or filtered list)
      persistTextAnnotations(pageNum, filtered)

      return newMap
    })
  }

  // ステータスメッセージ


  // 分割表示の切り替え / A面B面の入れ替え
  const toggleSplitView = () => {
    if (isSplitView) {
      // 既にスプリット表示中ならA面とB面を入れ替え
      const tempA = pageA
      setPageA(pageB)
      setPageB(tempA)
    } else {
      // スプリット表示をオンにする
      setActiveTab('B')
      setIsSplitView(true)
    }
  }

  // ページ変更ハンドラ
  const handlePageAChange = (p: number) => {
    if (p < 1 || p > numPages) return
    void flushDrawingSaves(pdfId, pageA)
    setPageA(p)
  }
  const handlePageBChange = (p: number) => {
    if (p < 1 || p > numPages) return
    void flushDrawingSaves(pdfId, pageB)
    setPageB(p)
  }

  // ページ番号の永続化（デバウンス付き）
  useEffect(() => {
    const timer = setTimeout(() => {
      const updates: Partial<{ lastPageNumberA: number; lastPageNumberB: number }> = {}

      if (pageA > 0 && pageA !== pdfRecord.lastPageNumberA) {
        updates.lastPageNumberA = pageA
      }
      if (pageB > 0 && pageB !== pdfRecord.lastPageNumberB) {
        updates.lastPageNumberB = pageB
      }

      if (Object.keys(updates).length > 0) {
        updatePDFRecord(pdfRecord.id, updates).catch(err => {
        })
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [pageA, pageB, pdfRecord.id, pdfRecord.lastPageNumberA, pdfRecord.lastPageNumberB])

  // 矩形選択モードをキャンセル
  const handleCancelSelection = () => {
    setSelectionRect(null)
  }

  // リサイズハンドラ
  const handleResizeStart = (e: React.MouseEvent | React.TouchEvent) => {
    setIsResizing(true)
  }

  useEffect(() => {
    if (!isResizing) return

    const handleMove = (clientX: number) => {
      if (!splitContainerRef.current) return
      const rect = splitContainerRef.current.getBoundingClientRect()
      const newRatio = (clientX - rect.left) / rect.width
      const clampedRatio = Math.max(0.2, Math.min(0.8, newRatio))
      setSplitRatio(clampedRatio)
    }

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault()
      handleMove(e.clientX)
    }

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault() // Prevent scrolling
      handleMove(e.touches[0].clientX)
    }

    const handleEnd = (clientX: number) => {
      if (!splitContainerRef.current) return
      const rect = splitContainerRef.current.getBoundingClientRect()
      const finalRatio = (clientX - rect.left) / rect.width
      const clampedRatio = Math.max(0.2, Math.min(0.8, finalRatio))
      localStorage.setItem(SPLIT_RATIO_STORAGE_KEY, clampedRatio.toString())
      setIsResizing(false)
    }

    const handleMouseUp = (e: MouseEvent) => handleEnd(e.clientX)
    const handleTouchEnd = (e: TouchEvent) => handleEnd(e.changedTouches[0].clientX)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [isResizing])

  // Ctrl+Z Undo - アクティブなページの最後の描画を削除
  const handleUndo = () => {
    const activePage = activeTab === 'A' ? pageA : pageB
    setDrawingPaths(prev => {
      const newMap = new Map(prev)
      const currentPaths = newMap.get(activePage) || []
      if (currentPaths.length > 0) {
        const newPaths = currentPaths.slice(0, -1)
        newMap.set(activePage, newPaths)
        // Save to DB
        pendingDrawingWritesRef.current.set(activePage, JSON.stringify(newPaths))
      }
      return newMap
    })
  }

  const activePanel = panelStack[activePanelIndex]
  useEffect(() => {
    if (activePanel) activatePanelMode(activePanel.type)
  }, [activePanel, activatePanelMode])

  const isOnAnswerPanel = activePanel?.type === 'answer'
  const isPenActive = isOnAnswerPanel ? !isEraserMode && !isTextMode : isDrawingMode
  const activeResultHasBranches = activePanel?.type === 'grading' &&
    studyTraces.filter(trace => trace.parentTraceId === activePanel.traceId &&
      trace.parentStepId === activePanel.stepId).length > 1
  const visibleBreadcrumbPanels = panelStack.slice(
    0, activePanel?.type === 'pdf' || activeResultHasBranches ? activePanelIndex + 1 : undefined,
  )

  const navigateToPanel = (index: number) => {
    const panel = panelStack[index]
    if (!panel) return
    activatePanelMode(panel.type)
    setActivePanelIndex(index)
  }

  const getWheelDestination = (direction: -1 | 1) => {
    let outgoingIds: string[] | undefined
    if (activePanel?.type === 'pdf') {
      const visiblePages = isSplitView ? [pageA, pageB] : [activeTab === 'A' ? pageA : pageB]
      outgoingIds = studyTraces.filter(trace => trace.regions.some(region => visiblePages.includes(region.pageNumber)))
        .map(trace => trace.id)
    } else if (activePanel?.type === 'grading' && activePanel.traceId && activePanel.stepId) {
      const children = studyTraces.filter(trace => trace.parentTraceId === activePanel.traceId &&
        trace.parentStepId === activePanel.stepId)
      if (children.length) outgoingIds = children.map(child => child.id)
    }
    const next = panelStack[activePanelIndex + 1]
    return getPanelWheelDestination({
      direction, currentIndex: activePanelIndex, panelCount: panelStack.length, outgoingIds,
      nextPanelId: next?.type !== 'pdf' ? next?.traceId : undefined,
    })
  }

  const navigateWithWheel = async (direction: -1 | 1) => {
    const destination = getWheelDestination(direction)
    if (!destination) return
    if (destination.type === 'panel') navigateToPanel(destination.index)
    else await openStudyTrace(destination.id)
  }

  // Open PDF questions explicitly from their marks; only questions and answers use lateral navigation.
  const isPanelNavigationEnabled = !!activePanel && activePanel.type !== 'pdf'
  const canGoForward = isPanelNavigationEnabled && getWheelDestination(1) !== null
  const panelNavigationBusy = isGrading || traceUndo.busy || !!editingText || isSelectingRef.current || isGradingCapturingRef.current
  const { navigate: navigatePanel, isNavigating } = useWheelPanelNavigation({
    enabled: isPanelNavigationEnabled, containerRef: panelNavigationRef, navigationKey: activePanel,
    canGoBack: getWheelDestination(-1) !== null, canGoForward,
    busy: panelNavigationBusy,
    onNavigate: navigateWithWheel,
  })

  const renderResultMarkers = (panel: Extract<PanelData, { type: 'grading' }>, viewportRef: React.RefObject<HTMLDivElement>) => {
    if (!panel.traceId || !panel.stepId) return null
    const children = studyTraces.filter(trace => trace.parentTraceId === panel.traceId &&
      trace.parentStepId === panel.stepId && trace.resultRegion)
    const undoChild = undoTrace?.parentTraceId === panel.traceId && undoTrace.parentStepId === panel.stepId &&
      undoTrace.resultRegion ? undoTrace : undefined
    if (!children.length && !undoChild) return null
    return (
      <div className="grading-study-markers">
        {children.map(child => (
          <StudyRegionMarker key={child.id} id={child.id}
            completed={child.steps.some(step => step.type === 'grading')}
            onOpen={id => { void openStudyTrace(id) }}
            onDelete={id => { void deleteStudyTrace(id) }}
            deleteDisabled={traceUndo.busy || isGrading}
            viewportRef={viewportRef}
            style={{ left: `${child.resultRegion!.x * 100}%`, top: `${child.resultRegion!.y * 100}%`,
              width: `${child.resultRegion!.width * 100}%`, height: `${child.resultRegion!.height * 100}%` }} />
        ))}
        {undoChild && (
          <StudyRegionMarker key={`undo-${undoChild.id}`} id={undoChild.id}
            onOpen={id => { void openStudyTrace(id) }} onUndo={() => { void undoStudyTraceDeletion() }}
            deleteDisabled={traceUndo.busy || isGrading} viewportRef={viewportRef}
            style={{ left: `${undoChild.resultRegion!.x * 100}%`, top: `${undoChild.resultRegion!.y * 100}%`,
              width: `${undoChild.resultRegion!.width * 100}%`, height: `${undoChild.resultRegion!.height * 100}%` }} />
        )}
      </div>
    )
  }

  const deleteStudyTrace = async (traceId: string) => {
    if (isGrading || traceUndo.busy) return
    try {
      const snapshot = await traceUndo.deleteTrace(traceId, async () => {
        await Promise.all([...pendingQuestionWritesRef.current.values(), ...pendingStudyDrawingWritesRef.current])
        if (activePanel?.type === 'answer' && activePanel.traceId && activePanel.stepId && answerPanelRef.current) {
          const drawing = await answerPanelRef.current.getDrawingBlob()
          if (drawing) await savePDFStudyDrawing(activePanel.traceId, activePanel.stepId, drawing)
        }
      })
      if (!snapshot) return
      const ids = new Set(snapshot.traces.map(trace => trace.id))
      ids.forEach(id => deletedTraceIdsRef.current.add(id))
      setStudyTraces(previous => previous.filter(trace => !ids.has(trace.id)))
      const firstRemovedPanel = panelStack.findIndex(panel => panel.type !== 'pdf' && panel.traceId && ids.has(panel.traceId))
      if (firstRemovedPanel >= 0) {
        setPanelStack(previous => previous.slice(0, firstRemovedPanel))
        if (activePanelIndex >= firstRemovedPanel) {
          const index = firstRemovedPanel - 1
          setActivePanelIndex(index)
          activatePanelMode(panelStack[index].type)
        }
      }
    } catch (error) {
      console.error('質問の印を削除できませんでした:', error)
    }
  }

  const undoStudyTraceDeletion = async () => {
    try {
      const snapshot = await traceUndo.undoDelete()
      if (!snapshot) return
      const ids = new Set(snapshot.traces.map(trace => trace.id))
      ids.forEach(id => deletedTraceIdsRef.current.delete(id))
      setStudyTraces(previous => [...previous.filter(trace => !ids.has(trace.id)), ...snapshot.traces as BookStudyTrace[]])
    } catch (error) {
      console.error('質問の印を元に戻せませんでした:', error)
    }
  }

  // PDF content panel JSX
  const pdfContent = (
    <div
      className="canvas-container"
      ref={containerRef}
      style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      {/* Error / Loading Overlay */}
      {(isLoading || pdfError) && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          zIndex: 20000
        }}>
          {isLoading ? (
            <div style={{ textAlign: 'center' }}>
              <div className="spinner" style={{
                width: '40px',
                height: '40px',
                border: '4px solid #f3f3f3',
                borderTop: '4px solid #3498db',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginBottom: '16px',
                margin: '0 auto'
              }} />
              <p>PDFを読み込み中...</p>
              <style>{`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <p style={{ color: '#e74c3c', marginBottom: '16px', fontWeight: 'bold' }}>PDFの読み込みに失敗しました</p>
              <p style={{ fontSize: '12px', color: '#666', marginBottom: '20px', maxWidth: '300px', wordBreak: 'break-all' }}>{pdfError}</p>
              <button
                onClick={() => setRetryCount(c => c + 1)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#3498db',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '16px',
                  boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
                }}
              >
                再読み込み
              </button>
            </div>
          )}
        </div>
      )}
      {isGrading && bookAgentStatus && <div className="book-agent-status" role="status">{bookAgentStatus}</div>}
      {/* Main Content Area: PDF Panes */}
      <div
        ref={splitContainerRef}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'row',
          overflow: 'hidden',
          position: 'relative',
          backgroundColor: '#f0f0f0',
          height: '100%'
        }}
      >
        {/* Global Selection Overlay */}
        {isSelectionMode && (
          <div
            className="selection-overlay"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              zIndex: 9999,
              cursor: isCtrlPressed ? 'grab' : isHoveringStudyTrace ? 'pointer' : 'crosshair',
              touchAction: 'none',
              pointerEvents: isCtrlPressed ? 'none' : 'auto'
            }}
            onPointerDown={handleTraceOverlayPointerDown}
            onPointerMove={handleTraceOverlayPointerMove}
            onPointerLeave={() => setIsHoveringStudyTrace(false)}
            onMouseDown={handleSelectionStart}
            onMouseMove={handleSelectionMove}
            onMouseUp={handleSelectionEnd}
            onTouchStart={handleTouchSelectionStart}
            onTouchMove={handleTouchSelectionMove}
            onTouchEnd={handleTouchSelectionEnd}
          >
            {selectionRect && (
              <div style={{
                position: 'absolute',
                left: selectionRect.x,
                top: selectionRect.y,
                width: selectionRect.width,
                height: selectionRect.height,
                backgroundColor: 'rgba(52, 152, 219, 0.2)',
                border: '2px solid #3498db',
                pointerEvents: 'none'
              }} />
            )}
          </div>
        )}

        {/* ペインA (問題) */}
        {(isSplitView || activeTab === 'A') && (
          <PDFPane
            className="pane-a"
            ref={paneARef}
            style={{
              flex: isSplitView ? `0 0 ${Math.round(splitRatio * 100)}%` : '1 1 auto',
              height: '100%',
              overflow: 'hidden'
            }}
            pdfRecord={pdfRecord}
            pdfDoc={pdfDoc}
            pageNum={pageA}
            regionMarkers={pdfRegionMarkers}
            onRegionMarkerClick={openStudyTrace}
            onRegionMarkerDelete={id => { void deleteStudyTrace(id) }}
            onRegionMarkerUndo={() => { void undoStudyTraceDeletion() }}
            regionMarkerDeleteDisabled={traceUndo.busy || isGrading}
            tool={isEraserMode ? 'eraser' : (isDrawingMode ? 'pen' : 'none')}
            color={penColor}
            size={penSize}
            eraserSize={eraserSize}
            scratchEraseEnabled={true}
            drawingPaths={drawingPathsA}
            isCtrlPressed={isCtrlPressed}
            splitMode={isSplitView}
            wheelPageNavigation={!editingText && !isLoading && !pdfError}
            wheelEventTargetRef={splitContainerRef}
            drawingPathsByPage={drawingPaths}
            onPageChange={handlePageAChange}
            onPathAdd={(path) => handlePathAdd(pageA, path)}
            onPathsChange={(paths) => handlePathsChange(pageA, paths)}
            onUndo={handleUndo}
          />
        )}

        {/* リサイズハンドル */}
        {isSplitView && (
          <div
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
            style={{
              width: '6px',
              height: '100%',
              backgroundColor: isResizing ? '#3498db' : '#ccc',
              cursor: 'col-resize',
              flexShrink: 0,
              transition: 'background-color 0.2s',
              zIndex: 10000,
              position: 'relative'
            }}
          />
        )}

        {/* ペインB (解答/解説) */}
        {(isSplitView || activeTab === 'B') && (
          <PDFPane
            className="pane-b"
            ref={paneBRef}
            style={{
              flex: isSplitView ? `0 0 ${Math.round((1 - splitRatio) * 100)}%` : '1 1 auto',
              height: '100%',
              overflow: 'hidden'
            }}
            pdfRecord={pdfRecord}
            pdfDoc={pdfDoc}
            pageNum={pageB}
            regionMarkers={pdfRegionMarkers}
            onRegionMarkerClick={openStudyTrace}
            onRegionMarkerDelete={id => { void deleteStudyTrace(id) }}
            onRegionMarkerUndo={() => { void undoStudyTraceDeletion() }}
            regionMarkerDeleteDisabled={traceUndo.busy || isGrading}
            tool={isEraserMode ? 'eraser' : (isDrawingMode ? 'pen' : 'none')}
            color={penColor}
            size={penSize}
            eraserSize={eraserSize}
            scratchEraseEnabled={true}
            drawingPaths={drawingPaths.get(pageB) || []}
            isCtrlPressed={isCtrlPressed}
            splitMode={isSplitView}
            wheelPageNavigation={!editingText && !isLoading && !pdfError}
            wheelEventTargetRef={splitContainerRef}
            drawingPathsByPage={drawingPaths}
            onPageChange={handlePageBChange}
            onPathAdd={(path) => handlePathAdd(pageB, path)}
            onPathsChange={(paths) => handlePathsChange(pageB, paths)}
            onUndo={handleUndo}
          />
        )}

        {/* テキストモード用オーバーレイ */}
        {isTextMode && !editingText && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              zIndex: 100,
              cursor: isHoveringStudyTrace ? 'pointer' : 'text',
              touchAction: 'none',
              pointerEvents: isCtrlPressed ? 'none' : 'auto'
            }}
            onPointerDown={handleTraceOverlayPointerDown}
            onPointerMove={handleTraceOverlayPointerMove}
            onPointerLeave={() => setIsHoveringStudyTrace(false)}
            onClick={(e) => {
              if (handledTracePointerRef.current) {
                handledTracePointerRef.current = false
                e.preventDefault()
                return
              }
              if (getStudyTraceAtPoint(e.clientX, e.clientY)) return
              const rect = containerRef.current?.getBoundingClientRect()
              if (!rect) return

              const currentPage = activeTab === 'A' ? pageA : pageB

              const screenX = e.clientX - rect.left
              const screenY = e.clientY - rect.top
              const normalizedX = screenX / rect.width
              const normalizedY = screenY / rect.height

              handleTextClick(currentPage, normalizedX, normalizedY, e.clientX, e.clientY)
            }}
            onTouchStart={(e) => {
              if (handledTracePointerRef.current) return
              if (e.touches.length === 1 && getStudyTraceAtPoint(e.touches[0].clientX, e.touches[0].clientY)) return
              handleOverlayTouchStart(e)
            }}
            onTouchMove={(e) => {
              handleOverlayTouchMove(e)
            }}
            onTouchEnd={(e) => {
              handleOverlayTouchEnd(e)
            }}
          />
        )}

        {/* テキストアノテーション表示 */}
        {(textAnnotations.get(activeTab === 'A' ? pageA : pageB) || []).map((annotation) => {
          const currentPage = activeTab === 'A' ? pageA : pageB
          const isClickable = isEraserMode || isTextMode
          const isBeingEdited = editingText?.existingId === annotation.id

          if (isBeingEdited) return null

          return (
            <div
              key={annotation.id}
              style={{
                position: 'absolute',
                left: `${annotation.x * 100}%`,
                top: `${annotation.y * 100}%`,
                fontSize: `${annotation.fontSize}px`,
                color: annotation.color,
                writingMode: annotation.direction === 'horizontal' ? 'horizontal-tb' :
                  annotation.direction === 'vertical-rl' ? 'vertical-rl' : 'vertical-lr',
                whiteSpace: 'pre-wrap',
                pointerEvents: isClickable ? 'auto' : 'none',
                zIndex: isClickable ? 200 : 50,
                cursor: isClickable ? 'pointer' : 'default',
                textShadow: '1px 1px 2px rgba(255,255,255,0.8), -1px -1px 2px rgba(255,255,255,0.8)',
                padding: isClickable ? '2px 4px' : '0',
                borderRadius: '4px',
                backgroundColor: isClickable ? 'rgba(200, 220, 255, 0.3)' : 'transparent',
                border: isClickable ? '1px dashed #3498db' : 'none'
              }}
              onClick={(e) => {
                if (!isClickable) return
                e.stopPropagation()
                const rect = containerRef.current?.getBoundingClientRect()
                if (!rect) return
                setEditingText({
                  pageNum: currentPage,
                  x: annotation.x,
                  y: annotation.y,
                  screenX: rect.left + annotation.x * rect.width,
                  screenY: rect.top + annotation.y * rect.height,
                  existingId: annotation.id,
                  initialText: annotation.text
                })
              }}
              title={isClickable ? 'クリックで編集（テキストを消して確定で削除）' : ''}
            >
              {annotation.text}
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="pdf-viewer-container">
      <div className="pdf-viewer">
        <StudyToolbar
          onBack={onBack}
          onOpenSettings={onOpenSettings}
          showStudyMarkers={showStudyMarkers}
          onToggleStudyMarkers={activePanel?.type === 'pdf' ? toggleStudyMarkers : undefined}
          breadcrumbs={visibleBreadcrumbPanels.map((panel, i) => ({
            label: getPanelLabel(panel),
            content: panel.type === 'pdf' ? <BookCoverThumbnail record={pdfRecord} size="toolbar"
              summary={numPages ? bookIndex.summary : null} expanded={showBookReferenceOptions}
              onStatusClick={() => setShowBookReferenceOptions(value => !value)} /> : undefined,
            onClick: () => navigateToPanel(i),
            isCurrent: i === activePanelIndex
          }))}
          isSplitView={isSplitView}
          toggleSplitView={toggleSplitView}
          activeTab={activeTab}
          toggleActiveTab={() => {
            if (isSplitView) {
              setActiveTab('B')
              setIsSplitView(false)
            } else {
              setActiveTab(prev => prev === 'A' ? 'B' : 'A')
            }
          }}
          isSelectionMode={isSelectionMode || isGradingCaptureMode}
          isGrading={isGrading}
          startGrading={startGrading}
          cancelSelection={isGradingCaptureMode ? cancelGradingCapture : handleCancelSelection}
          isTextMode={isTextMode}
          toggleTextMode={toggleTextMode}
          textFontSize={textFontSize}
          setTextFontSize={setTextFontSize}
          textDirection={textDirection}
          setTextDirection={setTextDirection}
          isDrawingMode={isPenActive}
          toggleDrawingMode={toggleDrawingMode}
          penColor={penColor}
          setPenColor={setPenColor}
          penSize={penSize}
          setPenSize={setPenSize}
          isEraserMode={isEraserMode}
          toggleEraserMode={toggleEraserMode}
          eraserSize={eraserSize}
          setEraserSize={setEraserSize}
          onGrade={isOnAnswerPanel ? handleGradeFromToolbar : undefined}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          availableModels={availableModels}
          defaultModelName={defaultModelName}
        />

        {showBookReferenceOptions && <BookReferenceOptions summary={bookIndex.summary}
          onClose={() => setShowBookReferenceOptions(false)} onOpenSettings={onOpenSettings}
          includeLaterPages={includeLaterPages} onIncludeLaterPagesChange={setIncludeLaterPages} />}

        <div ref={panelNavigationRef} style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {panelStack.map((panel, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: 0, left: 0, width: '100%', height: '100%',
                transform: `translateX(${(i - activePanelIndex) * 100}%)`,
                transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                overflow: 'hidden'
              }}
            >
              {panel.type === 'pdf' && pdfContent}
              {panel.type === 'answer' && (
                <AnswerPanel
                  key={`${panel.traceId ?? 'unsaved'}:${panel.stepId ?? i}`}
                  ref={i === activePanelIndex ? answerPanelRef : undefined}
                  questionImage={panel.questionImage}
                  pdfContext={panel.focusRegion && pdfDoc ? { pdfDoc, region: panel.focusRegion } : undefined}
                  imageFocusRegion={panel.imageFocusRegion}
                  initialDrawing={panel.initialDrawing}
                  initialTexts={panel.initialTexts}
                  fullPageQuestion={panel.fullPageQuestion}
                  pageDisplayWidth={panel.pageDisplayWidth}
                  pageScrollTop={panel.pageScrollTop}
                  onTextsChange={panel.traceId && panel.stepId
                    ? texts => queueQuestionTextSave(panel.traceId!, panel.stepId!, texts) : undefined}
                  onDrawingChange={panel.traceId && panel.stepId
                    ? drawing => queueStudyDrawingSave(panel.traceId!, panel.stepId!, drawing)
                    : undefined}
                  penColor={penColor}
                  penSize={penSize}
                  isEraserMode={isEraserMode}
                  eraserSize={eraserSize}
                  isTextMode={isTextMode}
                  textFontSize={textFontSize}
                  textDirection={textDirection}
                />
              )}
              {panel.type === 'grading' && (
                <div
                  ref={i === activePanelIndex ? gradingPanelRef : undefined}
                  className={isGradingCaptureMode && i === activePanelIndex ? 'grading-selection-mode' : undefined}
                  style={{ position: 'relative', width: '100%', height: '100%', isolation: 'isolate' }}
                  onMouseDown={isGradingCaptureMode && i === activePanelIndex ? handleGradingCaptureStart : undefined}
                  onMouseMove={isGradingCaptureMode && i === activePanelIndex ? handleGradingCaptureMove : undefined}
                  onMouseUp={isGradingCaptureMode && i === activePanelIndex ? handleGradingCaptureEnd : undefined}
                  onScrollCapture={isGradingCaptureMode && i === activePanelIndex ? handleGradingCaptureScroll : undefined}
                  onMouseLeave={isGradingCaptureMode && i === activePanelIndex ? () => {
                    if (isGradingCapturingRef.current) void handleGradingCaptureEnd()
                  } : undefined}
                >
                  <GradingResult
                    result={panel.result}
                    snsLinks={snsLinks}
                    timeLimitMinutes={snsTimeLimit}
                    modelName={panel.modelName}
                    responseTime={panel.responseTime}
                    pdfId={pdfId}
                    studyMarkers={viewportRef => renderResultMarkers(panel, viewportRef)}
                    onReferenceMediaResolved={media => { void handleReferenceMediaResolved(panel, media) }}
                    onOpenReferencePage={page => {
                      handlePageAChange(page)
                      setActiveTab('A')
                      navigateToPanel(0)
                    }}
                  />
                  {isGradingCaptureMode && i === activePanelIndex && (
                    <div
                      className="grading-capture-overlay"
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        top: 0, left: 0, width: '100%', height: '100%',
                        zIndex: 9999,
                        pointerEvents: 'none',
                      }}
                    >
                      {gradingCaptureRect && (
                        <div style={{
                          position: 'absolute',
                          left: gradingCaptureRect.x,
                          top: gradingCaptureRect.y,
                          width: gradingCaptureRect.width,
                          height: gradingCaptureRect.height,
                          backgroundColor: 'rgba(52, 152, 219, 0.2)',
                          border: '2px solid #3498db',
                          pointerEvents: 'none'
                        }} />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <PanelForwardButton
            canGoForward={canGoForward}
            disabled={panelNavigationBusy || isNavigating}
            label="次の画面へ"
            onNext={() => navigatePanel(1)}
          />
        </div>

        {/* テキスト入力ボックス */}
        {editingText && (
          <div
            style={{
              position: 'fixed',
              left: editingText.screenX,
              top: editingText.screenY,
              zIndex: 10000,
              background: 'white',
              border: '2px solid #3498db',
              borderRadius: '4px',
              padding: '4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
            }}
          >
            <textarea
              autoFocus
              defaultValue={editingText.initialText || ''}
              placeholder={t('textMode.placeholder')}
              style={{
                fontSize: `${textFontSize}px`,
                color: penColor,
                writingMode: textDirection === 'horizontal' ? 'horizontal-tb' :
                  textDirection === 'vertical-rl' ? 'vertical-rl' : 'vertical-lr',
                border: 'none',
                outline: 'none',
                resize: 'both',
                minWidth: textDirection === 'horizontal' ? '150px' : '50px',
                minHeight: textDirection === 'horizontal' ? '50px' : '100px',
                maxWidth: '300px',
                maxHeight: '200px'
              }}
              onBlur={(e) => confirmText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setEditingText(null)
                } else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  confirmText((e.target as HTMLTextAreaElement).value)
                }
              }}
            />
          </div>
        )}

        {/* Error popup - always on top */}
        {gradingError && (
          <div style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100000,
            background: '#fef5f5',
            border: '1px solid #f44336',
            borderRadius: '8px',
            padding: '12px 20px',
            color: '#c62828',
            fontSize: '14px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            maxWidth: '400px',
            textAlign: 'center'
          }}>
            ❌ {gradingError}
          </div>
        )}
      </div>
    </div>
  )
}

export default StudyPanel
