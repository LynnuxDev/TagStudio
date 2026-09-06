import { open, type FileHandle } from 'fs/promises'

export type TsKind = 'video' | 'text'

const TS_PACKET_SIZE = 188
const PROBE_PACKETS = 4

/**
 * Distinguish MPEG Transport Stream video from TypeScript source for `.ts`
 * files, which share an extension. Text that decodes as clean UTF-8 without
 * NUL bytes is source; anything binary is treated as video so binary blobs
 * are never dumped into the text preview.
 */
export async function sniffTsKind(fullPath: string): Promise<TsKind | null> {
  let fh: FileHandle | null = null
  try {
    fh = await open(fullPath, 'r')
    const buf = Buffer.alloc(TS_PACKET_SIZE * PROBE_PACKETS)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    if (bytesRead === 0) return 'text'

    const head = buf.subarray(0, bytesRead)

    if (!head.includes(0)) {
      const text = head.toString('utf-8')
      if (!text.includes('�')) {
        let controls = 0
        for (const ch of text) {
          const code = ch.codePointAt(0)!
          if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) controls++
        }
        if (controls / Math.max(text.length, 1) < 0.05) return 'text'
      }
    }

    // Binary content: MPEG-TS carries 0x47 sync bytes every 188 bytes.
    if (head[0] === 0x47) {
      let syncs = 0
      let checks = 0
      for (let off = TS_PACKET_SIZE; off < bytesRead; off += TS_PACKET_SIZE) {
        checks++
        if (head[off] === 0x47) syncs++
      }
      if (checks > 0 && syncs === checks) return 'video'
    }
    return 'video'
  } catch {
    return null
  } finally {
    await fh?.close().catch(() => {})
  }
}
