import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagger-test-'))
const dataDir = path.join(tmpDir, 'data')

process.env.DATA_DIR = dataDir
process.env.ROOT = tmpDir
process.env.BASE_URL = 'http://localhost:3000'
process.env.NODE_ENV = 'test'

import app from '../src/server/app'

describe('API', () => {
  before(() => {
    fs.mkdirSync(dataDir, { recursive: true })
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

  it('GET /api/files without auth returns 401', async () => {
    const res = await app.fetch(new Request('http://localhost/api/files'))
    const body = await res.json() as { error: string }
    assert.strictEqual(res.status, 401)
    assert.strictEqual(body.error, 'Unauthorized')
  })

  it('GET /api/metadata without auth returns 401', async () => {
    const res = await app.fetch(new Request('http://localhost/api/metadata'))
    assert.strictEqual(res.status, 401)
  })

  it('GET /api/search without auth returns 401', async () => {
    const res = await app.fetch(new Request('http://localhost/api/search'))
    assert.strictEqual(res.status, 401)
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
