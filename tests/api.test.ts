import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagger-test-'))
const dataDir = path.join(tmpDir, 'data')

// NOTE: these must be set before the dynamic imports in before(),
// otherwise src/server modules initialize against the dev database.
process.env.DATA_DIR = dataDir
process.env.ROOT = tmpDir
process.env.BASE_URL = 'http://localhost:3000'
process.env.NODE_ENV = 'test'

let app: any
let db: any

async function req(method: string, url: string, body?: unknown) {
  return app.fetch(new Request(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }))
}

function setGuest(on: boolean) {
  db.prepare(
    "INSERT INTO global_settings (key, value) VALUES ('guest_readonly', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(on ? 'true' : 'false')
}

describe('API', () => {
  before(async () => {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'hello')
    app = (await import('../src/server/app')).default
    db = (await import('../src/server/db/index')).default
  })

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('GET /api/health returns ok', async () => {
    const res = await app.fetch(new Request('http://localhost/api/health'))
    const body = await res.json() as { status: string }
    assert.strictEqual(res.status, 200)
    assert.strictEqual(body.status, 'ok')
  })

  it('guest off: GET /api/files without auth returns 401', async () => {
    setGuest(false)
    const res = await req('GET', '/api/files')
    const body = await res.json() as { error: string }
    assert.strictEqual(res.status, 401)
    assert.strictEqual(body.error, 'Unauthorized')
  })

  it('guest off: GET /api/metadata without auth returns 401', async () => {
    setGuest(false)
    const res = await req('GET', '/api/metadata')
    assert.strictEqual(res.status, 401)
  })

  it('guest off: GET /api/search without auth returns 401', async () => {
    setGuest(false)
    const res = await req('GET', '/api/search')
    assert.strictEqual(res.status, 401)
  })

  it('guest on: allowlisted GETs succeed without auth', async () => {
    setGuest(true)
    const root = encodeURIComponent(tmpDir)
    const file = encodeURIComponent(path.join(tmpDir, 'hello.txt'))
    for (const url of [
      `/api/files?path=${root}`,
      `/api/files/info?path=${file}`,
      `/api/files/raw?path=${file}`,
      `/api/metadata?path=${file}`,
      '/api/search?q=hello',
      '/api/search/tags',
    ]) {
      const res = await req('GET', url)
      assert.strictEqual(res.status, 200, `expected 200 for ${url}`)
    }
  })

  it('guest on: non-allowlisted GETs and all mutations return 401', async () => {
    setGuest(true)
    const file = encodeURIComponent(path.join(tmpDir, 'hello.txt'))
    for (const [method, url, body] of [
      ['GET', `/api/files/read-text?path=${file}`],
      ['GET', `/api/files/archive/list?path=${file}`],
      ['GET', `/api/files/file-info-extras?path=${file}`],
      ['GET', '/api/users/me'],
      ['GET', '/api/users/settings'],
      ['PUT', `/api/metadata?path=${file}`, { metadata: {} }],
      ['DELETE', `/api/files/delete?path=${file}`],
      ['POST', '/api/files/create-folder', { parentPath: tmpDir, name: 'x' }],
      ['PUT', '/api/users/global-settings', { settings: {} }],
    ] as [string, string, unknown?][]) {
      const res = await req(method, url, body)
      assert.strictEqual(res.status, 401, `expected 401 for ${method} ${url}`)
    }
  })

  it('GET /nonexistent returns 404 for API routes', async () => {
    const res = await app.fetch(new Request('http://localhost/api/nonexistent'))
    assert.strictEqual(res.status, 404)
    const body = await res.json() as { error: string }
    assert.strictEqual(body.error, 'Not found')
  })

  it('allows sign-up check via global-settings (no auth needed)', async () => {
    const res = await app.fetch(new Request('http://localhost/api/users/global-settings'))
    const body = await res.json() as { settings: Record<string, string> }
    assert.strictEqual(res.status, 200)
    assert.ok(typeof body.settings === 'object')
  })
})
