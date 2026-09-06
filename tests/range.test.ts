import { describe, it } from 'node:test'
import assert from 'node:assert'
import { parseRangeHeader } from '../src/server/utils/range'

describe('parseRangeHeader', () => {
  const total = 1000

  it('parses start-end', () => {
    assert.deepStrictEqual(parseRangeHeader('bytes=0-99', total), { start: 0, end: 99 })
  })

  it('parses open-ended', () => {
    assert.deepStrictEqual(parseRangeHeader('bytes=700-', total), { start: 700, end: 999 })
  })

  it('parses suffix ranges', () => {
    assert.deepStrictEqual(parseRangeHeader('bytes=-200', total), { start: 800, end: 999 })
  })

  it('clamps over-long ends', () => {
    assert.deepStrictEqual(parseRangeHeader('bytes=0-99999', total), { start: 0, end: 999 })
  })

  it('flags starts past EOF as unsatisfiable', () => {
    assert.strictEqual(parseRangeHeader('bytes=1000-', total), 'unsatisfiable')
    assert.strictEqual(parseRangeHeader('bytes=1500-1600', total), 'unsatisfiable')
    assert.strictEqual(parseRangeHeader('bytes=500-100', total), 'unsatisfiable')
  })

  it('ignores missing or malformed headers', () => {
    assert.strictEqual(parseRangeHeader(undefined, total), null)
    assert.strictEqual(parseRangeHeader('bytes=-', total), null)
    assert.strictEqual(parseRangeHeader('items=0-99', total), null)
    assert.strictEqual(parseRangeHeader('bytes=0-99,200-299', total), null)
  })
})
