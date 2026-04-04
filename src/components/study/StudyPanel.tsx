
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { GradingResponseResult, getAvailableModels, ModelInfo } from '@home-teacher/common/services/api'
import GradingResult from './GradingResult'
import AnswerPanel, { AnswerPanelHandle } from './AnswerPanel'
import { savePDFRecord, getPDFRecord, updatePDFRecord, getAllSNSLinks, SNSLinkRecord, PDFFileRecord, saveGradingHistory, generateGradingHistoryId, saveDrawing, saveTextAnnotation } from '@home-teacher/common/utils/indexedDB'
import { ICON_SVG } from '../../constants/icons'
import { DrawingPath } from '@thousands-of-ties/drawing-common'
import { PDFPane, PDFPaneHandle } from '@home-teacher/common/components/study/PDFPane'
import { StudyToolbar, BreadcrumbItem } from './StudyToolbar'
import { usePDFRenderer } from '@home-teacher/common/hooks/pdf/usePDFRenderer'
import './StudyPanel.css'
import { useGrading } from '../../hooks/study/useGrading'
import { compressImage } from '@home-teacher/common/utils/image'
import { useAuth } from '@home-teacher/common/contexts/AuthContext'

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
}

type PanelData =
  | { type: 'pdf' }
  | { type: 'answer'; questionImage: string; source?: 'grading' }
  | { type: 'grading'; result: GradingResponseResult; modelName: string | null; responseTime: number | null }

