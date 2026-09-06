import { Hono } from 'hono'
import fs from 'fs/promises'
import path from 'path'
import { getHandler } from '../fileInfoExtras/registry'
import '../fileInfoExtras/handlers'
import { isWithinRoot } from '../utils/path'

const ROOT = process.env.NODE_ENV === "demo"
  ? path.resolve(process.cwd(), "demo")
  : (process.env.ROOT || '/mnt/other/DATA')

const fileInfoExtra = new Hono()

fileInfoExtra.get('/file-info-extras', async (c) => {
  const filePath = c.req.query('path')
  if (!filePath) return c.json({ error: 'path is required' }, 400)

  const resolved = path.resolve(filePath)
  if (!isWithinRoot(ROOT, resolved)) return c.json({ error: 'Access denied' }, 403)

  const ext = path.extname(filePath).toLowerCase()
  const handler = getHandler(ext)
  if (!handler) return c.json({ rows: [] })

  try {
    const stat = await fs.stat(resolved)
    const rows = await handler(resolved, {
      size: stat.size,
      mode: stat.mode,
      mtime: stat.mtime,
      birthtime: stat.birthtime,
    })
    return c.json({ rows })
  } catch {
    return c.json({ rows: [] })
  }
})

export default fileInfoExtra
