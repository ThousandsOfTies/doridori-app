import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PDFBlobRangeTransport, getRangePDFDocument } from '../../home-teacher-common/src/utils/pdfRange'

test('PDF.js opens a page through bounded byte-range reads', { timeout: 15000 }, async () => {
  const bytes = await readFile(new URL('../public/drills/math-g1-add-lv1.pdf', import.meta.url))
  const blob = new Blob([bytes])
  const requests: Array<[number, number]> = []
  const readErrors: Error[] = []
  const range = new PDFBlobRangeTransport(blob.size, (begin, end) => {
    requests.push([begin, end])
    return blob.slice(begin, end).arrayBuffer()
  }, error => readErrors.push(error))
  const loadingTask = getRangePDFDocument(range, { rangeChunkSize: 64 * 1024 })

  try {
    const pdf = await loadingTask.promise
    assert.ok(pdf.numPages >= 1)
    const page = await pdf.getPage(1)
    assert.ok(page.getViewport({ scale: 1 }).width > 0)
    assert.ok(requests.length > 0)
    assert.ok(requests.every(([begin, end]) => end > begin && end - begin <= 64 * 1024))
    assert.deepEqual(readErrors, [])
  } finally {
    range.abort()
    await loadingTask.destroy()
  }
})

test('a virtual 400 MiB PDF opens without reading its unused data stream', { timeout: 15000 }, async () => {
  const encoder = new TextEncoder()
  let header = '%PDF-1.4\n'
  const offsets = [0]
  const object = (number: number, body: string) => {
    offsets[number] = encoder.encode(header).length
    header += `${number} 0 obj\n${body}\nendobj\n`
  }
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>')
  object(4, '<< /Length 0 >>\nstream\nendstream')
  offsets[5] = encoder.encode(header).length
  const unusedBytes = 400 * 1024 * 1024
  header += `5 0 obj\n<< /Length ${unusedBytes} >>\nstream\n`
  const prefix = encoder.encode(header)
  const streamEnd = '\nendstream\nendobj\n'
  const xrefOffset = prefix.length + unusedBytes + encoder.encode(streamEnd).length
  const xref = `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  const suffix = encoder.encode(streamEnd + xref)
  const length = prefix.length + unusedBytes + suffix.length
  let bytesRead = 0
  const range = new PDFBlobRangeTransport(length, async (begin, end) => {
    bytesRead += end - begin
    const output = new Uint8Array(end - begin)
    const prefixEnd = Math.min(end, prefix.length)
    if (begin < prefixEnd) output.set(prefix.subarray(begin, prefixEnd))
    const suffixStart = prefix.length + unusedBytes
    if (end > suffixStart) {
      const from = Math.max(begin, suffixStart)
      output.set(suffix.subarray(from - suffixStart, end - suffixStart), from - begin)
    }
    return output.buffer
  }, error => { throw error })
  const loadingTask = getRangePDFDocument(range)

  try {
    const pdf = await loadingTask.promise
    assert.equal(pdf.numPages, 1)
    const page = await pdf.getPage(1)
    assert.equal(Math.round(page.getViewport({ scale: 1 }).width), 612)
    assert.ok(bytesRead < 20 * 1024 * 1024, `read ${bytesRead} bytes`)
  } finally {
    range.abort()
    await loadingTask.destroy()
  }
})
