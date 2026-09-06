import { Hono } from 'hono'
import db from '../db'
import fs from 'fs/promises'
import path from 'path'
import { canonicalPath, loadMetadata } from '../utils/canonical'
import { sniffTsKind } from '../utils/media'

const search = new Hono()

const ROOT = process.env.NODE_ENV === "demo"
  ? path.resolve(process.cwd(), "demo")
  : (process.env.ROOT || '/mnt/other/DATA')

async function walkFs(query: string, exts: string[] | null, limit = 100): Promise<string[]> {
  const matches: string[] = []
  const queue = [ROOT]
  const visited = new Set<string>()
  const lower = query.toLowerCase()
  let totalVisited = 0
  const start = Date.now()

  try {
    visited.add(await fs.realpath(ROOT).catch(() => ROOT))
  } catch { visited.add(ROOT) }

  async function isDir(fullPath: string): Promise<boolean> {
    try {
      const st = await fs.stat(fullPath)
      return st.isDirectory()
    } catch {
      return false
    }
  }

  while (queue.length > 0 && matches.length < limit && totalVisited < 5000) {
    if (Date.now() - start > 5000) break
    const dir = queue.shift()!
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (matches.length >= limit || totalVisited >= 5000) break
        if (Date.now() - start > 5000) break
        if (entry.name.startsWith('.')) continue
        totalVisited++
        const fullPath = path.join(dir, entry.name)
        if (await isDir(fullPath)) {
          try {
            const real = await fs.realpath(fullPath)
            if (visited.has(real)) continue
            visited.add(real)
          } catch { continue }
          queue.push(fullPath)
          continue
        }
        if (entry.name.toLowerCase().includes(lower)) {
          if (exts) {
            const ext = path.extname(entry.name).toLowerCase()
            if (!exts.includes(ext)) continue
          }
          matches.push(fullPath)
        }
      }
    } catch {
    }
  }

  return matches
}

search.get('/', async (c) => {
  const q = c.req.query('q') || ''
  const key = c.req.query('key')
  const value = c.req.query('value')
  const extensions = c.req.query('extensions')
  const tags = c.req.query('tags')

  const conditions: string[] = ['path LIKE ?']
  const params: unknown[] = [`${ROOT}%`]

  if (key && value !== undefined) {
    conditions.push('metadata LIKE ?')
    params.push(`%"${key}":${JSON.stringify(value)}%`)
  }

  if (q) {
    conditions.push('(path LIKE ? OR metadata LIKE ?)')
    params.push(`%${q}%`, `%${q}%`)
  }

  if (extensions) {
    const exts = extensions.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    if (exts.length > 0) {
      const extConditions = exts.map(() => 'path LIKE ?')
      conditions.push(`(${extConditions.join(' OR ')})`)
      for (const ext of exts) {
        params.push(`%${ext}`)
      }
    }
  }

  if (tags) {
    const tagList = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    for (const tag of tagList) {
      conditions.push('metadata LIKE ?')
      params.push(`%"tags"%${tag}%`)
    }
  }

  let sql = 'SELECT path, metadata, updated_at FROM file_metadata'
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ')
  }
  sql += ' ORDER BY updated_at DESC LIMIT 100'

  const rows = db.prepare(sql).all(...params) as { path: string; metadata: string; updated_at: string }[]

  const metaResults: { path: string; metadata: Record<string, unknown>; updated_at: string; kind?: 'video' | 'text' | null }[] = rows.map(row => ({
    path: row.path,
    metadata: JSON.parse(row.metadata),
    updated_at: row.updated_at,
  }))

  const seen = new Set(metaResults.map(r => r.path))

  const shouldWalk = !!(q || extensions)
  if (shouldWalk) {
    let exts: string[] | null = null
    if (extensions) {
      exts = extensions.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
      if (exts.length === 0) exts = null
    }
    const fsPaths = await walkFs(q || '', exts, 100)
    for (const fp of fsPaths) {
      // Dedupe by canonical path: the same file can be reached via a link
      // path and its real path when linked dirs are traversed.
      const real = await canonicalPath(fp)
      if (seen.has(fp) || seen.has(real)) continue
      seen.add(fp)
      seen.add(real)
      const metadata = loadMetadata(real, fp)
      const kind = path.extname(fp).toLowerCase() === '.ts'
        ? await sniffTsKind(real)
        : null
      metaResults.push({ path: fp, metadata, updated_at: '', kind })
    }
  }

  return c.json({ results: metaResults, count: metaResults.length })
})

search.get('/tags', (c) => {
  const rows = db.prepare('SELECT metadata FROM file_metadata').all() as { metadata: string }[]
  const allTags = new Set<string>()

  for (const row of rows) {
    try {
      const meta = JSON.parse(row.metadata)
      if (Array.isArray(meta.tags)) {
        for (const t of meta.tags) {
          allTags.add(String(t).toLowerCase())
        }
      }
    } catch { }
  }

  return c.json({ tags: [...allTags].sort() })
})

export default search