const StudyPanel = ({ pdfRecord, pdfId, onBack }: StudyPanelProps) => {
  const { t, i18n } = useTranslation()
  // Refs
  const paneARef = useRef<PDFPaneHandle>(null)
  const paneBRef = useRef<PDFPaneHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const answerPanelRef = useRef<AnswerPanelHandle>(null)
  const gradingPanelRef = useRef<HTMLDivElement>(null)
  const isGradingCapturingRef = useRef(false)
  const gradingCaptureStartRef = useRef<{ x: number; y: number } | null>(null)
  const [gradingCaptureRect, setGradingCaptureRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [isGradingCaptureMode, setIsGradingCaptureMode] = useState(false)

  // --- Consolidated State & Logic ---

  // Status Handling
  const [statusMessage, setStatusMessage] = useState('')

  // Helper Methods (Hoisted)
  const addStatusMessage = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('ja-JP')
    const fullMessage = `[${timestamp}] ${message}`
    // console.log(fullMessage)
    setStatusMessage(message)
  }

  // Layout State
  const [isSplitView, setIsSplitView] = useState(false)
  const [activeTab, setActiveTab] = useState<'A' | 'B'>('A')

  // Split Ratio
  const [splitRatio, setSplitRatio] = useState(() => {
    const saved = localStorage.getItem('splitRatio')
    return saved ? parseFloat(saved) : 0.5
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

  // Grading State (Additional)
  const [gradingError, setGradingError] = useState<string | null>(null)

  // AI Model State
  const [selectedModel, setSelectedModel] = useState<string>('default')
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [defaultModelName, setDefaultModelName] = useState<string>('Gemini 2.0 Flash')

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
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectionRect, setSelectionRect] = useState<{ x: number, y: number, width: number, height: number } | null>(null)
  const isSelectingRef = useRef(false)
  const selectionStartRef = useRef<{ x: number, y: number } | null>(null)
  // selectionPreview via hook

  // Tool State
  const [isDrawingMode, setIsDrawingMode] = useState(true)
  const [isEraserMode, setIsEraserMode] = useState(false)
  const [isTextMode, setIsTextMode] = useState(false)
  const [penColor, setPenColor] = useState('#FF0000') // Updated to match bottom block default
  const [penSize, setPenSize] = useState(3)
  const [eraserSize, setEraserSize] = useState(50)
  // Popups
  const [showPenPopup, setShowPenPopup] = useState(false)
  const [showEraserPopup, setShowEraserPopup] = useState(false)

  // Text State
  const [textFontSize, setTextFontSize] = useState(16)
  const [textDirection, setTextDirection] = useState<TextDirection>('horizontal')
  const [showTextPopup, setShowTextPopup] = useState(false)
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
  const EMPTY_PATHS: DrawingPath[] = useMemo(() => [], [])
  const drawingPathsA = useMemo(() => drawingPaths.get(pageA) ?? EMPTY_PATHS, [drawingPaths, pageA, EMPTY_PATHS])
  const drawingPathsB = useMemo(() => drawingPaths.get(pageB) ?? EMPTY_PATHS, [drawingPaths, pageB, EMPTY_PATHS])

  // Load Drawings Effect
  useEffect(() => {
    const loadDrawings = async () => {
      try {
        const record = await getPDFRecord(pdfId)
        if (!record?.drawings) return

        const newMap = new Map<number, DrawingPath[]>()
        for (const [pageStr, pathsJson] of Object.entries(record.drawings)) {
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
        const record = await getPDFRecord(pdfId)
        if (!record?.textAnnotations) return
        const newMap = new Map<number, TextAnnotation[]>()
        for (const [pageStr, annotationsJson] of Object.entries(record.textAnnotations)) {
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


  // Grading Hook
  const {
    isGrading,
    setIsGrading,
    selectionPreview,
    setSelectionPreview,
  } = useGrading(
    pdfId,
    (msg) => addStatusMessage(msg),
    activeTab === 'A' ? pageA : pageB,
    pdfRecord?.fileName || 'Unknown',
    pdfRecord?.subjectId  // Pass subject ID for subject-specific grading
  )

  // Panel stack state
  const [panelStack, setPanelStack] = useState<PanelData[]>([{ type: 'pdf' }])
  const [activePanelIndex, setActivePanelIndex] = useState(0)

  // canUndo state for answer panel (managed reactively via callback)
  const [canUndoAnswer, setCanUndoAnswer] = useState(false)

  const getPanelLabel = (panel: PanelData): string => {
    switch (panel.type) {
      case 'pdf': return 'PDF'
      case 'answer': return panel.source === 'grading' ? '質問記入' : '解答記入'
      case 'grading': return '採点結果'
    }
  }

  const pushPanel = (panel: PanelData) => {
    setPanelStack(prev => [...prev.slice(0, activePanelIndex + 1), panel])
    setActivePanelIndex(prev => prev + 1)
  }

  const handleSelectionStart = (e: React.MouseEvent) => {
    // Only left click
    if (e.button !== 0) return

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
        pushPanel({ type: 'answer', questionImage: capturedImage })
        setIsSelectionMode(false)
        setSelectionRect(null)
      } else {
        addStatusMessage("❌ 画像のキャプチャに失敗しました")
        setSelectionRect(null)
      }
    } catch (error) {
      console.error("Capture error:", error)
      addStatusMessage("❌ エラーが発生しました")
      setSelectionRect(null)
    }
  }

  // 採点結果パネル用の範囲選択ハンドラ
  const handleGradingCaptureStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const rect = gradingPanelRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    isGradingCapturingRef.current = true
    gradingCaptureStartRef.current = { x, y }
    setGradingCaptureRect({ x, y, width: 0, height: 0 })
  }

  const handleGradingCaptureMove = (e: React.MouseEvent) => {
    if (!isGradingCapturingRef.current || !gradingCaptureStartRef.current || !gradingPanelRef.current) return
    const rect = gradingPanelRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const sx = gradingCaptureStartRef.current.x
    const sy = gradingCaptureStartRef.current.y
    setGradingCaptureRect({
      x: Math.min(sx, x),
      y: Math.min(sy, y),
      width: Math.abs(x - sx),
      height: Math.abs(y - sy)
    })
  }

  const handleGradingCaptureEnd = async () => {
    if (!isGradingCapturingRef.current || !gradingCaptureRect || !gradingPanelRef.current) return
    isGradingCapturingRef.current = false

    if (gradingCaptureRect.width < 10 || gradingCaptureRect.height < 10) {
      setGradingCaptureRect(null)
      return
    }

    try {
      const html2canvas = (await import('html2canvas')).default
      const panel = gradingPanelRef.current
      // スクロールオフセットを取得
      const scrollEl = panel.querySelector('.grading-result-content') as HTMLElement | null
      const scrollTop = scrollEl?.scrollTop ?? 0

      // オーバーレイ（枠線）を非表示にしてからキャプチャ
      const overlay = panel.querySelector('.grading-capture-overlay') as HTMLElement | null
      if (overlay) overlay.style.display = 'none'

      const fullCanvas = await html2canvas(panel, {
        scale: window.devicePixelRatio || 2,
        useCORS: true,
        allowTaint: true,
        scrollY: -scrollTop,
        y: scrollTop,
        height: panel.clientHeight,
      })

      if (overlay) overlay.style.display = ''

      const dpr = window.devicePixelRatio || 2
      const cropCanvas = document.createElement('canvas')
      cropCanvas.width = gradingCaptureRect.width * dpr
      cropCanvas.height = gradingCaptureRect.height * dpr
      const ctx = cropCanvas.getContext('2d')!
      ctx.drawImage(
        fullCanvas,
        gradingCaptureRect.x * dpr,
        gradingCaptureRect.y * dpr,
        cropCanvas.width,
        cropCanvas.height,
        0, 0,
        cropCanvas.width,
        cropCanvas.height
      )

      const capturedImage = cropCanvas.toDataURL('image/png')
      pushPanel({ type: 'answer', questionImage: capturedImage, source: 'grading' })
      setIsGradingCaptureMode(false)
      setGradingCaptureRect(null)
    } catch (error) {
      console.error('Grading capture error:', error)
      addStatusMessage('❌ キャプチャに失敗しました')
      setGradingCaptureRect(null)
    }
  }

  const cancelGradingCapture = () => {
    setIsGradingCaptureMode(false)
    setGradingCaptureRect(null)
    isGradingCapturingRef.current = false
  }

  const captureSelectionArea = async (rect: { x: number, y: number, width: number, height: number }) => {
    if (!containerRef.current) return null

    // Create a temporary canvas to draw the result
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = rect.width
    tempCanvas.height = rect.height
    const ctx = tempCanvas.getContext('2d')
    if (!ctx) return null

    // ペインからキャプチャするヘルパー
    const captureFromPane = (paneRef: React.RefObject<PDFPaneHandle>, paneClassName: string) => {
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

      const intersectX = Math.max(selectionScreenX, canvasRect.left)
      const intersectY = Math.max(selectionScreenY, canvasRect.top)
      const intersectW = Math.min(selectionScreenX + selectionScreenW, canvasRect.right) - intersectX
      const intersectH = Math.min(selectionScreenY + selectionScreenH, canvasRect.bottom) - intersectY

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
    }

    if (activeTab === 'A' || isSplitView) {
      captureFromPane(paneARef, 'pane-a')
    }

    if (activeTab === 'B' || isSplitView) {
      captureFromPane(paneBRef, 'pane-b')
    }

    return tempCanvas.toDataURL('image/png')
  }



  // パス追加ハンドラ
  const handlePathAdd = (page: number, newPath: DrawingPath) => {
    setDrawingPaths(prev => {
      const newMap = new Map(prev)
      const currentPaths = newMap.get(page) || []
      const newPaths = [...currentPaths, newPath]
      newMap.set(page, newPaths)

      // Save to DB
      saveDrawing(pdfId, page, JSON.stringify(newPaths))

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
    saveDrawing(pdfId, page, JSON.stringify(newPaths))
  }

  // 採点確定ハンドラ
  const confirmAndGrade = async (compositeImage: string) => {
    setIsGrading(true)
    setGradingError(null)

    try {
      const croppedImageData = compositeImage

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

      // APIに送信（簡素化：切り抜き画像のみ）
      addStatusMessage('🎯 AI採点中...')
      const startTime = Date.now()
      const { gradeWork } = await import('@home-teacher/common/services/api')
      const response = await gradeWork(
        croppedImageData,
        selectedModel !== 'default' ? selectedModel : undefined,
        i18n.language
      )
      const endTime = Date.now()
      const clientResponseTimeSeconds = parseFloat(((endTime - startTime) / 1000).toFixed(1))

      if (!response.success) {
        setGradingError(response.error || "採点に失敗しました")
        throw new Error(response.error || "採点に失敗しました")
      }

      setGradingError(null)

      // Flatten problems if they have nested numeric keys (fallback for non-normalized server response)
      let problems = response.result.problems
      if (problems.length === 1 && Object.keys(problems[0]).some(k => /^\d+$/.test(k))) {
        const nested = problems[0]
        const numericKeys = Object.keys(nested).filter(k => /^\d+$/.test(k))
        problems = numericKeys.map(k => nested[k])
      }

      pushPanel({
        type: 'grading',
        result: { ...response.result, problems },
        modelName: response.modelName ?? null,
        responseTime: response.responseTime ?? clientResponseTimeSeconds
      })
      addStatusMessage(`✅ 採点完了(${problems.length}問)`)

      // 採点履歴を保存
      if (response.result.problems?.length) {
        for (const problem of response.result.problems) {
          const historyRecord = {
            id: generateGradingHistoryId(),
            pdfId,
            pdfFileName: pdfRecord.fileName,
            pageNumber: pageA,
            problemNumber: problem.problemNumber,
            studentAnswer: problem.studentAnswer,
            isCorrect: problem.isCorrect || false,
            correctAnswer: problem.correctAnswer || '',
            feedback: problem.feedback || '',
            explanation: problem.explanation || '',
            timestamp: Date.now(),
            imageData: croppedImageData,
            matchingMetadata: problem.matchingMetadata
          }
          await saveGradingHistory(historyRecord)
        }
      }

    } catch (e) {
      console.error(e)
      setGradingError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsGrading(false)
    }
  }

  // Grade handler called from toolbar
  const handleGradeFromToolbar = async () => {
    const compositeImage = await answerPanelRef.current?.getCompositeImage()
    if (compositeImage) await confirmAndGrade(compositeImage)
  }

  // プレビューのキャンセル
  const cancelPreview = () => {
    setSelectionPreview(null)
  }

  // 描画モードの切り替え
  const toggleDrawingMode = () => {
    if (!isDrawingMode) {
      setIsDrawingMode(true)
      setIsEraserMode(false)
      setIsTextMode(false)
      setIsSelectionMode(false)
      setSelectionRect(null)
      addStatusMessage('✏️ ペンモード')
    }
  }

  // 消しゴムモードの切り替え
  const toggleEraserMode = () => {
    if (!isEraserMode) {
      setIsEraserMode(true)
      setIsDrawingMode(false)
      setIsTextMode(false)
      setIsSelectionMode(false)
      setSelectionRect(null)
      addStatusMessage('🧹 消しゴムモード')
    }
  }

  // クリア機能（現在のページのみ）
  const clearDrawing = () => {
    setDrawingPaths(prev => {
      const newMap = new Map(prev)
      newMap.delete(pageA)
      return newMap
    })
    saveDrawing(pdfId, pageA, JSON.stringify([]))
    addStatusMessage('描画をクリアしました')
  }

  // すべてのページの描画をクリア
  const clearAllDrawings = async () => {
    if (!confirm('すべてのページのペン跡を削除しますか？この操作は取り消せません。')) {
      return
    }

    setDrawingPaths(new Map())
    // IndexedDBからも削除
    try {
      const record = await getPDFRecord(pdfId)
      if (record) {
        record.drawings = {}
        await savePDFRecord(record)
        addStatusMessage('🗑️ すべてのペン跡を削除しました')
      }
    } catch (error) {
      console.error('ペン跡の削除に失敗:', error)
      addStatusMessage('❌ ペン跡の削除に失敗しました')
    }
  }

  // 採点開始（範囲選択モードに切り替え）
  const startGrading = () => {
    const currentPanel = panelStack[activePanelIndex]
    if (currentPanel?.type === 'grading') {
      // 採点結果パネル上での範囲選択（html2canvasでキャプチャ）
      setIsGradingCaptureMode(true)
      setGradingCaptureRect(null)
      addStatusMessage('📐 キャプチャする範囲を選択してください')
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
    addStatusMessage('📐 採点範囲を選択してください')
  }

  // テキストモードのトグル
  const toggleTextMode = () => {
    if (!isTextMode) {
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
        saveTextAnnotation(pdfId, editingText.pageNum, JSON.stringify(updated))

        return newMap
      })
      addStatusMessage('📝 テキストを更新しました')
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
      saveTextAnnotation(pdfId, editingText.pageNum, JSON.stringify(updatedAnnotations))

      return newMap
    })
    addStatusMessage('📝 テキストを追加しました')
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
      saveTextAnnotation(pdfId, pageNum, JSON.stringify(filtered))

      return newMap
    })
    addStatusMessage('🗑️ テキストを削除しました')
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
      setIsSplitView(true)
    }
  }

  // ページ変更ハンドラ
  const handlePageAChange = (p: number) => {
    if (p < 1 || p > numPages) return
    setPageA(p)
  }
  const handlePageBChange = (p: number) => {
    if (p < 1 || p > numPages) return
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
    setSelectionPreview(null)
    addStatusMessage('選択をクリアしました。再度範囲を選択してください')
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
      localStorage.setItem('splitRatio', clampedRatio.toString())
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
        saveDrawing(pdfId, activePage, JSON.stringify(newPaths))
      }
      return newMap
    })
  }

  const activePanel = panelStack[activePanelIndex]
  const isOnAnswerPanel = activePanel?.type === 'answer'

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
              cursor: isCtrlPressed ? 'grab' : 'crosshair',
              touchAction: 'none',
              pointerEvents: isCtrlPressed ? 'none' : 'auto'
            }}
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
            tool={isEraserMode ? 'eraser' : (isDrawingMode ? 'pen' : 'none')}
            color={penColor}
            size={penSize}
            eraserSize={eraserSize}
            drawingPaths={drawingPathsA}
            isCtrlPressed={isCtrlPressed}
            splitMode={isSplitView}
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
            tool={isEraserMode ? 'eraser' : (isDrawingMode ? 'pen' : 'none')}
            color={penColor}
            size={penSize}
            eraserSize={eraserSize}
            drawingPaths={drawingPaths.get(pageB) || []}
            isCtrlPressed={isCtrlPressed}
            splitMode={isSplitView}
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
              cursor: 'text',
              touchAction: 'none',
              pointerEvents: isCtrlPressed ? 'none' : 'auto'
            }}
            onClick={(e) => {
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
          breadcrumbs={panelStack.map((panel, i) => ({
            label: getPanelLabel(panel),
            onClick: () => setActivePanelIndex(i),
            isCurrent: i === activePanelIndex
          }))}
          isSplitView={isSplitView}
          toggleSplitView={toggleSplitView}
          activeTab={activeTab}
          toggleActiveTab={() => {
            if (isSplitView) {
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
          isDrawingMode={isDrawingMode}
          toggleDrawingMode={toggleDrawingMode}
          penColor={penColor}
          setPenColor={setPenColor}
          penSize={penSize}
          setPenSize={setPenSize}
          isEraserMode={isEraserMode}
          toggleEraserMode={toggleEraserMode}
          eraserSize={eraserSize}
          setEraserSize={setEraserSize}
          onUndo={handleUndo}
          onClear={clearDrawing}
          onClearAll={clearAllDrawings}
          onGrade={isOnAnswerPanel ? handleGradeFromToolbar : undefined}
          canUndoAnswer={isOnAnswerPanel ? canUndoAnswer : undefined}
          onUndoAnswer={isOnAnswerPanel ? () => answerPanelRef.current?.undo() : undefined}
          onClearAnswer={isOnAnswerPanel ? () => answerPanelRef.current?.clear() : undefined}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          availableModels={availableModels}
          defaultModelName={defaultModelName}
        />

        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
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
                  ref={answerPanelRef}
                  questionImage={panel.questionImage}
                  penColor={penColor}
                  penSize={penSize}
                  isEraserMode={isEraserMode}
                  eraserSize={eraserSize}
                  onCanUndoChange={setCanUndoAnswer}
                />
              )}
              {panel.type === 'grading' && (
                <div
                  ref={i === activePanelIndex ? gradingPanelRef : undefined}
                  style={{ position: 'relative', width: '100%', height: '100%' }}
                >
                  <GradingResult
                    result={panel.result}
                    snsLinks={snsLinks}
                    timeLimitMinutes={snsTimeLimit}
                    modelName={panel.modelName}
                    responseTime={panel.responseTime}
                    pdfId={pdfId}
                  />
                  {isGradingCaptureMode && i === activePanelIndex && (
                    <div
                      className="grading-capture-overlay"
                      style={{
                        position: 'absolute',
                        top: 0, left: 0, width: '100%', height: '100%',
                        zIndex: 9999,
                        cursor: 'crosshair',
                      }}
                      onMouseDown={handleGradingCaptureStart}
                      onMouseMove={handleGradingCaptureMove}
                      onMouseUp={handleGradingCaptureEnd}
                      onMouseLeave={() => { if (isGradingCapturingRef.current) handleGradingCaptureEnd() }}
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
