import type { TFunction } from 'i18next'
import { localizeErrorMessage, translateKnownMessage } from '@home-teacher/common/i18n/errorMessages'
import ja from './locales/ja.json'

export function localizeBookError(error: unknown, t: TFunction): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('Error: ')) return 'Error: ' + localizeBookError(message.slice(7), t)
  return translateKnownMessage(message, ja.errors, t, 'doridori') ?? localizeErrorMessage(message, t)
}
