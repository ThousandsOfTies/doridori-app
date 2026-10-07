import Markdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import type { ReactNode } from 'react'
import BookReferenceMedia from './BookReferenceMedia'
import type { ReferenceMediaResult } from '../../book/bookReferenceMedia'
import BookContextHistory from './BookContextHistory'
import type { BookContextTrace } from '../../../shared/bookAgentProtocol'
import { useDoriTranslation } from '../../i18n'

interface BookAnswerProps {
  text: string
  referencePages: number[]
  onOpenPage?: (page: number) => void
  question?: string
  model?: string
  referenceMedia?: ReferenceMediaResult
  onMediaResolved?: (media: ReferenceMediaResult) => void
  studyMarkers?: ReactNode
  anchorToBody?: boolean
  contextRequests?: BookContextTrace[]
}

export default function BookAnswer({ text, referencePages, onOpenPage, question, model, referenceMedia, onMediaResolved, studyMarkers, anchorToBody, contextRequests }: BookAnswerProps) {
  const { t } = useDoriTranslation()
  // Keep older answers' geometry intact so their saved follow-up regions still line up.
  const hasReferenceMedia = question !== undefined || referenceMedia !== undefined
  return (
    <div className="book-answer">
      <div className="book-answer-heading">{t('study.answer')}</div>
      <div className={`book-answer-layout${hasReferenceMedia ? ' book-answer-with-media' : ''}`}>
        <div className="book-answer-body" data-book-answer-anchor={anchorToBody || undefined}>
          <div className="book-answer-text">
            <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}
              components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>
              {text}
            </Markdown>
          </div>
          {studyMarkers}
        </div>
        {hasReferenceMedia && <BookReferenceMedia question={question || ''} answer={text} model={model} saved={referenceMedia} onResolved={onMediaResolved} />}
      </div>
      {referencePages.length > 0 && (
        <div className="book-answer-references">
          <span>{t('reference.pages')}</span>
          {referencePages.map(page => (
            <button key={page} type="button" onClick={() => onOpenPage?.(page)}
              title={t('reference.openPage', { page })}>p.{page} ↗</button>
          ))}
        </div>
      )}
      {contextRequests && <BookContextHistory entries={contextRequests} onOpenPage={onOpenPage} />}
    </div>
  )
}
