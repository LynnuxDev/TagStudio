import { Hono } from 'hono'
import path from 'path'
import db from '../db'
import { isWithinRoot } from '../utils/path'

const ROOT = process.env.ROOT || '/mnt/other/DATA'
const readonly = process.env.NODE_ENV === "demo" && process.env.ALLOW_EDITS_IN_DEMO !== "true"

const metadata = new Hono()

metadata.use('*', async (c, next) => {
  const filePathQuery = c.req.query('path')
  if (filePathQuery) {
    const resolvedPath = path.resolve(filePathQuery)
    if (!isWithinRoot(ROOT, resolvedPath)) {
      return c.json({ error: 'Access denied' }, 403)
    }
  }
  await next()
})

metadata.get('/', (c) => {
  const filePath = c.req.query('path')
  if (!filePath) return c.json({ error: 'path required' }, 400)

  const row = db.prepare('SELECT metadata, created_at, updated_at FROM file_metadata WHERE path = ?').get(filePath) as { metadata: string; created_at: string; updated_at: string } | undefined
  if (!row) {
    return c.json({ path: filePath, metadata: {} })
  }

  let parsed: Record<string, unknown> = {}
  try { parsed = JSON.parse(row.metadata) } catch { }

  return c.json({
    path: filePath,
    metadata: parsed,
    created_at: row.created_at,
    updated_at: row.updated_at,
  })
})

metadata.put('/', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const filePath = c.req.query('path')
  if (!filePath) return c.json({ error: 'path required' }, 400)

  const body = await c.req.json() as { metadata?: Record<string, unknown> }
  const metadataStr = JSON.stringify(body.metadata || {})

  db.prepare(`
    INSERT INTO file_metadata (path, metadata, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(path) DO UPDATE SET
      metadata = excluded.metadata,
      updated_at = datetime('now')
  `).run(filePath, metadataStr)

  return c.json({ path: filePath, metadata: body.metadata || {} })
})

metadata.patch('/', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const filePath = c.req.query('path')
  if (!filePath) return c.json({ error: 'path required' }, 400)

  const body = await c.req.json() as { metadata?: Record<string, unknown> }

  const row = db.prepare('SELECT metadata FROM file_metadata WHERE path = ?').get(filePath) as { metadata: string } | undefined
  let existing: Record<string, unknown> = {}
  if (row) {
    try { existing = JSON.parse(row.metadata) } catch { }
  }

  const merged = { ...existing, ...(body.metadata || {}) }
  const metadataStr = JSON.stringify(merged)

  db.prepare(`
    INSERT INTO file_metadata (path, metadata, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(path) DO UPDATE SET
      metadata = excluded.metadata,
      updated_at = datetime('now')
  `).run(filePath, metadataStr)

  return c.json({ path: filePath, metadata: merged })
})

metadata.delete('/:key', (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const filePath = c.req.query('path')
  const key = c.req.param('key')
  if (!filePath) return c.json({ error: 'path required' }, 400)

  const row = db.prepare('SELECT metadata FROM file_metadata WHERE path = ?').get(filePath) as { metadata: string } | undefined
  if (!row) {
    return c.json({ error: 'not found' }, 404)
  }

  let existing: Record<string, unknown> = {}
  try { existing = JSON.parse(row.metadata) } catch { }

  delete existing[key]
  const metadataStr = JSON.stringify(existing)

  db.prepare(
    "UPDATE file_metadata SET metadata = ?, updated_at = datetime('now') WHERE path = ?"
  ).run(metadataStr, filePath)

  return c.json({ path: filePath, metadata: existing })
})

metadata.post('/tags', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const filePath = c.req.query('path')
  if (!filePath) return c.json({ error: 'path required' }, 400)

  const body = await c.req.json() as { tags?: string[] }
  const newTags = (body.tags || []).map(t => t.toLowerCase())

  const row = db.prepare('SELECT metadata FROM file_metadata WHERE path = ?').get(filePath) as { metadata: string } | undefined
  let existing: Record<string, unknown> = {}
  if (row) {
    try { existing = JSON.parse(row.metadata) } catch { }
  }

  const currentTags = (existing.tags as string[]) || []
  existing.tags = [...new Set([...currentTags, ...newTags])]
  const metadataStr = JSON.stringify(existing)

  db.prepare(`
    INSERT INTO file_metadata (path, metadata, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(path) DO UPDATE SET
      metadata = excluded.metadata,
      updated_at = datetime('now')
  `).run(filePath, metadataStr)

  return c.json({ path: filePath, metadata: existing })
})

metadata.delete('/tags/:tag', (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const filePath = c.req.query('path')
  const tag = c.req.param('tag').toLowerCase()
  if (!filePath) return c.json({ error: 'path required' }, 400)

  const row = db.prepare('SELECT metadata FROM file_metadata WHERE path = ?').get(filePath) as { metadata: string } | undefined
  if (!row) {
    return c.json({ error: 'not found' }, 404)
  }

  let existing: Record<string, unknown> = {}
  try { existing = JSON.parse(row.metadata) } catch { }

  const currentTags = (existing.tags as string[]) || []
  existing.tags = currentTags.filter((t: string) => t !== tag)
  const metadataStr = JSON.stringify(existing)

  db.prepare(
    "UPDATE file_metadata SET metadata = ?, updated_at = datetime('now') WHERE path = ?"
  ).run(metadataStr, filePath)

  return c.json({ path: filePath, metadata: existing })
})

export default metadata
