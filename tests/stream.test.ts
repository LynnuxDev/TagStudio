import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { once } from 'events'
import { abortableFileStream } from '../src/server/utils/stream'

describe('abortableFileStream', () => {
  let dir: string
  let big: string
  const size = 5 * 1024 * 1024

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagger-stream-'))
    big = path.join(dir, 'big.bin')
    fs.writeFileSync(big, Buffer.alloc(size, 0xab))
  })

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('destroys the stream when the signal aborts', async () => {
    const ctrl = new AbortController()
    const stream = abortableFileStream(ctrl.signal, big)
    const closed = once(stream, 'close')
    ctrl.abort()
    await closed
    assert.ok(stream.destroyed)
  })

  it('destroys immediately if already aborted', () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const stream = abortableFileStream(ctrl.signal, big)
    assert.ok(stream.destroyed)
  })

  it('streams fully when not aborted', async () => {
    const ctrl = new AbortController()
    const stream = abortableFileStream(ctrl.signal, big)
    let bytes = 0
    for await (const chunk of stream) bytes += (chunk as Buffer).length
    assert.strictEqual(bytes, size)
  })
})
