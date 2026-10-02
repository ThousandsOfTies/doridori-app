import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PDFStudyAnswerState, PDFStudyRegion } from '@home-teacher/common/utils/indexedDB'
import { ICON_SVG } from '../../constants/icons'
import VoiceTextEditor from './VoiceTextEditor'
import './AnswerPanel.css'

export interface AnswerPanelHandle {
  getCompositeImage: () => Promise<string | null>
  getDrawingBlob: () => Promise<Blob | null>
  getQuestionText: () => string
  undo: () => void
  clear: () => void
  canUndo: boolean
}

interface AnswerPanelProps {
  questionImage: string | null
  pdfContext?: { pdfDoc: PDFDocumentProxy; region: PDFStudyRegion }
  initialDrawing?: Blob | null
  initialTexts?: PDFStudyAnswerState['texts']
  onTextsChange?: (texts: PDFStudyAnswerState['texts']) => void
  fullPageQuestion?: boolean
  pageDisplayWidth?: number
  onDrawingChange?: (drawing: Blob) => void
  penColor: string
  penSize: number
  isEraserMode: boolean
  eraserSize: number
  isTextMode: boolean
  textFontSize: number
  textDirection: 'horizontal' | 'vertical-rl' | 'vertical-lr'
  onCanUndoChange?: (canUndo: boolean) => void
}

// Canvas layout constants
const SIDE_MARGIN = 48
const TOP_MARGIN = 36
const BOTTOM_MARGIN = 48
const MIN_IMAGE_WIDTH = 600  // scale up captured image to at least this width
const BOOK_PAGE_WIDTH = 620
const BOOK_WRITING_WIDTH = 620
type WritingBounds = { x: number; y: number; width: number; height: number }
type AnswerText = PDFStudyAnswerState['texts'][number]
type Snapshot = { drawing: ImageData; texts: AnswerText[] }

