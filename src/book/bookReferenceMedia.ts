import type { GradingResponseResult } from '@home-teacher/common/services/api'

export interface ReferenceMedia {
  id: string
  title: string
  caption: string
  imageUrl: string
  sourceUrl: string
  sourceName: string
  author: string
  attribution: string
  license: string
  licenseUrl?: string
  width: number
  height: number
}

export interface ReferenceMediaResult {
  status: 'ready' | 'empty' | 'unavailable'
  items: ReferenceMedia[]
}

export interface ReferenceMediaRequest {
  question: string
  answer: string
  model?: string
}

export interface BookQuestionResult extends GradingResponseResult {
  referencePages?: number[]
  referenceQuestion?: string
  referenceMedia?: ReferenceMediaResult
}

function allowedUrl(value: unknown, kind: 'image' | 'source' | 'license'): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
    return kind === 'image'
      ? ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname) && url.pathname.startsWith('/wikipedia/commons/')
      : kind === 'source' ? url.hostname === 'commons.wikimedia.org' && url.pathname.startsWith('/wiki/File:')
        : url.hostname === 'creativecommons.org' && /^\/(licenses|publicdomain)\//.test(url.pathname)
  } catch { return false }
}

export function normalizeReferenceMedia(value: unknown): ReferenceMediaResult {
  const result = value as Partial<ReferenceMediaResult> | null
  if (!result || !['ready', 'empty', 'unavailable'].includes(result.status || '') || !Array.isArray(result.items)) {
    return { status: 'unavailable', items: [] }
  }
  const items = result.items.filter(item => item && typeof item.id === 'string' &&
    ['title', 'caption', 'author', 'attribution', 'license'].every(field => typeof item[field] === 'string') &&
    allowedUrl(item.imageUrl, 'image') && allowedUrl(item.sourceUrl, 'source') &&
    (item.licenseUrl === undefined || allowedUrl(item.licenseUrl, 'license')) &&
    Number.isFinite(item.width) && item.width > 0 && Number.isFinite(item.height) && item.height > 0)
    .slice(0, 2).map(item => ({ ...item, sourceName: 'Wikimedia Commons' }))
  return { status: items.length ? 'ready' : result.status === 'unavailable' ? 'unavailable' : 'empty', items }
}

// Deduplicate React remounts and panel navigation. Failed searches remain retryable.
export function createReferenceMediaLoader(request: (body: ReferenceMediaRequest) => Promise<unknown>) {
  const cache = new Map<string, Promise<ReferenceMediaResult>>()
  return (body: ReferenceMediaRequest): Promise<ReferenceMediaResult> => {
    const key = JSON.stringify([body.question, body.answer, body.model || 'default'])
    const cached = cache.get(key)
    if (cached) return cached
    const pending = Promise.resolve().then(() => request(body)).then(normalizeReferenceMedia).then(result => {
      if (result.status === 'unavailable' && cache.get(key) === pending) cache.delete(key)
      return result
    }).catch(error => {
      if (cache.get(key) === pending) cache.delete(key)
      throw error
    })
    if (cache.size >= 20) cache.delete(cache.keys().next().value!)
    cache.set(key, pending)
    return pending
  }
}
