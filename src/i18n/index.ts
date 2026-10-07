import { useTranslation } from 'react-i18next'
import i18n, { i18nReady as commonI18nReady } from '@home-teacher/common/i18n/index'
import ja from './locales/ja.json'
import en from './locales/en.json'

// Keep reading-specific wording in DoriDori while using the shared language menu.
export const i18nReady = commonI18nReady.then(() => {
  i18n.addResourceBundle('ja', 'doridori', ja)
  i18n.addResourceBundle('en', 'doridori', en)
})

export function useDoriTranslation() {
  return useTranslation('doridori')
}

export default i18n
