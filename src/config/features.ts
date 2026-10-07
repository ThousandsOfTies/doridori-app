import messages from '../i18n/locales/ja.json'

/**
 * DoriDori アプリ設定
 */

export const APP_NAME = import.meta.env.VITE_APP_NAME || 'DoriDori'
export const APP_DESCRIPTION = import.meta.env.VITE_APP_DESCRIPTION || messages.app.description
export const THEME_COLOR = import.meta.env.VITE_THEME_COLOR || '#3498db'
