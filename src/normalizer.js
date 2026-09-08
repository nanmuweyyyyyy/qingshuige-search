/**
 * Normalize text for search comparisons without mutating display text.
 */
export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u00a0]+/gu, " ")
    .trim()
}

let graphemeSegmenter

/** Normalize before token boundaries are chosen, retaining original UTF-16 positions. */
export function normalizeForTokenization(value) {
  const source = String(value ?? "")
  const text = source.normalize("NFKC")
  if (text === source) return { text, positionAt: (position) => position }

  if (typeof Intl.Segmenter === "function") {
    graphemeSegmenter ??= new Intl.Segmenter("und", { granularity: "grapheme" })
    const offsets = new Uint32Array(text.length)
    let position = 0
    let compatible = true
    for (const { segment, index } of graphemeSegmenter.segment(source)) {
      const normalized = segment.normalize("NFKC")
      if (!text.startsWith(normalized, position)) {
        compatible = false
        break
      }
      for (let i = 0; i < normalized.length; i += 1) {
        offsets[position + i] = segment === normalized ? index + i : index
      }
      position += normalized.length
    }
    if (compatible && position === text.length) {
      return { text, positionAt: (index) => offsets[index] ?? source.length }
    }
  }

  // Older runtimes can still map token starts correctly without Intl.Segmenter.
  // Prefix normalization also handles the rare case of composition across a grapheme boundary.
  const boundaries = [0]
  for (const character of source) boundaries.push(boundaries.at(-1) + character.length)
  const lengths = new Map([[0, 0], [boundaries.length - 1, text.length]])
  const normalizedLength = (index) => {
    if (!lengths.has(index)) lengths.set(index, source.slice(0, boundaries[index]).normalize("NFKC").length)
    return lengths.get(index)
  }
  return {
    text,
    positionAt(position) {
      let low = 0
      let high = boundaries.length - 1
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (normalizedLength(middle) <= position) low = middle
        else high = middle - 1
      }
      return boundaries[low]
    }
  }
}
