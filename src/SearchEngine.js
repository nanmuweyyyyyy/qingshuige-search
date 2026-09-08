import { buildIndexes } from "./index-builder.js"
import { kmpIndexOf } from "./kmp.js"
import { normalizeText } from "./normalizer.js"
import { parseDateQuery } from "./date-query.js"
import { intersectSorted } from "./set-ops.js"
import { resolveOptions, validateInteger, validateMatchMode } from "./options.js"

function matchesDate(document, query) {
  return query && document.date.year === query.year
    && (query.month == null || document.date.month === query.month)
    && (query.day == null || document.date.day === query.day)
}

function matchText(text, query) {
  if (!query || !text.includes(query)) return null
  return text === query ? "exact" : text.startsWith(query) ? "prefix" : "contains"
}

function queryGroups(tokenizer, query, options) {
  const groups = tokenizer.tokenizeQuery(query, options)
  if (!Array.isArray(groups)) throw new TypeError("tokenizer.tokenizeQuery must return an array")
  return groups.map((group) => {
    if (!group || typeof group.raw !== "string" || !Array.isArray(group.tokens)
      || group.tokens.some((token) => typeof token !== "string" || !token.trim())) {
      throw new TypeError("Query groups must contain raw text and an array of non-empty tokens")
    }
    const tokens = [...new Set(group.tokens.map(normalizeText))]
    return { ...group, raw: normalizeText(group.raw), tokens, bodySearchable: group.bodySearchable ?? tokens.length > 0 }
  })
}

/** Framework-independent, synchronous in-memory search. */
export class SearchEngine {
  constructor(options = {}) {
    this.options = resolveOptions(options)
    this.articles = []
    this.documents = []
    this.authorIndex = new Map()
    this.categoryIndex = new Map()
    this.bodyIndex = new Map()
  }

  load(articles) {
    // Build before replacing live state: an invalid reload leaves the previous index usable.
    const indexes = buildIndexes(articles, this.options)
    Object.assign(this, indexes)
    this.articles = indexes.documents.map((document) => document.article)
    return this
  }

