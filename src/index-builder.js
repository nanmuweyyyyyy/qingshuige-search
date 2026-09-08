import { normalizeText } from "./normalizer.js"
import { tokenize } from "./tokenizer.js"
import { normalizeArticles, parseArticleDate } from "./article.js"

function pushToIndex(index, key, docId) {
  const list = index.get(key)
  if (list) list.push(docId)
  else index.set(key, [docId])
}

/**
 * Build all structures required by SearchEngine from a plain Article[].
 */
export function buildIndexes(articles, options = {}) {
  const documents = []
  const authorIndex = new Map()
  const categoryIndex = new Map()
  const bodyIndex = new Map()

  normalizeArticles(articles).forEach((article, docId) => {
    const normalized = {
      title: normalizeText(article.title),
      author: normalizeText(article.author),
      content: normalizeText(article.content)
    }

    const categories = [...new Set(article.categories.map(normalizeText).filter(Boolean))]

    const document = {
      docId,
      externalId: article.id ?? docId,
      article,
      normalized,
      date: parseArticleDate(article.date),
      categories
    }

    documents.push(document)

    if (normalized.author) pushToIndex(authorIndex, normalized.author, docId)
    for (const category of categories) pushToIndex(categoryIndex, category, docId)

    const perToken = new Map()
    const occurrences = options.tokenizer
      ? options.tokenizer.tokenize(article.content, options) : tokenize(article.content, options)
    if (!Array.isArray(occurrences)) throw new TypeError("tokenizer.tokenize must return an array")
    for (const occurrence of occurrences) {
      if (!occurrence || typeof occurrence.value !== "string" || !occurrence.value.trim()
        || !Number.isSafeInteger(occurrence.position) || occurrence.position < 0 || occurrence.position > article.content.length) {
        throw new TypeError("Token occurrences must contain a non-empty value and a valid UTF-16 position")
      }
      const value = normalizeText(occurrence.value)
      const entry = perToken.get(value)
      if (entry) {
        entry.frequency += 1
        entry.positions.push(occurrence.position)
      } else {
        perToken.set(value, {
          articleId: docId,
          frequency: 1,
          positions: [occurrence.position]
        })
      }
    }

    for (const [token, posting] of perToken) {
      const list = bodyIndex.get(token)
      if (list) list.push(posting)
      else bodyIndex.set(token, [posting])
    }
  })

  // Article iteration gives ascending docIds, but explicit sorting keeps this
  // invariant safe if index construction changes later.
  for (const list of bodyIndex.values()) {
    list.sort((a, b) => a.articleId - b.articleId)
  }

  return {
    documents,
    authorIndex,
    categoryIndex,
    bodyIndex
  }
}
