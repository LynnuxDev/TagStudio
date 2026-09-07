import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagger-rename-test-'))
const dataDir = path.join(tmpDir, 'data')

// NOTE: these must be set before the dynamic imports in before(),
// otherwise src/server modules initialize against the dev database.
process.env.DATA_DIR = dataDir
process.env.ROOT = tmpDir
process.env.BASE_URL = 'http://localhost:3000'
process.env.NODE_ENV = 'test'

let app: any
let cookie = ''

function authedHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Origin: 'http://localhost:3000',
    ...(cookie ? { cookie } : {}),
  }
}

async function req(method: string, url: string, body?: unknown) {
  return app.fetch(new Request(`http://localhost:3000${url}`, {
    method,
    headers: authedHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  }))
}

describe('rename with overwrite', () => {
  before(async () => {
    fs.mkdirSync(dataDir, { recursive: true })
    const { authReady } = await import('../src/server/auth')
    await authReady
    app = (await import('../src/server/app')).default

    // Sign up + sign in through the real auth stack, capture the session.
    for (const endpoint of ['sign-up', 'sign-in']) {
      const res = await app.fetch(new Request(`http://localhost:3000/api/auth/${endpoint}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ email: 'rename@test.local', password: 'password123', name: 'Rename' }),
      }))
      assert.ok(res.status === 200 || res.status === 201, `expected 2xx for ${endpoint}, got ${res.status}`)
      const setCookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
      const jar = setCookies.map((c) => c.split(';')[0]).join('; ')
      if (jar) cookie = jar
    }
    assert.ok(cookie.length > 0, 'expected a session cookie')
  })

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rename onto an existing name returns 409 without overwrite', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'AAA')
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'BBB')
    const res = await req('POST', '/api/files/rename', { path: path.join(tmpDir, 'a.txt'), name: 'b.txt' })
    assert.strictEqual(res.status, 409)
    const body = await res.json() as { error: string }
    assert.match(body.error, /already exists/i)
    // Neither file touched.
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8'), 'AAA')
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'b.txt'), 'utf8'), 'BBB')
  })

  it('overwrite:true replaces the file', async () => {
    const res = await req('POST', '/api/files/rename', {
      path: path.join(tmpDir, 'a.txt'),
      name: 'b.txt',
      overwrite: true,
    })
    assert.strictEqual(res.status, 200)
    const body = await res.json() as { path: string }
    assert.strictEqual(body.path, path.join(tmpDir, 'b.txt'))
    assert.ok(!fs.existsSync(path.join(tmpDir, 'a.txt')))
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'b.txt'), 'utf8'), 'AAA')
  })

  it('refuses to replace a folder, even with overwrite', async () => {
    fs.mkdirSync(path.join(tmpDir, 'subdir'))
    fs.writeFileSync(path.join(tmpDir, 'c.txt'), 'CCC')
    for (const overwrite of [false, true]) {
      const res = await req('POST', '/api/files/rename', {
        path: path.join(tmpDir, 'c.txt'),
        name: 'subdir',
        overwrite,
      })
      assert.strictEqual(res.status, 409, `expected 409 (overwrite=${overwrite})`)
    }
    assert.ok(fs.existsSync(path.join(tmpDir, 'c.txt')))
    assert.ok(fs.statSync(path.join(tmpDir, 'subdir')).isDirectory())
  })

  it('refuses to replace with a folder', async () => {
    fs.writeFileSync(path.join(tmpDir, 'victim.txt'), 'VVV')
    const res = await req('POST', '/api/files/rename', {
      path: path.join(tmpDir, 'subdir'),
      name: 'victim.txt',
      overwrite: true,
    })
    assert.strictEqual(res.status, 409)
    assert.ok(fs.statSync(path.join(tmpDir, 'subdir')).isDirectory())
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'victim.txt'), 'utf8'), 'VVV')
  })

  it('replaced file keeps source tags and loses its own', async () => {    const src = path.join(tmpDir, 'src.txt')
    const dst = path.join(tmpDir, 'dst.txt')
    fs.writeFileSync(src, 'SRC')
    fs.writeFileSync(dst, 'DST')
    const tag = async (p: string, tags: string[]) => {
      const r = await req('POST', `/api/metadata/tags?path=${encodeURIComponent(p)}`, { tags })
      assert.strictEqual(r.status, 200)
    }
    await tag(src, ['srctag'])
    await tag(dst, ['dsttag'])

    const res = await req('POST', '/api/files/rename', { path: src, name: 'dst.txt', overwrite: true })
    assert.strictEqual(res.status, 200)

    const meta = await req('GET', `/api/metadata?path=${encodeURIComponent(dst)}`)
    assert.strictEqual(meta.status, 200)
    const metaBody = await meta.json() as { metadata: { tags?: string[] } }
    assert.deepStrictEqual(metaBody.metadata.tags, ['srctag'])
  })

  it('create-file onto an existing name returns 409 without overwrite', async () => {
    fs.writeFileSync(path.join(tmpDir, 'n.txt'), 'NNN')
    const res = await req('POST', '/api/files/create-file', { parentPath: tmpDir, name: 'n.txt' })
    assert.strictEqual(res.status, 409)
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'n.txt'), 'utf8'), 'NNN')
  })

  it('create-file with overwrite:true truncates and drops old tags', async () => {
    const p = path.join(tmpDir, 'n.txt')
    const tagRes = await req('POST', `/api/metadata/tags?path=${encodeURIComponent(p)}`, { tags: ['oldtag'] })
    assert.strictEqual(tagRes.status, 200)

    const res = await req('POST', '/api/files/create-file', { parentPath: tmpDir, name: 'n.txt', overwrite: true })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(fs.readFileSync(p, 'utf8'), '')

    const meta = await req('GET', `/api/metadata?path=${encodeURIComponent(p)}`)
    assert.strictEqual(meta.status, 200)
    const metaBody = await meta.json() as { metadata: Record<string, unknown> }
    assert.deepStrictEqual(metaBody.metadata, {})
  })

  it('create-file refuses to replace a folder, even with overwrite', async () => {
    for (const overwrite of [false, true]) {
      const res = await req('POST', '/api/files/create-file', { parentPath: tmpDir, name: 'subdir', overwrite })
      assert.strictEqual(res.status, 409, `expected 409 (overwrite=${overwrite})`)
    }
    assert.ok(fs.statSync(path.join(tmpDir, 'subdir')).isDirectory())
  })

  it('create-folder onto an existing name returns 409', async () => {
    const res = await req('POST', '/api/files/create-folder', { parentPath: tmpDir, name: 'subdir' })
    assert.strictEqual(res.status, 409)
  })
})
