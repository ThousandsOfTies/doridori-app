import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/** Keep the outgoing page in place until the incoming question has its final canvas and viewport. */
export function useStudyPanelSlide(index: number, panelKey: string, waitForReady: boolean) {
  const target = useRef({ index, panelKey, waitForReady })
  target.current = { index, panelKey, waitForReady }
  const readyPanels = useRef(new Set<string>())
  const [position, setPosition] = useState({ index, panelKey })

  const reveal = useCallback((next: { index: number; panelKey: string }) => {
    setPosition(previous => previous.index === next.index && previous.panelKey === next.panelKey
      ? previous : { index: next.index, panelKey: next.panelKey })
  }, [])

  useLayoutEffect(() => {
    if (!waitForReady || readyPanels.current.has(panelKey)) reveal(target.current)
  }, [index, panelKey, waitForReady, reveal])

  const setPanelReady = useCallback((key: string, ready: boolean) => {
    if (!ready) {
      readyPanels.current.delete(key)
      return
    }
    readyPanels.current.add(key)
    // A slow image from a previous navigation must never pull the reader away from the current page.
    if (target.current.panelKey === key) reveal(target.current)
  }, [reveal])

  return {
    displayedIndex: position.index,
    isPreparing: position.index !== index || position.panelKey !== panelKey,
    setPanelReady,
  }
}