  search(query, searchOptions = {}) {
    if (!searchOptions || typeof searchOptions !== "object" || Array.isArray(searchOptions)) {
      throw new TypeError("Search query options must be an object")
    }
    const limit = searchOptions.limit ?? this.options.maxResults
    const matchMode = searchOptions.matchMode ?? this.options.matchMode
    validateInteger(limit, "limit", 0)
    validateMatchMode(matchMode)
    const normalizedQuery = normalizeText(query)
    if (!normalizedQuery || limit === 0) return []
    const scope = this.#resolveScope(searchOptions.category)
    if (scope?.size === 0) return []
    const groups = queryGroups(this.options.tokenizer, query, this.options)
    const dateQuery = parseDateQuery(query)
    const candidates = new Map()
    const ensureCandidate = (docId) => {
      if (scope && !scope.has(docId)) return null
      if (!candidates.has(docId)) {
        candidates.set(docId, {
          docId, titleMatch: null, authorMatch: null, dateMatch: false,
          matchedGroups: new Set(), titleGroups: new Set(), authorGroups: new Set(),
          bodyGroups: new Set(), matchedTokens: new Set(), bodyPostings: new Map(),
          phraseInBody: false, firstBodyPosition: null
        })
      }
      return candidates.get(docId)
    }

    for (const document of this.documents) {
      if (scope && !scope.has(document.docId)) continue
      for (const field of ["title", "author"]) {
        const value = document.normalized[field]
        const fullMatch = matchText(value, normalizedQuery)
        if (fullMatch) {
          ensureCandidate(document.docId)[`${field}Match`] = field === "author" && fullMatch === "prefix" ? "contains" : fullMatch
        }
        groups.forEach((group, index) => {
          if (!matchText(value, group.raw)) return
          const candidate = ensureCandidate(document.docId)
          candidate[`${field}Match`] ??= "contains"
          candidate[`${field}Groups`].add(index)
          candidate.matchedGroups.add(index)
        })
      }
      if (matchesDate(document, dateQuery)) ensureCandidate(document.docId).dateMatch = true
    }
    this.#recallBody(groups, ensureCandidate)

    const statistics = {
      documentCount: this.documents.length,
      getDocumentFrequency: (token) => this.bodyIndex.get(token)?.length ?? 0
    }
    const ranked = []
    for (const candidate of candidates.values()) {
      // An explicit calendar query is one structured condition, regardless of tokenization.
      if (matchMode === "all" && !candidate.dateMatch && candidate.matchedGroups.size < groups.length) continue
      const document = this.documents[candidate.docId]
      const context = {
        article: document.article, document, candidate, groups,
        rawQuery: String(query ?? ""), query: normalizedQuery,
        coverage: groups.length > 0 ? candidate.matchedGroups.size / groups.length : 0,
        options: this.options, statistics
      }
      const score = this.options.ranker(context)
      if (typeof score !== "number" || !Number.isFinite(score)) {
        throw new TypeError("ranker must return a finite numeric score")
      }
      ranked.push({ ...context, score })
    }
    ranked.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      if (a.document.date.timestamp !== b.document.date.timestamp) {
        return a.document.date.timestamp > b.document.date.timestamp ? -1 : 1
      }
      return a.document.docId - b.document.docId
    })
    return ranked.slice(0, limit).map((context) => this.options.formatter(context))
  }

  #resolveScope(category) {
    if (category == null || category === "") return null
    if (typeof category !== "string") throw new TypeError("category must be a string")
    return new Set(this.categoryIndex.get(normalizeText(category)) ?? [])
  }

  #recallBody(groups, ensureCandidate) {
    const cache = new Map()
    const getEntry = (token) => {
      if (!cache.has(token)) {
        const postings = this.bodyIndex.get(token)
        cache.set(token, postings ? { token, postings, byId: new Map(postings.map((posting) => [posting.articleId, posting])) } : null)
      }
      return cache.get(token)
    }
    groups.forEach((group, groupIndex) => {
      if (!group.bodySearchable || group.tokens.length === 0) return
      const entries = group.tokens.map(getEntry)
      if (entries.some((entry) => entry == null)) return
      // Frequent terms may be omitted as anchors, never as matching conditions.
      // Fall back to all terms for small corpora and all-common-word queries.
      const selective = entries.filter(({ postings }) => postings.length / this.documents.length <= this.options.maxDocumentFrequencyRatio)
      const anchors = (selective.length > 0 ? selective : [...entries]).sort((a, b) => a.postings.length - b.postings.length)
      let ids = anchors[0].postings.map((posting) => posting.articleId)
      for (let i = 1; i < anchors.length && ids.length > 0; i += 1) {
        ids = intersectSorted(ids, anchors[i].postings.map((posting) => posting.articleId))
      }
      for (const docId of ids) {
        if (!entries.every(({ byId }) => byId.has(docId))) continue
        const document = this.documents[docId]
        const phrasePosition = kmpIndexOf(document.normalized.content, group.raw)
        if ((group.verifyPhrase ?? group.type === "han") && phrasePosition < 0) continue
        const candidate = ensureCandidate(docId)
        if (!candidate) continue
        candidate.bodyGroups.add(groupIndex)
        candidate.matchedGroups.add(groupIndex)
        candidate.phraseInBody ||= phrasePosition >= 0
        for (const { token, byId } of entries) {
          const posting = byId.get(docId)
          candidate.matchedTokens.add(token)
          candidate.bodyPostings.set(token, posting)
          const position = posting.positions[0]
          if (candidate.firstBodyPosition == null || position < candidate.firstBodyPosition) candidate.firstBodyPosition = position
        }
      }
    })
  }
}

export function createSearch(options = {}) {
  return new SearchEngine(options)
}
