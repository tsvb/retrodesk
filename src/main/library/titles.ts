import { fold } from './util'

/**
 * No-Intro / Redump / TOSEC / GoodTools file name parsing.
 *
 *   "Legend of Zelda, The - A Link to the Past (USA) (Rev 1) [!]"
 *     -> title "The Legend of Zelda: A Link to the Past", regions ["USA"], tags ["Rev 1"]
 *
 * Rules:
 *  - "(...)" and "[...]" groups are removed from the title. A group made only of region names/codes becomes
 *    `regions`; every other group (except the "[!]" verified-dump marker) becomes a tag.
 *  - Each " - " separated segment has a trailing article moved to the front ("Zelda, The" -> "The Zelda").
 *  - No-Intro writes subtitles as " - " (":" is illegal in file names): the FIRST " - " becomes ": ",
 *    later ones stay " - " ("Star Wars - Episode I - Racer" -> "Star Wars: Episode I - Racer").
 *  - A name with no spaces but underscores ("super_mario_world") has its underscores turned into spaces.
 */

export interface ParsedName {
  title: string
  regions: string[]
  tags: string[]
}

/** Full region names as No-Intro/Redump write them (canonical output form). */
const REGION_NAMES = [
  'USA', 'Europe', 'Japan', 'World', 'Korea', 'Brazil', 'Germany', 'France', 'Spain', 'Italy', 'Australia', 'Asia',
  'Canada', 'China', 'Hong Kong', 'Taiwan', 'Netherlands', 'Sweden', 'Russia', 'Scandinavia', 'UK', 'Denmark',
  'Finland', 'Norway', 'Portugal', 'Poland', 'Greece', 'Mexico', 'Argentina', 'India', 'Latin America', 'New Zealand',
  'Belgium', 'Switzerland', 'Austria', 'Ireland', 'South Africa', 'Turkey', 'Israel', 'Croatia', 'Czech', 'Hungary',
  'United Arab Emirates', 'Singapore', 'Thailand', 'Indonesia', 'Unknown'
]
const REGION_BY_LOWER = new Map(REGION_NAMES.map((r) => [r.toLowerCase(), r]))
REGION_BY_LOWER.set('united kingdom', 'UK')
REGION_BY_LOWER.set('united states', 'USA')
REGION_BY_LOWER.set('us', 'USA')

/** TOSEC ISO-3166 style codes (upper-case, may be joined with "-"), e.g. "(US)", "(US-EU)". */
const TOSEC_CODES: Record<string, string> = {
  US: 'USA', EU: 'Europe', JP: 'Japan', DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', GB: 'UK', UK: 'UK',
  KR: 'Korea', BR: 'Brazil', AU: 'Australia', NL: 'Netherlands', SE: 'Sweden', CN: 'China', TW: 'Taiwan', HK: 'Hong Kong',
  RU: 'Russia', CA: 'Canada', DK: 'Denmark', FI: 'Finland', NO: 'Norway', PT: 'Portugal', PL: 'Poland', GR: 'Greece',
  AS: 'Asia', AT: 'Austria', BE: 'Belgium', CH: 'Switzerland', IE: 'Ireland', MX: 'Mexico', NZ: 'New Zealand'
}

/** GoodTools single/multi-letter codes, e.g. "(U)", "(JUE)". */
const GOODTOOLS_CODES: Record<string, string[]> = {
  U: ['USA'], E: ['Europe'], J: ['Japan'], W: ['World'], K: ['Korea'], G: ['Germany'], F: ['France'], S: ['Spain'],
  I: ['Italy'], A: ['Australia'], B: ['Brazil'], C: ['China'], NL: ['Netherlands'], SW: ['Sweden'], HK: ['Hong Kong'],
  UE: ['USA', 'Europe'], JU: ['Japan', 'USA'], JE: ['Japan', 'Europe'], JUE: ['Japan', 'USA', 'Europe'], EU: ['Europe'],
  Unk: ['Unknown']
}

