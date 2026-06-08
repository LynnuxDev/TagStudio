import { describe, it } from 'node:test'
import assert from 'node:assert'
import { isWithinRoot } from '../src/server/utils/path'

describe('isWithinRoot edge cases', () => {
  it('denies symlink traversal', () => {
    assert.ok(!isWithinRoot('/data', '/data/subdir/../../etc/passwd'))
    assert.ok(!isWithinRoot('/data', '/data/../../etc/passwd'))
  })

  it('allows exact root path', () => {
    assert.ok(isWithinRoot('/data', '/data'))
    assert.ok(isWithinRoot('/data', '/data/'))
  })

  it('denies paths with parent traversal after deep path', () => {
    assert.ok(!isWithinRoot('/data/subdir', '/data/subdir/../../etc/passwd'))
    assert.ok(!isWithinRoot('/data', '/data/subdir/../subdir2/../../etc/passwd'))
  })

  it('handles relative root paths', () => {
    assert.ok(!isWithinRoot('relative/path', '../outside'))
    assert.ok(isWithinRoot('relative/path', 'relative/path/file.txt'))
  })

  it('handles root/ prefix mismatch', () => {
    assert.ok(!isWithinRoot('/data', '/DATA/file.txt'))
    assert.ok(!isWithinRoot('/data', '/Data/file.txt'))
  })

  it('allows deep nesting', () => {
    assert.ok(isWithinRoot('/data', '/data/a/b/c/d/e/f/g/file.txt'))
  })
})
