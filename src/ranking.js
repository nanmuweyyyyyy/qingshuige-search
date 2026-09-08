import { kmpIndexOf } from "./kmp.js"

/** Default relevance strategy. Custom rankers receive the same search context. */
export function defaultRanker({ candidate, document, query, coverage, options, statistics }) {
  const { weights } = options
  let score = 0
  if (candidate.titleMatch === "exact") score += weights.titleExact
  else if (candidate.titleMatch === "prefix") score += weights.titlePrefix
  else if (candidate.titleMatch === "contains") score += weights.titleContains
  if (candidate.authorMatch === "exact") score += weights.authorExact
  else if (candidate.authorMatch === "contains") score += weights.authorContains
  score += coverage * weights.coverage
  for (const [token, posting] of candidate.bodyPostings) {
    const tf = 1 + Math.log(posting.frequency)
    const idf = Math.log((statistics.documentCount + 1) / (statistics.getDocumentFrequency(token) + 1)) + 1
    score += tf * idf
  }
  if (query && kmpIndexOf(document.normalized.title, query) >= 0) score += weights.titlePhrase
  if (candidate.phraseInBody) score += weights.bodyPhrase
  return candidate.dateMatch && score === 0 ? 1 : score
}
