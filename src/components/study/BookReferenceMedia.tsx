import { useEffect, useRef, useState } from 'react'
import { findBookReferenceMedia } from '../../book/bookKnowledgeApi'
import type { ReferenceMedia, ReferenceMediaResult } from '../../book/bookReferenceMedia'

interface Props {
  question: string
  answer: string
  model?: string
  saved?: ReferenceMediaResult
  onResolved?: (media: ReferenceMediaResult) => void
}

function Credit({ item }: { item: ReferenceMedia }) {
  return (
    <div className="book-media-credit">
      <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.sourceName}で出典を見る ↗</a>
      {item.author && <span>作者：{item.author}</span>}
      {item.attribution && item.attribution !== item.author && <span>{item.attribution}</span>}
      <span>{item.licenseUrl
        ? <a href={item.licenseUrl} target="_blank" rel="noopener noreferrer">{item.license}</a>
        : item.license} · 元画像を使用</span>
    </div>
  )
}

export default function BookReferenceMedia({ question, answer, model, saved, onResolved }: Props) {
  const [media, setMedia] = useState<ReferenceMediaResult | undefined>(saved)
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState<ReferenceMedia | null>(null)
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set())
  const dialogRef = useRef<HTMLDialogElement>(null)
  const onResolvedRef = useRef(onResolved)
  onResolvedRef.current = onResolved

  useEffect(() => {
    if (saved && saved.status !== 'unavailable') { setMedia(saved); return }
    let active = true
    const resolved = onResolvedRef.current
    setMedia(undefined)
    void findBookReferenceMedia({ question: question.slice(0, 1000), answer: answer.slice(0, 16_000), model })
      .then(result => {
        if (active) setMedia(result)
        if (result.status !== 'unavailable') resolved?.(result)
      }).catch(() => {
        if (active) setMedia({ status: 'unavailable', items: [] })
      })
    return () => { active = false }
  }, [question, answer, model, saved, attempt])

  useEffect(() => {
    const dialog = dialogRef.current
    if (expanded && dialog && !dialog.open) dialog.showModal()
    if (!expanded && dialog?.open) dialog.close()
  }, [expanded])

  const imageFailed = (id: string) => setFailedImages(previous => new Set([...previous, id]))
  return (
    <aside className="book-reference-media" data-book-reference-media aria-label="理解を助ける参考資料">
      <div className="book-media-heading"><span aria-hidden="true">▧</span><h3>図で理解する</h3></div>
      <p className="book-media-intro">Webの参考資料で、説明をもう少し具体的に。</p>
      <div role="status" aria-live="polite" className="book-media-status">
        {!media && <p className="book-media-loading">関連する図・写真・グラフを探しています…</p>}
        {media?.status === 'empty' && <p>この回答に合う参考資料は見つかりませんでした。</p>}
        {media?.status === 'unavailable' && <div>
          <p>参考資料を取得できませんでした。</p>
          <button type="button" className="book-media-retry" onClick={() => setAttempt(value => value + 1)}>もう一度探す</button>
        </div>}
      </div>
      {media?.status === 'ready' && <div className="book-media-cards">
        {media.items.map(item => (
          <figure className="book-media-card" key={item.id}>
            {failedImages.has(item.id) ? <p className="book-media-image-fallback">画像を読み込めませんでした。下の出典リンクからご覧ください。</p>
              : <button type="button" className="book-media-image-button" onClick={() => setExpanded(item)} aria-label={`${item.title}を拡大`}>
                <img src={item.imageUrl} alt={item.title} width={item.width} height={item.height}
                  loading="lazy" decoding="async" crossOrigin="anonymous" referrerPolicy="no-referrer" onError={() => imageFailed(item.id)} />
                <span className="book-media-expand" aria-hidden="true">拡大 ↗</span>
              </button>}
            <figcaption>
              <h4>{item.title}</h4>
              <p className="book-media-caption"><span>見どころ</span>{item.caption}</p>
              <Credit item={item} />
            </figcaption>
          </figure>
        ))}
        <p className="book-media-note">本の図とは別の参考資料です。見どころは先生が説明しています。</p>
      </div>}
      <dialog ref={dialogRef} className="book-media-dialog" aria-label={expanded?.title || '参考画像の拡大'}
        onCancel={() => setExpanded(null)} onClose={() => setExpanded(null)}
        onClick={event => { if (event.target === event.currentTarget) setExpanded(null) }}>
        {expanded && <div className="book-media-dialog-content">
          <div className="book-media-dialog-header"><h3>{expanded.title}</h3>
            <button type="button" onClick={() => setExpanded(null)} aria-label="拡大画像を閉じる" autoFocus>閉じる ×</button></div>
          <img src={expanded.imageUrl} alt={expanded.title} crossOrigin="anonymous" referrerPolicy="no-referrer" />
          <p>{expanded.caption}</p><Credit item={expanded} />
        </div>}
      </dialog>
    </aside>
  )
}
