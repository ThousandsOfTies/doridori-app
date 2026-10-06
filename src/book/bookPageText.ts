import type { PDFPageProxy } from 'pdfjs-dist'
import { splitBookText, type BookPageIndex } from './bookIndex'

// Index only text embedded in the PDF. Never render or upload a page for OCR.
export async function readBookPageText(
  pdfId: string, pageNumber: number, page: Pick<PDFPageProxy, 'getTextContent'>,
): Promise<BookPageIndex> {
  const content = await page.getTextContent()
  const text = content.items.map(item => 'str' in item
    ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '')
    .join('').replace(/[ \t]+/g, ' ').trim()
  return {
    id: `${pdfId}:${pageNumber}`, pdfId, pageNumber, text,
    source: text ? 'pdf-text' : 'empty',
    passages: splitBookText(text), updatedAt: Date.now(),
  }
}
