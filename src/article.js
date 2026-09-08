const EMPTY_DATE = Object.freeze({ timestamp: Number.NEGATIVE_INFINITY, year: null, month: null, day: null })

export function isCalendarDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

/** Accept ISO dates/RFC3339 timestamps; calendar fields retain the publisher's timezone. */
export function parseArticleDate(value) {
  if (value == null || value === "" || (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date))) {
    return { ...EMPTY_DATE }
  }
  let written = null
  if (typeof value === "string") {
    value = value.trim()
    // Avoid Date.parse's locale-dependent guesses and overflow normalization.
    written = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|([+-])(\d{2}):(\d{2})))?$/u)
    if (!written || !isCalendarDate(Number(written[1]), Number(written[2]), Number(written[3]))) return { ...EMPTY_DATE }
    if (written[4] != null && (Number(written[4]) > 23 || Number(written[5]) > 59 || Number(written[6]) > 59
      || (written[9] != null && (Number(written[9]) > 23 || Number(written[10]) > 59)))) return { ...EMPTY_DATE }
  }
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return { ...EMPTY_DATE }
  const year = written ? Number(written[1]) : date.getUTCFullYear()
  const month = written ? Number(written[2]) : date.getUTCMonth() + 1
  const day = written ? Number(written[3]) : date.getUTCDate()
  if (!isCalendarDate(year, month, day)) return { ...EMPTY_DATE }
  return { timestamp: date.getTime(), year, month, day }
}

function text(value, field) {
  if (value == null) return ""
  if (!["string", "number", "boolean"].includes(typeof value)) {
    throw new TypeError(`Article.${field} must be text`)
  }
  return String(value)
}

function list(value, field) {
  const values = value == null ? [] : Array.isArray(value) ? value : [value]
  return [...new Set(values.map((item) => text(item, field).trim()).filter(Boolean))]
}

/** Normalize one platform-independent article, preserving platform-specific metadata. */
export function normalizeArticle(article, index = 0) {
  if (article == null || typeof article !== "object" || Array.isArray(article) || article instanceof Date) {
    throw new TypeError(`Article at index ${index} must be an object`)
  }
  const title = text(article.title, "title").trim()
  const content = text(article.content, "content")
  if (!title && !content.trim()) {
    throw new TypeError(`Article at index ${index} must have a non-empty title or content`)
  }
  const id = article.id ?? index
  if ((typeof id !== "string" && typeof id !== "number") || (typeof id === "number" && !Number.isFinite(id))) {
    throw new TypeError(`Article at index ${index} must have a string or finite numeric id`)
  }
  const parsedDate = parseArticleDate(article.date)
  const date = parsedDate.year == null ? null
    : typeof article.date === "string" ? article.date.trim() : new Date(parsedDate.timestamp).toISOString()
  return {
    ...article, id, title, content,
    author: Array.isArray(article.author) ? list(article.author, "author").join(", ") : text(article.author, "author").trim(),
    date,
    categories: list(article.categories, "categories"),
    tags: list(article.tags, "tags"),
    url: text(article.url, "url").trim()
  }
}

export function normalizeArticles(articles) {
  if (!Array.isArray(articles)) throw new TypeError("SearchEngine.load expects an Article[]")
  return Array.from(articles, (article, index) => normalizeArticle(article, index))
}
