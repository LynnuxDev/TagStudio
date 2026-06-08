import { Hono } from 'hono'
import fs from 'fs/promises'
import path from 'path'
import { getHandler } from '../fileInfoExtras/registry'
import '../fileInfoExtras/handlers'

const fileInfoExtra = new Hono()

fileInfoExtra.get('/file-info-extras', async (c) => {
  const filePath = c.req.query('path')
  if (!filePath) return c.json({ error: 'path is required' }, 400)

  const ext = path.extname(filePath).toLowerCase()
  const handler = getHandler(ext)
  if (!handler) return c.json({ rows: [] })

  try {
    const stat = await fs.stat(filePath)
    const rows = await handler(filePath, {
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
