import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { sniffTsKind } from '../src/server/utils/media'

describe('sniffTsKind', () => {
  let dir: string

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagger-ts-'))
  })

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function write(name: string, data: Buffer | string): string {
    const p = path.join(dir, name)
    fs.writeFileSync(p, data)
    return p
  }

  it('detects MPEG-TS by sync bytes', async () => {
    const packet = Buffer.alloc(188, 0xff)
    packet[0] = 0x47
    packet[1] = 0x40
    const stream = Buffer.concat([packet, packet, packet, packet])
    assert.strictEqual(await sniffTsKind(write('clip.ts', stream)), 'video')
  })

  it('detects TypeScript source as text', async () => {
    const src = "import { foo } from './bar'\n\nexport function baz(x: number): string {\n  return String(x)\n}\n"
    assert.strictEqual(await sniffTsKind(write('app.ts', src)), 'text')
  })

  it('treats text starting with G as text, not video', async () => {
    const src = 'G'.repeat(300) + '\nconst x: number = 1\n'
    assert.strictEqual(await sniffTsKind(write('g.ts', src)), 'text')
  })

  it('treats empty file as text', async () => {
    assert.strictEqual(await sniffTsKind(write('empty.ts', '')), 'text')
  })

  it('treats non-sync binary as video (never dump binary as text)', async () => {
    const blob = Buffer.from([0x01, 0x02, 0x03, 0x00, 0xff, 0xfe, 0x89, 0x50])
    assert.strictEqual(await sniffTsKind(write('blob.ts', blob)), 'video')
  })

  it('returns null for missing files', async () => {
    assert.strictEqual(await sniffTsKind(path.join(dir, 'nope.ts')), null)
  })
})
