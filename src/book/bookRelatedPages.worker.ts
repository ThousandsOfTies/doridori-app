import { createRelatedPageCalculation, type PageVector } from './bookRelatedPages'

self.onmessage = (event: MessageEvent<PageVector[]>) => {
  const calculation = createRelatedPageCalculation(event.data)
  while (!calculation.step()) { /* runs off the UI thread */ }
  self.postMessage(calculation.result())
}