/** Parse a group's content as a list of regions; undefined if it's not purely regions. */
export function parseRegionGroup(content: string): string[] | undefined {
  const c = content.trim()
  if (!c) return undefined
  const parts = c.split(/\s*,\s*/)
  const full = parts.map((p) => REGION_BY_LOWER.get(p.toLowerCase()))
  if (full.every((r): r is string => !!r) && parts.every((p) => p.length > 2 || p.toUpperCase() === p)) {
    return dedupe(full)
  }
  // TOSEC: "US", "US-EU", "JP-US" (case-sensitive so language codes like "De" are not taken as regions).
  if (/^[A-Z]{2}(-[A-Z]{2})*$/.test(c)) {
    const codes = c.split('-').map((x) => TOSEC_CODES[x])
    if (codes.every((r): r is string => !!r)) return dedupe(codes)
  }
  const gt = GOODTOOLS_CODES[c]
  if (gt) return gt.slice()
  return undefined
}

function dedupe(a: string[]): string[] {
  return [...new Set(a)]
}

const ARTICLES = ['The', 'A', 'An', 'Die', 'Der', 'Das', 'Le', 'La', 'Les', "L'", 'El', 'Los', 'Las', 'Il', 'Gli', 'De', 'Het', 'Een']
const TRAILING_ARTICLE = new RegExp(`^(.+?),\\s+(${ARTICLES.map((a) => a.replace("'", "\\'")).join('|')})$`, 'i')

/** "Legend of Zelda, The" -> "The Legend of Zelda"; "Aventure, L'" -> "L'Aventure". */
export function moveTrailingArticle(segment: string): string {
  const m = TRAILING_ARTICLE.exec(segment.trim())
  if (!m || !m[1] || !m[2]) return segment.trim()
  const canonical = ARTICLES.find((a) => a.toLowerCase() === m[2]?.toLowerCase()) ?? m[2]
  return canonical.endsWith("'") ? `${canonical}${m[1]}` : `${canonical} ${m[1]}`
}

const GROUP_RE = /\(([^()]*)\)|\[([^[\]]*)\]/g

/** Strip all "(...)" / "[...]" groups and tidy whitespace. */
export function stripGroups(name: string): string {
  return name.replace(GROUP_RE, ' ').replace(/\s+/g, ' ').trim()
}

export function parseRomName(rawName: string): ParsedName {
  let name = rawName.trim()
  if (!name.includes(' ') && name.includes('_')) name = name.replace(/_+/g, ' ')

  const regions: string[] = []
  const tags: string[] = []
  for (const m of name.matchAll(GROUP_RE)) {
    const inParens = m[1] !== undefined
    const content = (m[1] ?? m[2] ?? '').trim()
    if (!content || content === '!') continue
    const reg = inParens ? parseRegionGroup(content) : undefined
    if (reg) {
      for (const r of reg) if (!regions.includes(r)) regions.push(r)
    } else if (!tags.includes(content)) {
      tags.push(content)
    }
  }

  const base = stripGroups(name)
  const segments = base.split(/\s+-\s+/).map(moveTrailingArticle).filter((s) => s.length > 0)
  let title = segments[0] ?? ''
  if (segments.length > 1) title += `: ${segments.slice(1).join(' - ')}`
  title = title.replace(/\s+/g, ' ').trim()
  if (!title) title = rawName.trim()
  return { title, regions, tags }
}

const LEADING_ARTICLE = /^(the|a|an)\s+/

/**
 * Key for fuzzy matching two names of the same game: tags removed, articles removed, case/diacritics/punctuation
 * ignored ("&" and its thumbnail substitute "_" are dropped). "Legend of Zelda, The - A Link to the Past (USA)" and "The Legend of Zelda: A Link to the Past"
 * both become "legendofzeldalinktothepast".
 */
export function matchKey(name: string): string {
  const { title } = parseRomName(name)
  return fold(title)
    .split(/\s*[:]\s+|\s+-\s+/)
    .map((seg) => seg.trim().replace(LEADING_ARTICLE, ''))
    .join(' ')
    .replace(/[^a-z0-9]+/g, '')
}
