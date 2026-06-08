import fs from 'fs/promises'
import { registerHandler, type FileExtraRow } from './registry'

async function gifHandler(filePath: string): Promise<FileExtraRow[]> {
  const fd = await fs.open(filePath, 'r')
  try {
    const stat = await fd.stat()
    const readSize = Math.min(stat.size, 20 * 1024 * 1024)
    const { buffer } = await fd.read({
      buffer: Buffer.alloc(readSize),
      position: 0,
    })
    const header = buffer.toString('ascii', 0, 6)
    if (header !== 'GIF87a' && header !== 'GIF89a') return []

    let offset = 13
    const packed = buffer[10]

    if (packed & 0x80) {
      const gctSize = 3 * (1 << ((packed & 0x07) + 1))
      offset += gctSize
    }

    let frameCount = 0
    while (offset < buffer.length) {
      const byte = buffer[offset]
      if (byte === 0x2c) {
        frameCount++
        offset += 10
        if (offset >= buffer.length) break
        const imgPacked = buffer[offset - 1]
        if (imgPacked & 0x80) {
          const lctSize = 3 * (1 << ((imgPacked & 0x07) + 1))
          offset += lctSize
          if (offset >= buffer.length) break
        }
        const minCodeSize = buffer[offset]
        if (minCodeSize === undefined) break
        offset++
        offset = skipSubBlocks(buffer, offset)
      } else if (byte === 0x21) {
        offset += 2
        offset = skipSubBlocks(buffer, offset)
      } else if (byte === 0x3b) break
      else offset++
    }

    return [{ label: 'Frame Count', value: String(frameCount) }]
  } finally {
    await fd.close()
  }
}

function skipSubBlocks(buffer: Buffer, start: number): number {
  let off = start
  while (off < buffer.length) {
    const size = buffer[off]
    if (size === 0) return off + 1
    off += size + 1
  }
  return off
}

registerHandler(['.gif'], gifHandler)
