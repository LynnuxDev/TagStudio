import { Hono } from 'hono'
import db from '../db'

const readonly = process.env.NODE_ENV === "demo" && process.env.ALLOW_EDITS_IN_DEMO !== "true"

const users = new Hono<{
  Variables: {
    user: { id: string; email: string; name?: string } | null
    session: { id: string } | null
  }
}>()

users.get('/me', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  return c.json({ user })
})

users.get('/settings', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const row = db.prepare('SELECT settings FROM user_settings WHERE user_id = ?').get(user.id) as { settings: string } | undefined
  const settings = row ? JSON.parse(row.settings) : {}
  return c.json({ settings })
})

users.put('/settings', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const user = c.get('user')
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const body = await c.req.json()
  const newSettings = body.settings || {}

  const existing = db.prepare('SELECT settings FROM user_settings WHERE user_id = ?').get(user.id) as { settings: string } | undefined
  const merged = { ...(existing ? JSON.parse(existing.settings) : {}), ...newSettings }

  db.prepare(`
    INSERT INTO user_settings (user_id, settings, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET settings = ?, updated_at = datetime('now')
  `).run(user.id, JSON.stringify(merged), JSON.stringify(merged))

  return c.json({ settings: merged })
})

users.get('/global-settings', (c) => {
  const rows = db.prepare('SELECT key, value FROM global_settings').all() as { key: string; value: string }[]
  const settings: Record<string, string> = {}
  for (const row of rows) settings[row.key] = row.value
  return c.json({ settings })
})

users.put('/global-settings', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const user = c.get('user')
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const body = await c.req.json()
  const newSettings = body.settings || {}

  const upsert = db.prepare(
    'INSERT INTO global_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const txn = db.transaction(() => {
    for (const [key, value] of Object.entries(newSettings)) {
      upsert.run(key, String(value))
    }
  })
  txn()

  const rows = db.prepare('SELECT key, value FROM global_settings').all() as { key: string; value: string }[]
  const settings: Record<string, string> = {}
  for (const row of rows) settings[row.key] = row.value
  return c.json({ settings })
})

export default users
