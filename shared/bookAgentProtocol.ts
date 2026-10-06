// The browser executes only these read-only tools against the currently open PDF.
export const BOOK_AGENT_LIMITS = {
  rounds: 2,
  requestsPerRound: 2,
  contextsPerRequest: 3,
  contextCharacters: 2400,
  queryCharacters: 500,
} as const

export type BookToolName = 'search_book' | 'read_book_pages'

export interface BookContext {
  pageNumber: number
  text: string
  truncated?: boolean
}

export type BookContextRequest = {
  id: string
  reason: string
} & (
  | { name: 'search_book'; query: string }
  | { name: 'read_book_pages'; pageNumbers: number[] }
)

export interface BookContextResult {
  id: string
  contexts: BookContext[]
  indexedPages: number
  missingPages?: number[]
  error?: string
}

export interface BookContextTrace {
  round: number
  request: BookContextRequest
  result: BookContextResult
}

export interface BookAgentQuestion {
  questionImageData: string
  question: string
  currentPage: number
  indexedPages: number
  totalPages: number
  includeLaterPages: boolean
  previousAnswer?: string
  model?: string
  clientCapabilities: BookToolName[]
}

export interface BookAgentContextStep {
  status: 'needs-context'
  continuation: string
  requests: BookContextRequest[]
  round: number
  maxRounds: number
  modelName: string
}

export interface BookAgentAnswer {
  status: 'answered'
  success: true
  modelName: string
  responseTime: number
  result: {
    pageType: 'book-question'
    problems: []
    overallComment: string
    referencePages: number[]
    contextRequests?: BookContextTrace[]
  }
}

export type BookAgentStep = BookAgentContextStep | BookAgentAnswer
export type BookAgentTurn = BookAgentQuestion & {
  continuation?: string
  toolResults?: BookContextResult[]
}

export function isBookContextRequest(value: unknown): value is BookContextRequest {
  const request = value as BookContextRequest | null
  if (!request || typeof request.id !== 'string' || !request.id || request.id.length > 100 ||
    typeof request.reason !== 'string' || request.reason.length > 300) return false
  return request.name === 'search_book'
    ? typeof request.query === 'string' && !!request.query.trim() && request.query.length <= BOOK_AGENT_LIMITS.queryCharacters
    : request.name === 'read_book_pages' && Array.isArray(request.pageNumbers) && request.pageNumbers.length > 0 &&
      request.pageNumbers.length <= BOOK_AGENT_LIMITS.contextsPerRequest &&
      request.pageNumbers.every(page => Number.isInteger(page) && page > 0)
}
