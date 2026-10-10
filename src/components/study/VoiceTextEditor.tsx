import type { CSSProperties, KeyboardEvent } from 'react'
import { FiMic, FiMicOff } from 'react-icons/fi'
import { useDoriTranslation } from '../../i18n'
import { useVoiceInput } from '@home-teacher/common/hooks/useVoiceInput'
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

export default function VoiceTextEditor({
  initialText = '', placeholder, className = '', style, textStyle, onCommit, onCancel, onDraftChange
}: VoiceTextEditorProps) {
  const { t, i18n } = useDoriTranslation()
  const { shownText, phase, errorKey, voiceAvailable, browserSupported, recording,
    startVoice, stopVoice, finish, setDraftText } = useVoiceInput({
    initialText, language: i18n.language, onCommit, onCancel, onDraftChange,
  })

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

  const micLabel = !voiceAvailable
    ? (t('voice.premium'))
    : !browserSupported
      ? (t('voice.unsupportedLabel'))
      : recording
        ? (t('voice.stop'))
        : (t('voice.start'))

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
        aria-label={t('voice.input')}
        placeholder={placeholder}
        value={shownText}
        readOnly={recording}
        style={textStyle}
        onChange={event => setDraftText(event.target.value)}
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
        {phase === 'starting' ? (t('voice.starting'))
          : phase === 'stopping' ? (t('voice.stopping'))
            : (t('voice.listening'))}
      </span>}
      {errorKey && <span className="voice-text-error" role="alert">{t(errorKey === 'voice.capture' ? 'voice.microphoneFailed'
        : errorKey === 'voice.network' ? 'voice.networkFailed' : errorKey)}</span>}
    </div>
  )
}
