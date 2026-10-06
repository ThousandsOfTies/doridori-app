import { useState, useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import AdminPanel from '@home-teacher/common/components/admin/AdminPanel'
import StudyPanel from './components/study/StudyPanel'
import PDFEditorPanel from '@home-teacher/common/components/admin/PDFEditorLoader'
import { PDFFileRecord } from '@home-teacher/common/utils/indexedDB'
import { useAppInitializer } from '@home-teacher/common/hooks/useAppInitializer'
import { removeDeletedBookIndexes } from './book/bookIndex'
import { SavedBookCoverThumbnail } from './components/book/BookCoverThumbnail'
import { BookIndexSettings } from './components/book/BookIndexSettings'

type AppView = 'admin' | 'viewer' | 'editor'

function App() {
  const [currentView, setCurrentView] = useState<AppView>('admin')
  const [selectedPDF, setSelectedPDF] = useState<PDFFileRecord | null>(null)

  // Initialization Hook
  const { isInitialized, initialView, initialPDF, settingsVersion } = useAppInitializer()

  // Sync initial state from hook
  useEffect(() => {
    if (isInitialized) {
      if (initialView !== 'admin' && initialPDF) {
        setSelectedPDF(initialPDF)
        setCurrentView(initialView)
      }
    }
  }, [isInitialized, initialView, initialPDF])

  useEffect(() => {
    if (!isInitialized) return
    removeDeletedBookIndexes().catch(error => console.warn('古い本の索引を整理できませんでした:', error))
  }, [isInitialized])


  // PWA update handling
  const {
    needRefresh: [needRefresh],
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
          hasUpdate={needRefresh}
          onUpdate={handleUpdate}
          studyTabLabel="Study"
          maxPDFFileSizeMB={512}
          renderPDFThumbnail={record => <SavedBookCoverThumbnail record={record} />}
        />
      ) : currentView === 'viewer' && selectedPDF ? (
        <StudyPanel
          key={`study-${settingsVersion}-${selectedPDF.id}`}
          pdfRecord={selectedPDF}
          pdfId={selectedPDF.id}
          onBack={handleBackToAdmin}
          onOpenSettings={() => handleEditPDF(selectedPDF)}
        />
      ) : currentView === 'editor' && selectedPDF ? (
        <PDFEditorPanel
          key={`editor-${settingsVersion}-${selectedPDF.id}`}
          pdfRecord={selectedPDF}
          pdfId={selectedPDF.id}
          onBack={handleBackToAdmin}
          renderAdditionalSettings={({ pdfDoc, numPages }) => <BookIndexSettings pdfId={selectedPDF.id} pdfDoc={pdfDoc} numPages={numPages} />}
        />
      ) : (
        <div>No PDF selected</div>
      )}
    </div>
  )
}

export default App
