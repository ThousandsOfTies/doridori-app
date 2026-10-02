import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { FiMic, FiMicOff } from 'react-icons/fi'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@home-teacher/common/contexts/AuthContext'
import { getAppSettings } from '@home-teacher/common/utils/indexedDB'
import './VoiceTextEditor.css'

interface VoiceTextEditorProps {
  initialText?: string
  placeholder?: string
  className?: string
  style?: CSSProperties
  textStyle?: CSSProperties
  onCommit: (text: string) => void
  onCancel: () => void
  onDraftChange?: (text: string) => void
}

interface SpeechResult {
  readonly isFinal: boolean
  readonly [index: number]: { readonly transcript: string }
}

interface SpeechResultEvent {
  readonly resultIndex: number
  readonly results: ArrayLike<SpeechResult>
}

interface BrowserSpeechRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition
type VoicePhase = 'idle' | 'starting' | 'listening' | 'stopping'

function getSpeechRecognition(): SpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
}

function appendSpeech(current: string, speech: string, japanese: boolean): string {
  const addition = speech.trim()
  if (!addition) return current
  if (!current || /\s$/.test(current)) return current + addition
  return current + (japanese ? '' : ' ') + addition
}

export default function VoiceTextEditor({
  initialText = '', placeholder, className = '', style, textStyle, onCommit, onCancel, onDraftChange
}: VoiceTextEditorProps) {
  const { userData } = useAuth()
  const { i18n } = useTranslation()
  const japanese = i18n.language.startsWith('ja')
  const isLocalApp = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const [localPremium, setLocalPremium] = useState(false)
  const voiceAvailable = userData?.isPremium === true || (isLocalApp && localPremium)
  const browserSupported = Boolean(getSpeechRecognition())

  const [draft, setDraft] = useState(initialText)
  const [interim, setInterim] = useState('')
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [error, setError] = useState('')
  const draftRef = useRef(initialText)
  const interimRef = useRef('')
  const finishedRef = useRef(false)
  const runRef = useRef(0)
  const stoppingRef = useRef(false)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const stopTimerRef = useRef<number | undefined>()

  useEffect(() => {
    if (!isLocalApp) return
    let cancelled = false
    void getAppSettings().then(settings => {
      if (!cancelled) setLocalPremium(settings.isPremium === true)
    }).catch(cause => console.error('Failed to load local Premium settings:', cause))
    return () => { cancelled = true }
  }, [isLocalApp])

  const disposeVoice = () => {
    runRef.current += 1
    window.clearTimeout(stopTimerRef.current)
    stopTimerRef.current = undefined
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (recognition) {
      recognition.onstart = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      try { recognition.abort() } catch { /* already stopped */ }
    }
  }

  const settleInterim = () => {
    if (!interimRef.current) return
    const next = appendSpeech(draftRef.current, interimRef.current, japanese)
    draftRef.current = next
    interimRef.current = ''
    setDraft(next)
    setInterim('')
  }

  useEffect(() => () => { disposeVoice() }, [])

  const finish = (cancelled: boolean) => {
    if (finishedRef.current) return
    finishedRef.current = true
    const text = appendSpeech(draftRef.current, interimRef.current, japanese)
    disposeVoice()
    if (cancelled) onCancel()
    else onCommit(text)
  }

  const startVoice = () => {
    if (!voiceAvailable || phase !== 'idle') return
    const Recognition = getSpeechRecognition()
    if (!Recognition) {
      setError(japanese ? 'このブラウザでは音声入力を利用できません。' : 'Speech recognition is unavailable in this browser.')
      return
    }

    const run = ++runRef.current
    stoppingRef.current = false
    const recognition = new Recognition()
    recognitionRef.current = recognition
    recognition.lang = japanese ? 'ja-JP' : 'en-US'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    setPhase('starting')
    setError('')
    setInterim('')
    interimRef.current = ''

    recognition.onstart = () => {
      if (run === runRef.current && !stoppingRef.current) setPhase('listening')
    }
    recognition.onresult = event => {
      if (run !== runRef.current) return
      let finalText = ''
      let pendingText = ''
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) {
          // Earlier final results remain in the list; only append results changed by this event.
          if (index >= event.resultIndex) finalText = appendSpeech(finalText, transcript, japanese)
        } else {
          pendingText = appendSpeech(pendingText, transcript, japanese)
        }
      }
      if (finalText) {
        const next = appendSpeech(draftRef.current, finalText, japanese)
        draftRef.current = next
        setDraft(next)
      }
      interimRef.current = pendingText
      setInterim(pendingText)
    }
    recognition.onerror = event => {
      if (run !== runRef.current) return
      if (event.error === 'no-speech') {
        setError(japanese ? '声を検出できませんでした。もう一度お試しください。' : 'No speech was detected. Please try again.')
        return
      }
      if (event.error === 'aborted' && stoppingRef.current) return
      settleInterim()
      disposeVoice()
      setPhase('idle')
      const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? (japanese ? 'マイクの使用を許可してください。' : 'Please allow microphone access.')
        : event.error === 'audio-capture'
          ? (japanese ? 'マイクを使用できません。接続を確認してください。' : 'Microphone access failed. Check the device.')
          : event.error === 'network'
            ? (japanese ? 'ブラウザの音声認識に接続できません。別のブラウザで開くか、通信環境を確認してください。' : 'The browser speech service could not connect. Try another browser or check the network.')
            : (japanese ? '音声入力に失敗しました。もう一度お試しください。' : 'Speech recognition failed. Please try again.')
      setError(message)
    }
    recognition.onend = () => {
      if (run !== runRef.current) return
      settleInterim()
      disposeVoice()
      setPhase('idle')
    }

    try {
      recognition.start()
    } catch {
      disposeVoice()
      setPhase('idle')
      setError(japanese ? '音声入力を開始できませんでした。' : 'Could not start speech recognition.')
    }
  }

  const stopVoice = () => {
    if (phase === 'idle' || phase === 'stopping') return
    const recognition = recognitionRef.current
    if (!recognition) return
    stoppingRef.current = true
    setPhase('stopping')
    try {
      // stop() lets the browser return the final transcript before onend fires.
      recognition.stop()
      stopTimerRef.current = window.setTimeout(() => {
        settleInterim()
        disposeVoice()
        setPhase('idle')
      }, 5000)
    } catch {
      settleInterim()
      disposeVoice()
      setPhase('idle')
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      finish(true)
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      finish(false)
    }
  }

  const shownText = appendSpeech(draft, interim, japanese)
  useEffect(() => { onDraftChange?.(shownText) }, [shownText, onDraftChange])
  const recording = phase !== 'idle'
  const micLabel = !voiceAvailable
    ? (japanese ? '音声入力はPremiumで利用できます' : 'Voice input requires Premium')
    : !browserSupported
      ? (japanese ? 'このブラウザは音声入力に対応していません' : 'Speech recognition is unavailable in this browser')
      : recording
        ? (japanese ? '音声入力を停止' : 'Stop voice input')
        : (japanese ? '音声入力を開始' : 'Start voice input')

  return (
    <div
      className={`voice-text-editor ${className}`.trim()}
      style={style}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) finish(false)
      }}
    >
      <textarea
        autoFocus
        aria-label={japanese ? 'テキスト入力' : 'Text input'}
        placeholder={placeholder}
        value={shownText}
        readOnly={recording}
        style={textStyle}
        onChange={event => {
          draftRef.current = event.target.value
          setDraft(event.target.value)
        }}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className={`voice-text-mic ${recording ? 'active' : ''}`}
        aria-label={micLabel}
        title={micLabel}
        aria-pressed={recording}
        disabled={!voiceAvailable || !browserSupported}
        onPointerDown={event => event.preventDefault()}
        onClick={() => { if (recording) stopVoice(); else startVoice() }}
      >
        {recording ? <FiMicOff size={18} /> : <FiMic size={18} />}
      </button>
      {recording && <span className="voice-text-status" role="status">
        {phase === 'starting' ? (japanese ? 'マイクを準備中…' : 'Starting microphone…')
          : phase === 'stopping' ? (japanese ? '文字を確定中…' : 'Finalizing…')
            : (japanese ? '聞き取り中…' : 'Listening…')}
      </span>}
      {error && <span className="voice-text-error" role="alert">{error}</span>}
    </div>
  )
}
