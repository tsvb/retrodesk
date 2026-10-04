/**
 * Minimal Valve KeyValues (text VDF/ACF) parser.
 *
 *   "libraryfolders" { "0" { "path" "C:\\Program Files (x86)\\Steam" "apps" { "228980" "0" } } }
 *
 * Supports quoted and unquoted tokens, escape sequences (\" \\ \n \t), // comments and [$PLATFORM]
 * conditionals (ignored). Duplicate keys: the last one wins. Keys are kept as written; use `getKey` for
 * case-insensitive lookups (Valve files are inconsistent about case, e.g. "AppState" vs "appstate").
 */

export type VdfValue = string | VdfObject
export interface VdfObject {
  [key: string]: VdfValue
}

type Token = { t: 'str'; v: string } | { t: 'open' } | { t: 'close' }

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i] as string
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\uFEFF') {
      i++
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++
    } else if (c === '{') {
      out.push({ t: 'open' })
      i++
    } else if (c === '}') {
      out.push({ t: 'close' })
      i++
    } else if (c === '[') {
      // Platform conditional like [$WIN32]: skip.
      while (i < n && src[i] !== ']') i++
      i++
    } else if (c === '"') {
      i++
      let v = ''
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < n) {
          const e = src[i + 1]
          v += e === 'n' ? '\n' : e === 't' ? '\t' : e === '\\' ? '\\' : e === '"' ? '"' : `\\${e}`
          i += 2
        } else {
          v += src[i]
          i++
        }
      }
      i++ // closing quote
      out.push({ t: 'str', v })
    } else {
      let v = ''
      while (i < n && !/[\s{}"]/.test(src[i] as string)) {
        v += src[i]
        i++
      }
      out.push({ t: 'str', v })
    }
  }
  return out
}

export function parseVdf(src: string): VdfObject {
  const tokens = tokenize(src)
  let pos = 0
  const parseObject = (): VdfObject => {
    const obj: VdfObject = {}
    while (pos < tokens.length) {
      const tok = tokens[pos++] as Token
      if (tok.t === 'close') return obj
      if (tok.t !== 'str') continue // stray "{": ignore
      const next = tokens[pos]
      if (!next) break
      if (next.t === 'open') {
        pos++
        obj[tok.v] = parseObject()
      } else if (next.t === 'str') {
        pos++
        obj[tok.v] = next.v
      } else {
        // key followed by "}": malformed, stop this object
        pos++
        return obj
      }
    }
    return obj
  }
  return parseObject()
}

/** Case-insensitive property lookup. */
export function getKey(obj: VdfObject | undefined, key: string): VdfValue | undefined {
  if (!obj) return undefined
  if (key in obj) return obj[key]
  const k = key.toLowerCase()
  for (const [name, v] of Object.entries(obj)) if (name.toLowerCase() === k) return v
  return undefined
}

export function getObject(obj: VdfObject | undefined, key: string): VdfObject | undefined {
  const v = getKey(obj, key)
  return typeof v === 'object' ? v : undefined
}

export function getString(obj: VdfObject | undefined, key: string): string | undefined {
  const v = getKey(obj, key)
  return typeof v === 'string' ? v : undefined
}
