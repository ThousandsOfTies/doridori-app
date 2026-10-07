import type { BookPageIndex } from './bookIndex'

export type PageVector = { pageNumber: number; vector: number[] | null }
export type RelatedPages = { pageNumber: number; relatedPages: number[] }
type Candidate = { index: number; similarity: number }

export function averageBookPageVector(page: BookPageIndex): number[] | null {
  const vectors = page.passages.map(passage => passage.vector).filter((vector): vector is number[] => !!vector)
  if (!vectors.length) return null
  const average = vectors[0].map((_, index) => vectors.reduce((sum, vector) => sum + vector[index], 0) / vectors.length)
  const length = Math.hypot(...average)
  return length ? average.map(value => value / length) : null
}

// Incremental so the non-worker fallback can yield and stop between small chunks.
export function createRelatedPageCalculation(pages: PageVector[]) {
  const candidates = pages.map(() => [] as Candidate[])
  const usable = pages.flatMap((page, index) => page.vector ? [{ index, vector: page.vector }] : [])
  let row = 0, column = 1, comparisons = 0
  const offer = (index: number, other: number, similarity: number) => {
    if (!(similarity >= 0.7)) return
    const top = candidates[index]
    const candidate = { index: other, similarity }
    const position = top.findIndex(item => item.similarity < similarity ||
      (item.similarity === similarity && item.index > other))
    if (position < 0) { if (top.length < 3) top.push(candidate) }
    else { top.splice(position, 0, candidate); if (top.length > 3) top.pop() }
  }
  return {
    step(maxPairs = 512): boolean {
      let remaining = maxPairs
      while (row < usable.length - 1 && remaining-- > 0) {
        const first = usable[row], second = usable[column]
        let similarity = 0
        const dimensions = Math.min(first.vector.length, second.vector.length)
        for (let i = 0; i < dimensions; i++) {
          similarity += first.vector[i] * second.vector[i]
        }
        // Existing indexes may contain vectors of different lengths. Preserve the
        // old directional reduce behavior (the longer vector's missing term is NaN).
        if (first.vector.length <= second.vector.length) offer(first.index, second.index, similarity)
        if (second.vector.length <= first.vector.length) offer(second.index, first.index, similarity)
        comparisons++
        if (++column >= usable.length) { row++; column = row + 1 }
      }
      return row >= usable.length - 1
    },
    result(): RelatedPages[] {
      return usable.map(({ index }) => ({ pageNumber: pages[index].pageNumber,
        relatedPages: candidates[index].map(item => pages[item.index].pageNumber) }))
    },
    get comparisons() { return comparisons },
  }
}
