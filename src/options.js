import { defaultTokenizer } from "./tokenizer.js"
import { defaultRanker } from "./ranking.js"
import { defaultFormatter } from "./formatter.js"

export const DEFAULT_OPTIONS = Object.freeze({
  hanGramSize: 2, minWordLength: 2, maxDocumentFrequencyRatio: 0.6,
  maxResults: 20, snippetLength: 110, matchMode: "any",
  weights: Object.freeze({
    titleExact: 20, titlePrefix: 15, titleContains: 10,
    authorExact: 8, authorContains: 5,
    coverage: 10, titlePhrase: 10, bodyPhrase: 5
  })
})

function object(value, name) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`)
}

export function validateInteger(value, name, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`${name} must be an integer >= ${minimum}`)
}

export function validateMatchMode(value) {
  if (value !== "any" && value !== "all") throw new RangeError('matchMode must be "any" or "all"')
}

export function resolveOptions(options = {}) {
  object(options, "Search options")
  if (options.weights !== undefined) object(options.weights, "weights")
  const merged = {
    ...DEFAULT_OPTIONS, tokenizer: defaultTokenizer, ranker: defaultRanker, formatter: defaultFormatter,
    ...options, weights: Object.freeze({ ...DEFAULT_OPTIONS.weights, ...options.weights })
  }
  validateInteger(merged.hanGramSize, "hanGramSize", 2)
  validateInteger(merged.minWordLength, "minWordLength")
  validateInteger(merged.maxResults, "maxResults")
  validateInteger(merged.snippetLength, "snippetLength")
  validateMatchMode(merged.matchMode)
  const ratio = merged.maxDocumentFrequencyRatio
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new RangeError("maxDocumentFrequencyRatio must be between 0 and 1")
  for (const [key, value] of Object.entries(merged.weights)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new RangeError(`weights.${key} must be a finite non-negative number`)
  }
  object(merged.tokenizer, "tokenizer")
  for (const name of ["tokenize", "tokenizeQuery"]) {
    if (typeof merged.tokenizer[name] !== "function") throw new TypeError(`tokenizer.${name} must be a function`)
  }
  for (const name of ["ranker", "formatter"]) {
    if (typeof merged[name] !== "function") throw new TypeError(`${name} must be a function`)
  }
  return Object.freeze(merged)
}
