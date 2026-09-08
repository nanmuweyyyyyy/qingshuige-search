import { normalizeText, normalizeForTokenization } from "./normalizer.js"

// Exclude Han from the word branch so prose such as “使用Hugo开发” splits correctly.
const WORD_START = String.raw`(?:(?!\p{Script=Han})[\p{L}\p{N}])`
const WORD_CONTINUE = String.raw`(?:(?!\p{Script=Han})[\p{L}\p{N}\p{M}])`
const WORD = `${WORD_START}${WORD_CONTINUE}*`
const SEGMENT_RE = new RegExp(String.raw`\p{Script=Han}+|${WORD}(?:[-_.]${WORD})*`, "gu")
const HAN_RE = /^\p{Script=Han}+$/u

function validateOptions(hanGramSize, minWordLength) {
  if (!Number.isSafeInteger(hanGramSize) || hanGramSize < 2) throw new RangeError("hanGramSize must be an integer >= 2")
  if (!Number.isSafeInteger(minWordLength) || minWordLength < 1) throw new RangeError("minWordLength must be an integer >= 1")
}

/**
 * Split body text into searchable token occurrences.
 *
 * Rules:
 * - Han text: sliding bigrams; a single Han character is intentionally ignored.
 * - Other letters/digits: keep contiguous words/model numbers as one token.
 * - punctuation/whitespace: boundaries.
 *
 * Position is a UTF-16 offset in the original input. It is suitable for
 * extracting browser-side snippets from normal Chinese/Latin prose.
 */
export function tokenize(text, options = {}) {
  const {
    hanGramSize = 2,
    minWordLength = 2
  } = options

  validateOptions(hanGramSize, minWordLength)

  const { text: input, positionAt } = normalizeForTokenization(text)
  const occurrences = []

  for (const match of input.matchAll(SEGMENT_RE)) {
    const raw = match[0]
    const start = match.index ?? 0

    if (HAN_RE.test(raw)) {
      const chars = Array.from(raw)
      if (chars.length < hanGramSize) continue

      // Compute UTF-16 offsets so snippet positions map back to the original string.
      const offsets = []
      let offset = 0
      for (const char of chars) {
        offsets.push(offset)
        offset += char.length
      }

      for (let i = 0; i <= chars.length - hanGramSize; i += 1) {
        const value = normalizeText(chars.slice(i, i + hanGramSize).join(""))
        occurrences.push({ value, position: positionAt(start + offsets[i]) })
      }
      continue
    }

    const value = normalizeText(raw)
    if (Array.from(value).length < minWordLength) continue
    occurrences.push({ value, position: positionAt(start) })

    // Versioned technical words are searchable by both exact form and base name:
    // vue3 -> vue3 + vue, gpt-5 -> gpt-5 + gpt. Model numbers beginning
    // with digits (e.g. 74HC193) stay exact to avoid noisy aliases.
    const versioned = value.match(/^(\p{L}{2,})[-_.]?\d+$/u)
    if (versioned && Array.from(versioned[1]).length >= minWordLength) {
      occurrences.push({ value: versioned[1], position: positionAt(start) })
    }
  }

  return occurrences
}

/**
 * Parse a user query into logical groups.
 * Tokens inside one Han group are AND-ed; separate groups are OR-ed during
 * candidate recall. Example: "计算机 Hugo" -> [["计算", "算机"], ["hugo"]].
 */
export function tokenizeQuery(query, options = {}) {
  const {
    hanGramSize = 2,
    minWordLength = 2
  } = options

  validateOptions(hanGramSize, minWordLength)

  const input = String(query ?? "").normalize("NFKC")
  const groups = []

  for (const match of input.matchAll(SEGMENT_RE)) {
    const raw = match[0]
    const normalized = normalizeText(raw)

    if (HAN_RE.test(raw)) {
      const chars = Array.from(normalized)
      if (chars.length < hanGramSize) {
        groups.push({ raw: normalized, tokens: [], bodySearchable: false, type: "han" })
        continue
      }

      const tokens = []
      for (let i = 0; i <= chars.length - hanGramSize; i += 1) {
        tokens.push(chars.slice(i, i + hanGramSize).join(""))
      }
      groups.push({ raw: normalized, tokens, bodySearchable: true, type: "han" })
      continue
    }

    const bodySearchable = Array.from(normalized).length >= minWordLength
    groups.push({
      raw: normalized,
      tokens: bodySearchable ? [normalized] : [],
      bodySearchable,
      type: "word"
    })
  }

  return groups
}

export const defaultTokenizer = Object.freeze({ tokenize, tokenizeQuery })