const AnswerPanel = forwardRef<AnswerPanelHandle, AnswerPanelProps>(({
  questionImage,
  pdfContext,
  initialDrawing,
  initialTexts = [],
  onTextsChange,
  fullPageQuestion = false,
  pageDisplayWidth,
  onDrawingChange,
  penColor,
  penSize,
  isEraserMode,
  eraserSize,
  isTextMode,
  textFontSize,
  textDirection,
  onCanUndoChange,
}, ref) => {
  // bgCanvas: question image + writing area background (never modified by user)
  const bgCanvasRef = useRef<HTMLCanvasElement>(null)
  // drawCanvas: transparent overlay for pen strokes only
  const drawCanvasRef = useRef<HTMLCanvasElement>(null)
  const writingBoundsRef = useRef<WritingBounds | null>(null)
  const isDrawingRef = useRef(false)
  const lastPosRef = useRef<{ x: number; y: number } | null>(null)
  const historyRef = useRef<Snapshot[]>([])
  const textAnnotationsRef = useRef<AnswerText[]>(initialTexts)
  const [textAnnotations, setTextAnnotations] = useState<AnswerText[]>(initialTexts)
  const editingTextRef = useRef<{ x: number; y: number; id?: string; text: string } | null>(null)
  const [editingText, setEditingText] = useState<{ x: number; y: number; id?: string; text: string } | null>(null)
  const drawingVersionRef = useRef(0)
  const [isReady, setIsReady] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [eraserCursorPos, setEraserCursorPos] = useState<{ x: number; y: number; diameter: number } | null>(null)
  const [isOverWritingArea, setIsOverWritingArea] = useState(false)

  // Zoom & Pan state
  const [zoom, setZoom] = useState(1.0)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [isCtrlPressed, setIsCtrlPressed] = useState(false)
  const panStartRef = useRef<{ x: number; y: number } | null>(null)
  const textTouchStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const gestureRef = useRef<{ startZoom: number; startPan: { x: number; y: number }; startDist: number; startCenter: { x: number; y: number } } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Build background canvas: question image + writing space
  // Portrait → image top, writing space below (×2 height ≈ A4→A3)
  // Landscape → image left, writing space right (same width, ≈ A4→A3)
  const initCanvas = (img: HTMLImageElement, focusRegion?: PDFStudyRegion) => {
    const bgCanvas = bgCanvasRef.current
    const drawCanvas = drawCanvasRef.current
    if (!bgCanvas || !drawCanvas) return

    // Scale up small images so the writing area is comfortable to use
    const displayScale = fullPageQuestion
      ? (pageDisplayWidth || Math.max(900, Math.min(img.naturalWidth, 1100))) / img.naturalWidth
      : focusRegion
      ? BOOK_PAGE_WIDTH / img.naturalWidth
      : Math.max(1, MIN_IMAGE_WIDTH / img.naturalWidth)
    const imgW = Math.round(img.naturalWidth * displayScale)
    const imgH = Math.round(img.naturalHeight * displayScale)
    console.log('[AnswerPanel] initCanvas:', { naturalW: img.naturalWidth, naturalH: img.naturalHeight, displayScale, imgW, imgH })

    const isLandscape = imgW > imgH

    // 横長・縦長ともに画像は上部中央に配置、書き込みスペースは下
    // 横長はキャンバス幅を広くとって横長比率を維持
    const w = fullPageQuestion ? SIDE_MARGIN * 2 + imgW : focusRegion ? SIDE_MARGIN * 3 + imgW + BOOK_WRITING_WIDTH : isLandscape
      ? SIDE_MARGIN * 2 + imgW * 2 + 32  // 画像幅×2＋余白（横長比率維持）
      : Math.max(imgW + SIDE_MARGIN * 2, 800)
    const writingH = isLandscape
      ? Math.max(Math.round(imgH * 1.5), 400)
      : Math.max(imgH * 2, 360)
    const h = fullPageQuestion ? TOP_MARGIN + imgH + BOTTOM_MARGIN : focusRegion
      ? Math.max(TOP_MARGIN + imgH + BOTTOM_MARGIN, 740)
      : TOP_MARGIN + imgH + writingH + BOTTOM_MARGIN
    const imageLeft = focusRegion || fullPageQuestion ? SIDE_MARGIN : Math.round((w - imgW) / 2)
    writingBoundsRef.current = focusRegion && !fullPageQuestion
      ? { x: SIDE_MARGIN * 2 + imgW, y: TOP_MARGIN + 54,
          width: BOOK_WRITING_WIDTH, height: h - TOP_MARGIN - BOTTOM_MARGIN - 54 }
      : null

    bgCanvas.width = w
    bgCanvas.height = h
    drawCanvas.width = w
    drawCanvas.height = h
    console.log('[AnswerPanel] canvas size:', { w, h, isLandscape })

    const ctx = bgCanvas.getContext('2d')!

    // White background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)

    // Question image
    ctx.drawImage(img, imageLeft, TOP_MARGIN, imgW, imgH)
    if (focusRegion) {
      const x = imageLeft + focusRegion.x * imgW
      const y = TOP_MARGIN + focusRegion.y * imgH
      const rw = focusRegion.width * imgW
      const rh = focusRegion.height * imgH
      ctx.fillStyle = 'rgba(255, 255, 255, 0.58)'
      ctx.fillRect(imageLeft, TOP_MARGIN, imgW, Math.max(0, y - TOP_MARGIN))
      ctx.fillRect(imageLeft, y + rh, imgW, Math.max(0, TOP_MARGIN + imgH - y - rh))
      ctx.fillRect(imageLeft, y, Math.max(0, x - imageLeft), rh)
      ctx.fillRect(x + rw, y, Math.max(0, imageLeft + imgW - x - rw), rh)
      ctx.strokeStyle = '#1769aa'
      ctx.lineWidth = 3
      ctx.setLineDash([9, 6])
      ctx.strokeRect(x, y, rw, rh)
      ctx.setLineDash([])
      if (writingBoundsRef.current) {
        ctx.fillStyle = '#245474'
        ctx.font = 'bold 22px sans-serif'
        ctx.fillText('この箇所について質問', writingBoundsRef.current.x, TOP_MARGIN + 28)
        const writing = writingBoundsRef.current
        ctx.strokeStyle = '#c9d9e5'
        ctx.lineWidth = 2
        ctx.strokeRect(writing.x, writing.y, writing.width, writing.height)
        ctx.fillStyle = '#7f96a7'
        ctx.font = '16px sans-serif'
        ctx.fillText('ここに質問を書いてください', writing.x + 20, writing.y + 34)
      }
    }


    // Clear draw canvas (fully transparent)
    const dCtx = drawCanvas.getContext('2d')!
    dCtx.clearRect(0, 0, w, h)

    historyRef.current = []
    setCanUndo(false)
    onCanUndoChange?.(false)
  }

  // Restore the saved answer over the freshly built question canvas.
  useEffect(() => {
    if (!questionImage) return
    let cancelled = false
    setIsReady(false)
    const restore = async () => {
      const img = new Image()
      let focusRegion = pdfContext?.region
      if (pdfContext) {
        try {
          const page = await pdfContext.pdfDoc.getPage(pdfContext.region.pageNumber)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: Math.min(2, 1500 / base.width) })
          const pageCanvas = document.createElement('canvas')
          try {
            pageCanvas.width = Math.ceil(viewport.width)
            pageCanvas.height = Math.ceil(viewport.height)
            const context = pageCanvas.getContext('2d')
            if (!context) throw new Error('PDFページを描画できません')
            await page.render({ canvasContext: context, viewport }).promise
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve()
              img.onerror = () => reject(new Error('PDFページを開けません'))
              img.src = pageCanvas.toDataURL('image/png')
            })
          } finally {
            pageCanvas.width = 0
            pageCanvas.height = 0
          }
        } catch (error) {
          console.error('PDFページの再描画に失敗しました:', error)
          focusRegion = undefined
        }
      }
      if (!focusRegion) {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('質問画像を開けません'))
          img.src = questionImage
        })
      }
      if (cancelled) return
      initCanvas(img, focusRegion)
      if (initialDrawing && drawCanvasRef.current) {
        const url = URL.createObjectURL(initialDrawing)
        try {
          const saved = new Image()
          await new Promise<void>((resolve, reject) => {
            saved.onload = () => resolve()
            saved.onerror = () => reject(new Error('回答画像を開けませんでした'))
            saved.src = url
          })
          if (cancelled || !drawCanvasRef.current) return
          const ctx = drawCanvasRef.current.getContext('2d')!
          ctx.drawImage(saved, 0, 0, drawCanvasRef.current.width, drawCanvasRef.current.height)
        } catch (error) {
          console.error('回答の復元に失敗しました:', error)
        } finally {
          URL.revokeObjectURL(url)
        }
      }
      // Reset zoom/pan on new image
      const fitWidth = bgCanvasRef.current && containerRef.current
        ? Math.min(1, (containerRef.current.clientWidth - 32) / bgCanvasRef.current.width)
        : 1
      textAnnotationsRef.current = initialTexts
      setTextAnnotations(initialTexts)
      setZoom(focusRegion || fullPageQuestion ? fitWidth : 1)
      setPanOffset({ x: 0, y: 0 })
      setIsReady(true)
    }
    void restore().catch(error => {
      if (cancelled) return
      console.error('質問ページを開けませんでした:', error)
      setIsReady(true)
    })
    return () => { cancelled = true }
  }, [questionImage, initialDrawing, pdfContext?.pdfDoc, pdfContext?.region.pageNumber,
    pdfContext?.region.x, pdfContext?.region.y, pdfContext?.region.width, pdfContext?.region.height,
    fullPageQuestion, pageDisplayWidth])

  const persistDrawing = () => {
    if (!onDrawingChange || !drawCanvasRef.current) return
    const version = ++drawingVersionRef.current
    drawCanvasRef.current.toBlob(blob => {
      if (blob && version === drawingVersionRef.current) onDrawingChange(blob)
    }, 'image/png')
  }

  // Ctrl Key detection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Control') setIsCtrlPressed(true) }
    const handleKeyUp = (e: KeyboardEvent) => { if (e.key === 'Control') setIsCtrlPressed(false) }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  const saveSnapshot = () => {
    const drawCanvas = drawCanvasRef.current
    if (!drawCanvas) return
    const ctx = drawCanvas.getContext('2d')!
    historyRef.current.push({
      drawing: ctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height),
      texts: [...textAnnotationsRef.current],
    })
    setCanUndo(true)
    onCanUndoChange?.(true)
  }

  const handleUndo = () => {
    const drawCanvas = drawCanvasRef.current
    if (!drawCanvas) return
    const ctx = drawCanvas.getContext('2d')!
    const snapshot = historyRef.current.pop()
    if (!snapshot) return
    ctx.putImageData(snapshot.drawing, 0, 0)
    updateTexts(snapshot.texts)
    setCanUndo(historyRef.current.length > 0)
    onCanUndoChange?.(historyRef.current.length > 0)
    persistDrawing()
  }

  const handleClear = () => {
    const drawCanvas = drawCanvasRef.current
    if (!drawCanvas) return
    saveSnapshot()
    const ctx = drawCanvas.getContext('2d')!
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height)
    updateTexts([])
    persistDrawing()
  }

  const updateTexts = (texts: AnswerText[]) => {
    textAnnotationsRef.current = texts
    setTextAnnotations(texts)
    onTextsChange?.(texts)
  }

  const beginText = (clientX: number, clientY: number) => {
    if (editingTextRef.current || !drawCanvasRef.current) return
    const pos = getPos(clientX, clientY)
    const canvas = drawCanvasRef.current
    const editor = {
      x: Math.max(0, Math.min(canvas.width - 1, pos.x)),
      y: Math.max(0, Math.min(canvas.height - 1, pos.y)), text: '',
    }
    editingTextRef.current = editor
    setEditingText(editor)
  }

  const editText = (item: AnswerText) => {
    if (editingTextRef.current) return
    const editor = { x: item.x, y: item.y, id: item.id, text: item.text }
    editingTextRef.current = editor
    setEditingText(editor)
  }

  const cancelText = () => {
    editingTextRef.current = null
    setEditingText(null)
  }

  const commitText = (text: string) => {
    const editor = editingTextRef.current
    if (!editor) return
    const value = text.trim()
    cancelText()
    const current = textAnnotationsRef.current
    if (editor.id) {
      const previous = current.find(item => item.id === editor.id)
      if (!previous || previous.text === value) return
      saveSnapshot()
      updateTexts(value ? current.map(item => item.id === editor.id ? { ...item, text: value } : item)
        : current.filter(item => item.id !== editor.id))
    } else if (value) {
      saveSnapshot()
      updateTexts([...current, {
        id: `text_${crypto.randomUUID()}`, x: editor.x, y: editor.y, text: value,
        fontSize: textFontSize, color: penColor, direction: textDirection,
      }])
    }
  }

  const getQuestionText = () => {
    const current = textAnnotationsRef.current
    const editor = editingTextRef.current
    const texts = editor?.id ? current.filter(item => item.id !== editor.id) : current
    return [...texts.map(item => item.text), editor?.text ?? ''].filter(Boolean).join('\n').trim()
  }

  // Composite bg + draw canvases into a single PNG
  const getCompositeImage = async (): Promise<string | null> => {
    const bgCanvas = bgCanvasRef.current
    const drawCanvas = drawCanvasRef.current
    if (!bgCanvas || !drawCanvas) return null

    const out = document.createElement('canvas')
    const writing = writingBoundsRef.current
    if (writing && questionImage) {
      const selected = new Image()
      await new Promise<void>((resolve, reject) => {
        selected.onload = () => resolve()
        selected.onerror = () => reject(new Error('選択画像を開けません'))
        selected.src = questionImage
      })
      out.width = Math.max(selected.naturalWidth, writing.width)
      out.height = selected.naturalHeight + writing.height + 24
      const ctx = out.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, out.width, out.height)
      ctx.drawImage(selected, Math.round((out.width - selected.naturalWidth) / 2), 0)
      ctx.drawImage(drawCanvas, writing.x, writing.y, writing.width, writing.height,
        Math.round((out.width - writing.width) / 2), selected.naturalHeight + 24,
        writing.width, writing.height)
    } else {
      out.width = bgCanvas.width
      out.height = bgCanvas.height
      const ctx = out.getContext('2d')!
      ctx.drawImage(bgCanvas, 0, 0)
      ctx.drawImage(drawCanvas, 0, 0)
    }
    return out.toDataURL('image/png')
  }

  const getDrawingBlob = (): Promise<Blob | null> => new Promise(resolve => {
    const canvas = drawCanvasRef.current
    if (!canvas) { resolve(null); return }
    canvas.toBlob(resolve, 'image/png')
  })

  useImperativeHandle(ref, () => ({
    getCompositeImage,
    getDrawingBlob,
    getQuestionText,
    undo: handleUndo,
    clear: handleClear,
    canUndo,
  }))

  const getPos = (clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = drawCanvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }
  }

  const startDraw = (clientX: number, clientY: number) => {
    const pos = getPos(clientX, clientY)
    const writing = writingBoundsRef.current
    if (writing && (pos.x < writing.x || pos.x > writing.x + writing.width ||
      pos.y < writing.y || pos.y > writing.y + writing.height)) return
    saveSnapshot()
    isDrawingRef.current = true
    lastPosRef.current = pos
  }

  const drawTo = (clientX: number, clientY: number) => {
    if (!isDrawingRef.current || !lastPosRef.current || !drawCanvasRef.current) return
    const canvas = drawCanvasRef.current
    const ctx = canvas.getContext('2d')!
    const pos = getPos(clientX, clientY)
    const writing = writingBoundsRef.current
    if (writing) {
      pos.x = Math.max(writing.x, Math.min(writing.x + writing.width, pos.x))
      pos.y = Math.max(writing.y, Math.min(writing.y + writing.height, pos.y))
    }
    const rect = canvas.getBoundingClientRect()
    const scale = canvas.width / rect.width

    ctx.beginPath()
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y)
    ctx.lineTo(pos.x, pos.y)
    if (isEraserMode) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.lineWidth = eraserSize * scale
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = penColor
      ctx.lineWidth = penSize * scale
    }
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    lastPosRef.current = pos
  }

  const stopDraw = () => {
    const wasDrawing = isDrawingRef.current
    if (drawCanvasRef.current) {
      drawCanvasRef.current.getContext('2d')!.globalCompositeOperation = 'source-over'
    }
    isDrawingRef.current = false
    lastPosRef.current = null
    if (wasDrawing) persistDrawing()
  }

  const getEraserCursorPos = (clientX: number, clientY: number) => {
    const canvas = drawCanvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      diameter: eraserSize,
    }
  }

  const cursor = isPanning ? 'grabbing' : (isCtrlPressed ? 'grab' : isTextMode ? 'text' :
    writingBoundsRef.current && !isOverWritingArea ? 'default' :
      (isEraserMode ? 'none' : ICON_SVG.penCursor(penColor)))

  // Zoom/Pan Helpers
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheelNative = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()

        const delta = -e.deltaY
        const scaleFactor = 1.1
        const newZoom = delta > 0 ? zoom * scaleFactor : zoom / scaleFactor
        const clampedZoom = Math.min(Math.max(newZoom, 0.2), 5.0)

        // Zoom toward mouse pointer
        const rect = container.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        const contentX = (mouseX - panOffset.x) / zoom
        const contentY = (mouseY - panOffset.y) / zoom

        setPanOffset({
          x: mouseX - contentX * clampedZoom,
          y: mouseY - contentY * clampedZoom
        })
        setZoom(clampedZoom)
      } else {
        // Normal scroll translates to pan
        setPanOffset(prev => ({ ...prev, y: prev.y - e.deltaY }))
      }
    }

    container.addEventListener('wheel', handleWheelNative, { passive: false })
    return () => container.removeEventListener('wheel', handleWheelNative)
  }, [zoom, panOffset])

  const startPanning = (clientX: number, clientY: number) => {
    setIsPanning(true)
    panStartRef.current = { x: clientX - panOffset.x, y: clientY - panOffset.y }
  }

  const doPanning = (clientX: number, clientY: number) => {
    if (!isPanning || !panStartRef.current) return
    setPanOffset({
      x: clientX - panStartRef.current.x,
      y: clientY - panStartRef.current.y
    })
  }

  const stopPanning = () => {
    setIsPanning(false)
    panStartRef.current = null
  }

  return (
    <div
      className="answer-panel-content"
      ref={containerRef}
      style={{ overflow: 'hidden', touchAction: 'none' }}
    >
      <div
        className="answer-canvas-stack"
        style={{
          transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: isPanning ? 'none' : 'transform 0.1s ease-out'
        }}
      >
        {/* Background layer: question image + writing area */}
        <canvas ref={bgCanvasRef} className="answer-bg-canvas" />
        {/* Drawing layer: transparent overlay for strokes */}
        <canvas
          ref={drawCanvasRef}
          className="answer-draw-canvas"
          style={{ cursor, pointerEvents: isReady ? 'auto' : 'none' }}
          onMouseDown={(e) => {
            if (isCtrlPressed || e.button === 1) {
              startPanning(e.clientX, e.clientY)
            } else if (e.button === 0 && !isTextMode) {
              startDraw(e.clientX, e.clientY)
            }
          }}
          onClick={(e) => {
            if (isTextMode && !isCtrlPressed && e.button === 0) beginText(e.clientX, e.clientY)
          }}
          onMouseMove={(e) => {
            const pos = getPos(e.clientX, e.clientY)
            const writing = writingBoundsRef.current
            setIsOverWritingArea(!writing || (pos.x >= writing.x && pos.x <= writing.x + writing.width &&
              pos.y >= writing.y && pos.y <= writing.y + writing.height))
            if (isPanning) {
              doPanning(e.clientX, e.clientY)
            } else {
              if (isEraserMode) setEraserCursorPos(getEraserCursorPos(e.clientX, e.clientY))
              if (!isTextMode && e.buttons === 1) drawTo(e.clientX, e.clientY)
            }
          }}
          onMouseUp={() => { stopDraw(); stopPanning() }}
          onMouseLeave={() => { stopDraw(); stopPanning(); setEraserCursorPos(null); setIsOverWritingArea(false) }}
          onTouchStart={(e) => {
            if (e.touches.length === 2) {
              textTouchStartRef.current = null
              const t1 = e.touches[0]; const t2 = e.touches[1]
              const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
              const center = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 }
              gestureRef.current = { startZoom: zoom, startPan: panOffset, startDist: dist, startCenter: center }
            } else if (e.touches.length === 1) {
              const t = e.touches[0]
              if (isTextMode) {
                e.preventDefault()
                textTouchStartRef.current = { x: t.clientX, y: t.clientY, moved: false }
              } else startDraw(t.clientX, t.clientY)
            }
          }}
          onTouchMove={(e) => {
            if (e.touches.length === 2 && gestureRef.current) {
              const t1 = e.touches[0]; const t2 = e.touches[1]
              const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
              const center = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 }
              const { startZoom, startPan, startDist, startCenter } = gestureRef.current
              const scale = dist / startDist
              const newZoom = Math.min(Math.max(startZoom * scale, 0.2), 5.0)
              const rect = containerRef.current!.getBoundingClientRect()
              const contentX = (startCenter.x - rect.left - startPan.x) / startZoom
              const contentY = (startCenter.y - rect.top - startPan.y) / startZoom
              setZoom(newZoom)
              setPanOffset({ x: center.x - rect.left - contentX * newZoom, y: center.y - rect.top - contentY * newZoom })
            } else if (e.touches.length === 1) {
              const t = e.touches[0]
              if (isTextMode && textTouchStartRef.current) {
                if (Math.hypot(t.clientX - textTouchStartRef.current.x,
                  t.clientY - textTouchStartRef.current.y) > 8) textTouchStartRef.current.moved = true
              } else if (!isTextMode) {
                if (isEraserMode) setEraserCursorPos(getEraserCursorPos(t.clientX, t.clientY))
                drawTo(t.clientX, t.clientY)
              }
            }
          }}
          onTouchEnd={(e) => {
            if (isTextMode && e.touches.length === 0 && textTouchStartRef.current && !textTouchStartRef.current.moved) {
              beginText(textTouchStartRef.current.x, textTouchStartRef.current.y)
            }
            textTouchStartRef.current = null
            stopDraw(); stopPanning(); setEraserCursorPos(null); gestureRef.current = null
          }}
        />
        {textAnnotations.map(item => editingText?.id === item.id ? null : (
          <div key={item.id} className="answer-text-annotation"
            style={{ left: item.x, top: item.y, fontSize: item.fontSize, color: item.color,
              writingMode: item.direction === 'horizontal' ? 'horizontal-tb' : item.direction,
              pointerEvents: isTextMode || isEraserMode ? 'auto' : 'none',
              cursor: isTextMode ? 'text' : isEraserMode ? 'crosshair' : 'default' }}
            onMouseDown={event => event.stopPropagation()}
            onClick={() => {
              if (isTextMode) editText(item)
              else if (isEraserMode) {
                saveSnapshot()
                updateTexts(textAnnotationsRef.current.filter(text => text.id !== item.id))
              }
            }}>
            {item.text}
          </div>
        ))}
        {editingText && (
          <VoiceTextEditor key={editingText.id ?? `${editingText.x}-${editingText.y}`}
            className="answer-text-editor"
            initialText={editingText.text}
            style={{ position: 'absolute', left: editingText.x, top: editingText.y,
            }}
            textStyle={{ fontSize: textAnnotations.find(item => item.id === editingText.id)?.fontSize ?? textFontSize,
              color: textAnnotations.find(item => item.id === editingText.id)?.color ?? penColor,
              writingMode: (textAnnotations.find(item => item.id === editingText.id)?.direction ?? textDirection) === 'horizontal'
                ? 'horizontal-tb' : (textAnnotations.find(item => item.id === editingText.id)?.direction ?? textDirection) as 'vertical-rl' | 'vertical-lr' }}
            onDraftChange={text => {
              if (editingTextRef.current) editingTextRef.current = { ...editingTextRef.current, text }
            }}
            onCommit={commitText}
            onCancel={cancelText}
          />
        )}
        {/* Eraser circle cursor */}
        {isEraserMode && eraserCursorPos && (
          <div
            style={{
              position: 'absolute',
              left: `${eraserCursorPos.x}px`,
              top: `${eraserCursorPos.y}px`,
              width: `${eraserSize}px`,
              height: `${eraserSize}px`,
              borderRadius: '50%',
              backgroundColor: 'rgba(255, 100, 100, 0.2)',
              border: '2px solid rgba(255, 100, 100, 0.6)',
              pointerEvents: 'none',
              transform: 'translate(-50%, -50%)',
              zIndex: 9999,
            }}
          />
        )}
      </div>
    </div>
  )
})

AnswerPanel.displayName = 'AnswerPanel'

export default AnswerPanel
