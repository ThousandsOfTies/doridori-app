import Markdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import BookReferenceMedia from './BookReferenceMedia'
import type { ReferenceMediaResult } from '../../book/bookReferenceMedia'

interface BookAnswerProps {
  text: string
  referencePages: number[]
  onOpenPage?: (page: number) => void
  question?: string
  model?: string
  referenceMedia?: ReferenceMediaResult
  onMediaResolved?: (media: ReferenceMediaResult) => void
}

export default function BookAnswer({ text, referencePages, onOpenPage, question, model, referenceMedia, onMediaResolved }: BookAnswerProps) {
  // Keep older answers' geometry intact so their saved follow-up regions still line up.
  const hasReferenceMedia = question !== undefined || referenceMedia !== undefined
  return (
    <div className="book-answer">
      <div className="book-answer-heading">先生の回答</div>
      <div className={`book-answer-layout${hasReferenceMedia ? ' book-answer-with-media' : ''}`}>
        <div className="book-answer-body">
          <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}
            components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>
            {text}
          </Markdown>
        </div>
        {hasReferenceMedia && <BookReferenceMedia question={question || ''} answer={text} model={model} saved={referenceMedia} onResolved={onMediaResolved} />}
      </div>
      {referencePages.length > 0 && (
        <div className="book-answer-references">
          <span>参照したPDFページ</span>
          {referencePages.map(page => (
            <button key={page} type="button" onClick={() => onOpenPage?.(page)}
              title={`PDF ${page}ページへ移動`}>p.{page} ↗</button>
          ))}
        </div>
      )}
    </div>
  )
}
