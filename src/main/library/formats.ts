import { readFile, open } from 'fs/promises'
import { basename, dirname, extname, join, resolve } from 'path'

/**
 * Parsers for multi-file disc formats and directory-format game metadata.
 * All functions return absolute paths and never throw on malformed input (they return what they could parse).
 */

const MAX_TEXT = 1024 * 1024 // entry-point files are tiny; refuse to read anything huge

async function readSmallText(p: string): Promise<string> {
  const fh = await open(p, 'r')
  try {
    const { size } = await fh.stat()
    if (size > MAX_TEXT) return ''
    const buf = Buffer.alloc(size)
    await fh.read(buf, 0, size, 0)
    return buf.toString('utf8').replace(/^﻿/, '')
  } finally {
    await fh.close()
  }
}

/** FILE "Track 01.bin" BINARY  -> data files referenced by a .cue (or cdrdao .toc). */
export function parseCueText(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*FILE\s+(?:"([^"]+)"|(\S+))/i.exec(line)
    const f = m?.[1] ?? m?.[2]
    if (f) out.push(f)
  }
  return out
}

/** GDI: first line is the track count, then "<n> <lba> <type> <sector size> <file> <offset>" (file may be quoted). */
export function parseGdiText(text: string): string[] {
  const out: string[] = []
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (const line of lines.slice(1)) {
    const m = /^\d+\s+\d+\s+\d+\s+\d+\s+(?:"([^"]+)"|(\S+))/.exec(line)
    const f = m?.[1] ?? m?.[2]
    if (f) out.push(f)
  }
  return out
}

/** M3U playlist: one relative path per line, "#" comments. */
export function parseM3uText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

/** Absolute paths of the files referenced by an entry-point file (.cue/.toc/.gdi/.m3u/.ccd). */
export async function referencedFiles(entryPath: string): Promise<string[]> {
  const ext = extname(entryPath).toLowerCase()
  const dir = dirname(entryPath)
  if (ext === '.ccd') {
    // CloneCD: <name>.img + <name>.sub (+ .ccd) side by side.
    const stem = basename(entryPath, extname(entryPath))
    return ['.img', '.sub'].map((e) => join(dir, stem + e))
  }
  let text: string
  try {
    text = await readSmallText(entryPath)
  } catch {
    return []
  }
  let rel: string[]
  if (ext === '.cue' || ext === '.toc') rel = parseCueText(text)
  else if (ext === '.gdi') rel = parseGdiText(text)
  else if (ext === '.m3u') rel = parseM3uText(text)
  else rel = []
  return rel.map((r) => resolve(dir, r.replace(/[\\/]/g, '/')))
}

/** Minimal PARAM.SFO reader (PS3/PSP/Vita). Returns string/int fields such as TITLE and TITLE_ID. */
export function parseParamSfo(buf: Buffer): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  if (buf.length < 20 || buf.readUInt32BE(0) !== 0x00505346) return out // "\0PSF"
  const keyTable = buf.readUInt32LE(8)
  const dataTable = buf.readUInt32LE(12)
  const count = buf.readUInt32LE(16)
  for (let i = 0; i < count; i++) {
    const e = 20 + i * 16
    if (e + 16 > buf.length) break
    const keyOff = buf.readUInt16LE(e)
    const fmt = buf.readUInt16LE(e + 2)
    const len = buf.readUInt32LE(e + 4)
    const dataOff = buf.readUInt32LE(e + 12)
    const kStart = keyTable + keyOff
    const kEnd = buf.indexOf(0, kStart)
    if (kStart >= buf.length || kEnd < 0) break
    const key = buf.toString('utf8', kStart, kEnd)
    const dStart = dataTable + dataOff
    if (dStart + len > buf.length) continue
    if (fmt === 0x0404) out[key] = buf.readUInt32LE(dStart)
    else out[key] = buf.toString('utf8', dStart, dStart + len).replace(/\0+$/, '')
  }
  return out
}

export async function readParamSfoTitle(sfoPath: string): Promise<{ title?: string; titleId?: string }> {
  try {
    const buf = await readFile(sfoPath)
    const f = parseParamSfo(buf)
    const title = typeof f.TITLE === 'string' ? f.TITLE.replace(/\s+/g, ' ').trim() : undefined
    const titleId = typeof f.TITLE_ID === 'string' ? f.TITLE_ID : undefined
    return { title: title || undefined, titleId }
  } catch {
    return {}
  }
}

/** Wii U meta/meta.xml -> <longname_en>. */
export async function readWiiUTitle(metaXmlPath: string): Promise<string | undefined> {
  try {
    const xml = await readSmallText(metaXmlPath)
    const m = /<longname_en[^>]*>([\s\S]*?)<\/longname_en>/.exec(xml)
    const t = m?.[1]
      ?.replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
    return t || undefined
  } catch {
    return undefined
  }
}
