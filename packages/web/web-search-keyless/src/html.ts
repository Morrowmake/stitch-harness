/**
 * Minimal HTML reading for the server-rendered DuckDuckGo HTML endpoint: opening-tag scanning,
 * attribute parsing, tag stripping, and entity decoding. It is not a general HTML parser; it reads
 * the flat, script-free markup `html.duckduckgo.com` serves and nothing else.
 * @module @deepseek-ai/dsh-web-search-keyless/html
 */

/** One opening tag found in a document. */
export interface OpeningTag {
  /** Lowercase element name. */
  readonly name: string
  /** Parsed attributes, names lowercased, values entity-decoded. */
  readonly attributes: ReadonlyMap<string, string>
  /** Offset of `<` in the scanned text. */
  readonly start: number
  /** Offset just past the tag's closing `>`. */
  readonly end: number
}

const OPENING_TAG = /<([a-z][a-z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/giu
const ATTRIBUTE = /([^\s"'=<>/`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu
const TAG = /<[^>]*>/gu
const COMMENT = /<!--[\s\S]*?-->/gu

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»',
}

/**
 * Scan every opening tag of `html` in document order, skipping comments.
 * @param html - the markup to scan.
 * @returns the opening tags with their offsets.
 */
export function openingTags(html: string): OpeningTag[] {
  const text = html.replace(COMMENT, comment => ' '.repeat(comment.length))
  const tags: OpeningTag[] = []
  for (const match of text.matchAll(OPENING_TAG)) {
    // Both groups always participate in an OPENING_TAG match.
    const [whole, name, attributes] = match as RegExpExecArray & [string, string, string]
    tags.push({
      name: name.toLowerCase(),
      attributes: parseAttributes(attributes),
      start: match.index,
      end: match.index + whole.length,
    })
  }
  return tags
}

/**
 * Parse the attribute text of one opening tag. The first occurrence of a repeated name wins, as in HTML.
 * @param text - the text between the element name and the closing `>`.
 * @returns attribute values by lowercase name; a bare attribute has the empty value.
 */
export function parseAttributes(text: string): Map<string, string> {
  const attributes = new Map<string, string>()
  for (const match of text.matchAll(ATTRIBUTE)) {
    // The name group always participates in an ATTRIBUTE match.
    const name = (match[1] as string).toLowerCase()
    if (attributes.has(name)) continue
    attributes.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''))
  }
  return attributes
}

/**
 * The whitespace-separated class tokens of a tag.
 * @param tag - the opening tag.
 * @returns its class tokens.
 */
export function classesOf(tag: OpeningTag): string[] {
  return (tag.attributes.get('class') ?? '').split(/\s+/u).filter(token => token.length > 0)
}

/**
 * The inner markup of an element whose opening tag is `tag`, up to the first matching close tag.
 * DuckDuckGo never nests a result title or snippet element inside another of the same name.
 * @param html - the scanned markup.
 * @param tag - the element's opening tag, scanned from `html`.
 * @returns the inner markup, or undefined when the element is never closed.
 */
export function innerHtml(html: string, tag: OpeningTag): string | undefined {
  const close = html.toLowerCase().indexOf(`</${tag.name}`, tag.end)
  return close === -1 ? undefined : html.slice(tag.end, close)
}

/**
 * Plain text of a markup fragment: tags removed, entities decoded, whitespace collapsed.
 * @param html - the fragment.
 * @returns the trimmed text.
 */
export function textOf(html: string): string {
  return decodeEntities(html.replace(COMMENT, '').replace(TAG, ''))
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * Decode numeric character references and the named entities search snippets use. An unknown
 * named entity or an invalid code point stays verbatim.
 * @param text - text that may contain character references.
 * @returns the decoded text.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (reference, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const codePoint = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
      return codePoint > 0 && codePoint <= 0x10_FFFF ? String.fromCodePoint(codePoint) : reference
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? reference
  })
}
