import { Hono } from 'hono'
import path from 'path'
import db from '../db'
import { isWithinRoot } from '../utils/path'
import { canonicalPath, loadMetadata, storeMetadata } from '../utils/canonical'

const ROOT = process.env.NODE_ENV === "demo"
  ? path.resolve(process.cwd(), "demo")
  : (process.env.ROOT || '/mnt/other/DATA')
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

metadata.get('/', async (c) => {
  const filePath = c.req.query('path')
  if (!filePath) return c.json({ error: 'path required' }, 400)

  const canonical = await canonicalPath(path.resolve(filePath))
  const row = db.prepare('SELECT metadata, created_at, updated_at FROM file_metadata WHERE path = ?').get(canonical) as { metadata: string; created_at: string; updated_at: string } | undefined
  const fallback = canonical === filePath
    ? undefined
    : db.prepare('SELECT metadata, created_at, updated_at FROM file_metadata WHERE path = ?').get(filePath) as { metadata: string; created_at: string; updated_at: string } | undefined
  const found = row ?? fallback
  if (!found) {
    return c.json({ path: filePath, metadata: {} })
  }

  // Merge canonical + stale literal rows so link/real-path views stay in sync.
  const parsed = loadMetadata(canonical, filePath)

  return c.json({
    path: filePath,
    metadata: parsed,
    created_at: found.created_at,
    updated_at: found.updated_at,
  })
})

metadata.put('/', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const filePath = c.req.query('path')
  if (!filePath) return c.json({ error: 'path required' }, 400)

  const body = await c.req.json() as { metadata?: Record<string, unknown> }
  const next = body.metadata || {}
  const canonical = await canonicalPath(path.resolve(filePath))
  storeMetadata(canonical, filePath, next)

  return c.json({ path: filePath, metadata: next })
})

metadata.patch('/', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const filePath = c.req.query('path')
  if (!filePath) return c.json({ error: 'path required' }, 400)

  const body = await c.req.json() as { metadata?: Record<string, unknown> }

  const canonical = await canonicalPath(path.resolve(filePath))
  const existing = loadMetadata(canonical, filePath)

  const merged = { ...existing, ...(body.metadata || {}) }
  storeMetadata(canonical, filePath, merged)

  return c.json({ path: filePath, metadata: merged })
})

metadata.delete('/:key', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const filePath = c.req.query('path')
  const key = c.req.param('key')
  if (!filePath) return c.json({ error: 'path required' }, 400)

  const canonical = await canonicalPath(path.resolve(filePath))
  const existing = loadMetadata(canonical, filePath)
  if (!(key in existing)) {
    const hasAny = Object.keys(existing).length > 0
    if (!hasAny) return c.json({ error: 'not found' }, 404)
  }

  delete existing[key]
  storeMetadata(canonical, filePath, existing)

  return c.json({ path: filePath, metadata: existing })
})

metadata.post('/tags', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const filePath = c.req.query('path')
  if (!filePath) return c.json({ error: 'path required' }, 400)

  const body = await c.req.json() as { tags?: string[] }
  const newTags = (body.tags || []).map(t => t.toLowerCase())

  const canonical = await canonicalPath(path.resolve(filePath))
  const existing = loadMetadata(canonical, filePath)

  const currentTags = (existing.tags as string[]) || []
  existing.tags = [...new Set([...currentTags, ...newTags])]
  storeMetadata(canonical, filePath, existing)

  return c.json({ path: filePath, metadata: existing })
})

metadata.delete('/tags/:tag', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const filePath = c.req.query('path')
  const tag = c.req.param('tag').toLowerCase()
  if (!filePath) return c.json({ error: 'path required' }, 400)

  const canonical = await canonicalPath(path.resolve(filePath))
  const existing = loadMetadata(canonical, filePath)
  const currentTags = (existing.tags as string[]) || []
  if (!currentTags.includes(tag)) {
    return c.json({ error: 'not found' }, 404)
  }

  existing.tags = currentTags.filter((t: string) => t !== tag)
  storeMetadata(canonical, filePath, existing)

  return c.json({ path: filePath, metadata: existing })
})

export default metadata
