import { describe, it } from 'node:test'
import assert from 'node:assert'
import { isWithinRoot } from '../src/server/utils/path'

describe('isWithinRoot', () => {
  it('allows paths inside root', () => {
    assert.ok(isWithinRoot('/data', '/data/file.txt'))
    assert.ok(isWithinRoot('/data', '/data/subdir/file.txt'))
    assert.ok(isWithinRoot('/data', '/data'))
  })

  it('denies paths outside root', () => {
    assert.ok(!isWithinRoot('/data', '/etc/passwd'))
    assert.ok(!isWithinRoot('/data', '/data-other/file.txt'))
    assert.ok(!isWithinRoot('/data', '/data/../etc/passwd'))
    assert.ok(!isWithinRoot('/data', '../etc/passwd'))
  })

  it('handles trailing slashes', () => {
    assert.ok(isWithinRoot('/data/', '/data/file.txt'))
    assert.ok(!isWithinRoot('/data/', '/etc/passwd'))
  })
})
