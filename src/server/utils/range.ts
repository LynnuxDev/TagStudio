export interface ByteRange {
  start: number
  end: number
}

/**
 * Parse a single `Range: bytes=start-end` header against a known total size.
 * Returns the satisfiable range, `'unsatisfiable'` (→ HTTP 416), or `null`
 * when no usable range was requested (→ HTTP 200).
 */
export function parseRangeHeader(
  header: string | null | undefined,
  total: number,
): ByteRange | 'unsatisfiable' | null {
  if (!header || total <= 0) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  if (m[1] === '' && m[2] === '') return null

  let start: number
  let end: number
  if (m[1] === '') {
    // Suffix range: last N bytes.
    const suffix = parseInt(m[2], 10)
    if (isNaN(suffix) || suffix === 0) return null
    start = Math.max(total - suffix, 0)
    end = total - 1
  } else {
    start = parseInt(m[1], 10)
    end = m[2] === '' ? total - 1 : parseInt(m[2], 10)
    if (isNaN(start) || isNaN(end)) return null
    // Clamp an over-long end; a start past EOF is unsatisfiable.
    if (start >= total) return 'unsatisfiable'
    if (end >= total) end = total - 1
    if (start > end) return 'unsatisfiable'
  }
  return { start, end }
}
