import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './i18n' // i18nの初期化
import { APP_NAME, APP_DESCRIPTION, THEME_COLOR } from './config/features'

// アプリ名とテーマカラーを動的に設定

// アプリ名とテーマカラーを動的に設定
document.title = APP_NAME
const metaDescription = document.querySelector('meta[name="description"]')
if (metaDescription) {
  metaDescription.setAttribute('content', APP_DESCRIPTION)
}
const metaThemeColor = document.querySelector('meta[name="theme-color"]')
if (metaThemeColor) {
  metaThemeColor.setAttribute('content', THEME_COLOR)
}

// グローバルエラーハンドラー
window.addEventListener('error', (event) => {
  console.error('グローバルエラー:', event.error)
  console.error('メッセージ:', event.message)
  console.error('ファイル:', event.filename)
  console.error('行:', event.lineno, '列:', event.colno)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('未処理のPromise拒否:', event.reason)
})

import { AuthProvider } from './contexts/AuthContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
)
