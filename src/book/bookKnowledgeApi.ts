import type { GradeResponse } from '@home-teacher/common/services/api'
import { createReferenceMediaLoader, type BookQuestionResult } from './bookReferenceMedia'

const productionApiUrl = 'https://hometeacher-api-736494768812.asia-northeast1.run.app'
const apiBaseUrl = import.meta.env.VITE_API_URL ||
  (['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'http://localhost:3003' : productionApiUrl)

async function postBookApi<T>(path: string, body: unknown): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${apiBaseUrl}/api/book/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if ([429, 503].includes(response.status) && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
      continue
    }
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
    return data as T
  }
  throw new Error('APIへの接続を再試行しましたが失敗しました')
}

export const embedBookTexts = async (texts: string[]): Promise<number[][]> => {
  const result = await postBookApi<{ vectors: number[][] }>('embed', { texts })
  return result.vectors
}

export const readBookQuestion = async (imageData: string): Promise<string> => {
  const result = await postBookApi<{ question: string }>('read-question', { imageData })
  return result.question
}

export interface BookContext {
  pageNumber: number
  text: string
}

export interface BookQuestionResponse extends GradeResponse {
  result: BookQuestionResult
}

export const findBookReferenceMedia = createReferenceMediaLoader(body => postBookApi('reference-media', body))

export const askBookQuestion = (body: {
  questionImageData: string
  question: string
  contexts: BookContext[]
  currentPage: number
  indexedPages: number
  totalPages: number
  includeLaterPages: boolean
  previousAnswer?: string
  model?: string
}): Promise<BookQuestionResponse> => postBookApi('ask', body)
