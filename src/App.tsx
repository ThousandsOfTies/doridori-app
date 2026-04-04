import { useState, useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import AdminPanel from '@home-teacher/common/components/admin/AdminPanel'
import StudyPanel from './components/study/StudyPanel'
import PDFEditorPanel from '@home-teacher/common/components/admin/PDFEditorPanel'
import { PDFFileRecord, getPDFRecord, getAppSettings, saveAppSettings } from '@home-teacher/common/utils/indexedDB'
import { useAppInitializer } from '@home-teacher/common/hooks/useAppInitializer'

type AppView = 'admin' | 'viewer' | 'editor'

function App() {
  const [currentView, setCurrentView] = useState<AppView>('admin')
  const [selectedPDF, setSelectedPDF] = useState<PDFFileRecord | null>(null)

  // Initialization Hook
  const { isInitialized, initialView, initialPDF, settingsVersion } = useAppInitializer()

  // Manual Version Check Logic
  const [manualUpdate, setManualUpdate] = useState(false)
  const currentHash = (import.meta as any).env.VITE_APP_COMMIT_HASH || 'unknown'

  useEffect(() => {
    const checkVersion = async () => {
      try {
        console.log(`🔍 Checking version (current: ${currentHash})...`)
        // キャッシュを避けるためにタイムスタンプを付与
        const response = await fetch(`./VERSIONS?v=${Date.now()}`, { cache: 'no-store' })
        if (!response.ok) throw new Error('Failed to fetch VERSIONS')
        
        const text = await response.text()
        const match = text.match(/doridori-app=([a-f0-9]+)/)
        
        if (match && match[1]) {
          const latestHash = match[1].substring(0, 7) // 7文字で比較 (short hash)
          console.log(`📡 Latest hash: ${latestHash}, Local hash: ${currentHash}`)
          
          if (latestHash !== currentHash && currentHash !== 'unknown') {
            console.log('✨ New version detected via VERSIONS file!')
            setManualUpdate(true)
          }
        }
      } catch (err) {
        console.warn('⚠️ Version check failed:', err)
      }
    }

    // 初回実行
    if (isInitialized) {
      checkVersion()
      
      // 30分ごとにチェック
      const interval = setInterval(checkVersion, 30 * 60 * 1000)
      return () => clearInterval(interval)
    }
  }, [isInitialized, currentHash])

  // Sync initial state from hook
  useEffect(() => {
    if (isInitialized) {
      if (initialView === 'viewer' && initialPDF) {
        setSelectedPDF(initialPDF)
        setCurrentView('viewer')
      }
    }
  }, [isInitialized, initialView, initialPDF])


  // PWA update handling
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered [v0.2.7]:', r)
      // 起動時に更新チェックを明示的に行う
      if (r) {
        // 定期チェック (10分ごと)
        setInterval(async () => {
          console.log('Checking for sw update...')
          try {
            await r.update()
          } catch (e) {
            console.error('SW update check failed:', e)
          }
        }, 10 * 60 * 1000)

        // 初回チェック
        console.log('Running initial SW update check...')
        r.update().then(() => console.log('Initial SW update check completed')).catch(e => console.error('Initial SW update check failed:', e))
      }
    },
    onRegisterError(error) {
      console.log('SW registration error', error)
    },
  })

  const handleSelectPDF = (record: PDFFileRecord) => {
    setSelectedPDF(record)
    setCurrentView('viewer')
  }

  const handleEditPDF = (record: PDFFileRecord) => {
    setSelectedPDF(record)
    setCurrentView('editor')
  }

  const handleBackToAdmin = () => {
    setCurrentView('admin')
    setSelectedPDF(null)
  }

  const handleUpdate = () => {
    console.log('🔄 Updating Service Worker...')
    updateServiceWorker(true)
  }

  if (!isInitialized) {
    return <div className="loading-screen" style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      fontSize: '1.5rem',
      color: '#3498db'
    }}>Loading...</div>
  }

  return (
    <div className="app">
      {currentView === 'admin' ? (
        <AdminPanel
          key={`admin-${settingsVersion}`}
          onSelectPDF={handleSelectPDF}
          onEditPDF={handleEditPDF}
          hasUpdate={needRefresh || manualUpdate}
          onUpdate={handleUpdate}
        />
      ) : currentView === 'viewer' && selectedPDF ? (
        <StudyPanel
          key={`study-${settingsVersion}-${selectedPDF.id}`}
          pdfRecord={selectedPDF}
          pdfId={selectedPDF.id}
          onBack={handleBackToAdmin}
        />
      ) : currentView === 'editor' && selectedPDF ? (
        <PDFEditorPanel
          key={`editor-${settingsVersion}-${selectedPDF.id}`}
          pdfRecord={selectedPDF}
          pdfId={selectedPDF.id}
          onBack={handleBackToAdmin}
        />
      ) : (
        <div>No PDF selected</div>
      )}
    </div>
  )
}

export default App
