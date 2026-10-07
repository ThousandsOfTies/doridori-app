import messages from '../i18n/locales/ja.json'
import { BOOK_AGENT_LIMITS, isBookContextRequest, type BookAgentAnswer, type BookAgentQuestion,
  type BookAgentStep, type BookAgentTurn, type BookContextRequest, type BookContextResult,
  type BookContextTrace } from '../../shared/bookAgentProtocol'

export type BookAgentProgress = { phase: 'asking' | 'searching'; round: number; request?: BookContextRequest }

// The first turn contains capabilities, never automatically chosen book passages.
// Search/page reads happen only after an explicit tool request from the AI.
export async function runBookAgent(
  question: BookAgentQuestion,
  requestTurn: (body: BookAgentTurn) => Promise<BookAgentStep>,
  resolveContext: (request: BookContextRequest) => Promise<BookContextResult>,
  onProgress?: (progress: BookAgentProgress) => void,
): Promise<BookAgentAnswer> {
  const trace: BookContextTrace[] = []
  let continuation: string | undefined
  let toolResults: BookContextResult[] | undefined
  for (let round = 0; round <= BOOK_AGENT_LIMITS.rounds; round++) {
    onProgress?.({ phase: 'asking', round })
    const step = await requestTurn({ ...question, ...(continuation ? { continuation, toolResults } : {}) })
    if (step.status === 'answered') {
      return { ...step, result: { ...step.result, contextRequests: trace } }
    }
    if (step.status !== 'needs-context' || round >= BOOK_AGENT_LIMITS.rounds || step.round !== round + 1 ||
      typeof step.continuation !== 'string' || !step.continuation || !Array.isArray(step.requests) ||
      !step.requests.length || step.requests.length > BOOK_AGENT_LIMITS.requestsPerRound ||
      !step.requests.every(isBookContextRequest) ||
      step.requests.some(request => !question.clientCapabilities.includes(request.name)) ||
      new Set(step.requests.map(request => request.id)).size !== step.requests.length) {
      throw new Error(messages.errors.contextInvalid)
    }
    toolResults = []
    for (const request of step.requests) {
      onProgress?.({ phase: 'searching', round: step.round, request })
      let result: BookContextResult
      try { result = await resolveContext(request) }
      catch (error) {
        result = { id: request.id, contexts: [], indexedPages: question.indexedPages,
          error: (error instanceof Error ? error.message : messages.errors.contextRead).slice(0, 300) }
      }
      trace.push({ round: step.round, request, result })
      toolResults.push(result)
    }
    continuation = step.continuation
  }
  throw new Error(messages.errors.contextLimit)
}
