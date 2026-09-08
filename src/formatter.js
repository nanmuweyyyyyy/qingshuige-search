export function makeSnippet(content, position, length) {
  const text = String(content ?? "")
  if (!text.trim()) return ""
  const safePosition = Math.max(0, Math.min(position ?? 0, text.length))
  let start = Math.max(0, safePosition - Math.floor(length / 2))
  let end = Math.min(text.length, start + length)
  // Keep UTF-16 surrogate pairs intact when clipping CJK extension characters or emoji.
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(text[start])) start -= 1
  if (end < text.length && /[\uDC00-\uDFFF]/u.test(text[end])) end += 1
  const excerpt = text.slice(start, end).replace(/\s+/gu, " ").trim()
  return `${start > 0 ? "…" : ""}${excerpt}${end < text.length ? "…" : ""}`
}

/** Format after ranking/limiting, so a custom result shape cannot affect ordering. */
export function defaultFormatter({ candidate, document, score, coverage, options }) {
  return {
    article: document.article, documentId: document.docId, externalId: document.externalId, score, coverage,
    matchedFields: {
      title: candidate.titleMatch, author: candidate.authorMatch,
      date: candidate.dateMatch, body: candidate.bodyGroups.size > 0
    },
    matchedTokens: [...candidate.matchedTokens],
    snippet: makeSnippet(document.article.content, candidate.firstBodyPosition ?? 0, options.snippetLength)
  }
}
