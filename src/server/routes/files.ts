import { Hono, type Context } from 'hono'
import fs from 'fs/promises'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { Readable } from 'stream'
import db from '../db'
import { isWithinRoot } from '../utils/path'
import { canonicalPath, loadMetadata, storeMetadata } from '../utils/canonical'
import { sniffTsKind } from '../utils/media'
import { parseRangeHeader } from '../utils/range'
import { abortableFileStream } from '../utils/stream'

const execFileAsync = promisify(execFile)

const files = new Hono()

/** Thumbnail location for a file — keyed by canonical path so a file reached
 *  via a symlink shares one thumbnail with its real-path counterpart. */
export const CACHE_DIR_NAME = '.ts'

/** True when the path lives inside a thumbnail/remux cache dir. Thumbnails
 *  must never be generated for cache files themselves, or every `.ts`
 *  listing spawns a nested `.ts/.ts/.ts…` chain. */
export function isCachePath(p: string): boolean {
  return p.split(path.sep).includes(CACHE_DIR_NAME)
}

function thumbPathForCanonical(canonical: string): { thumbDir: string; thumbPath: string } {
  const thumbDir = path.join(path.dirname(canonical), CACHE_DIR_NAME)
  const hash = crypto.createHash('md5').update(canonical).digest('hex')
  return { thumbDir, thumbPath: path.join(thumbDir, `${hash}.webp`) }
}

async function thumbPathFor(filePath: string): Promise<{ thumbDir: string; thumbPath: string }> {
  return thumbPathForCanonical(await canonicalPath(filePath))
}

/** Cached MP4 remux next to the thumbnail — browsers can't play MPEG-TS. */
function remuxPathForCanonical(canonical: string): string {
  return thumbPathForCanonical(canonical).thumbPath.replace(/\.webp$/, '.remux.mp4')
}

const remuxJobs = new Map<string, Promise<string | null>>()

/**
 * Remux an MPEG-TS file to faststart MP4 (stream copy, no re-encode) so
 * browsers can play it. The result is cached in the `.ts` dir and invalidated
 * when the source is newer. Returns the cache path, or null on failure.
 */
async function remuxTsToMp4(filePath: string): Promise<string | null> {
  const canonical = await canonicalPath(filePath)
  // Never remux cache byproducts (e.g. a .remux.mp4 living in .ts).
  if (isCachePath(canonical)) return null
  const outPath = remuxPathForCanonical(canonical)

  let srcStat
  try {
    srcStat = await fs.stat(canonical)
    if (srcStat.isDirectory()) return null
  } catch {
    return null
  }
  try {
    const outStat = await fs.stat(outPath)
    if (outStat.size > 0 && outStat.mtimeMs >= srcStat.mtimeMs) return outPath
  } catch { /* (re)generate below */ }

  const pending = remuxJobs.get(outPath)
  if (pending) return pending

  const job = (async (): Promise<string | null> => {
    const tmpOut = outPath.replace(/\.mp4$/, `.tmp-${process.pid}.mp4`)
    try {
      const { thumbDir } = thumbPathForCanonical(canonical)
      if (!existsSync(thumbDir)) mkdirSync(thumbDir, { recursive: true })
      await execFileAsync('ffmpeg', [
        '-y', '-v', 'error',
        '-i', canonical,
        '-c', 'copy',
        '-movflags', '+faststart',
        tmpOut,
      ], { timeout: 10 * 60 * 1000 })
      await fs.rename(tmpOut, outPath)
      return outPath
    } catch {
      await fs.unlink(tmpOut).catch(() => {})
      return null
    } finally {
      remuxJobs.delete(outPath)
    }
  })()
  remuxJobs.set(outPath, job)
  return job
}

/**
 * Serve a file from disk with HTTP range (seek) support.
 */
async function serveFile(c: Context, targetPath: string, contentType: string, rangeHeader: string | undefined) {
  const st = await fs.stat(targetPath).catch(() => null)
  if (!st || st.isDirectory()) return c.json({ error: 'File not found' }, 404)
  const total = st.size

  const range = parseRangeHeader(rangeHeader, total)
  if (range === 'unsatisfiable') {
    c.status(416)
    c.header('Content-Range', `bytes */${total}`)
    return c.body(null)
  }

  c.header('Content-Type', contentType)
  c.header('Accept-Ranges', 'bytes')
  if (range) {
    c.status(206)
    c.header('Content-Range', `bytes ${range.start}-${range.end}/${total}`)
    c.header('Content-Length', String(range.end - range.start + 1))
    const fileStream = abortableFileStream(c.req.raw.signal, targetPath, { start: range.start, end: range.end })
    return c.body(Readable.toWeb(fileStream) as ReadableStream)
  }

  if (total > 0) c.header('Content-Length', String(total))
  const fileStream = abortableFileStream(c.req.raw.signal, targetPath)
  return c.body(Readable.toWeb(fileStream) as ReadableStream)
}

const isDemo = process.env.NODE_ENV === "demo"
const readonly = isDemo && process.env.ALLOW_EDITS_IN_DEMO !== "true"
const ROOT = isDemo
  ? path.resolve(process.cwd(), "demo")
  : (process.env.ROOT || '/mnt/other/DATA')

function checkAccess(target: string): boolean {
  return target.startsWith(ROOT) && !path.relative(ROOT, target).startsWith('..')
}

const RPGMVP_HEADER_SIZE = 16
const RPGMV_MAGIC = 'RPGMV'

function findRpgKey(filePath: string): string | null {
  let dir = path.dirname(filePath)
  while (dir.startsWith(ROOT)) {
    const sysPath = path.join(dir, 'data', 'System.json')
    if (existsSync(sysPath)) {
      try {
        const raw = JSON.parse(readFileSync(sysPath, 'utf-8'))
        const arr = Array.isArray(raw) ? raw[0] : raw
        const key = arr.encryptionKey
        if (typeof key === 'string' && /^[0-9a-fA-F]{32}$/.test(key)) return key
      } catch {}
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

async function decryptRpgmvp(filePath: string): Promise<Buffer | null> {
  const data = await fs.readFile(filePath)
  if (data.length <= RPGMVP_HEADER_SIZE) return null

  const header = data.subarray(0, RPGMVP_HEADER_SIZE)
  const payload = data.subarray(RPGMVP_HEADER_SIZE)

  // Only attempt decryption if the header starts with "RPGMV"
  const isRpgmv = header[0] === 0x52 && header[1] === 0x50 && header[2] === 0x47 &&
                  header[3] === 0x4D && header[4] === 0x56
  if (!isRpgmv) {
    // not an RPGMaker file — just strip header as best effort
    return payload
  }

  const key = findRpgKey(filePath)
  if (!key) return payload

  const keyBytes = Buffer.from(key, 'hex')

  // header-only XOR: first 16 bytes of payload are XOR'd, rest is untouched
  const out = Buffer.from(payload)
  for (let i = 0; i < 16 && i < out.length; i++) {
    out[i] ^= keyBytes[i % keyBytes.length]
  }

  // verify result looks like a valid image (PNG magic bytes at offset 0 of payload)
  if (out.length > 4 && out[0] === 0x89 && out[1] === 0x50 && out[2] === 0x4E && out[3] === 0x47) {
    return out
  }

  // header-only XOR didn't produce valid PNG — try full XOR
  const full = Buffer.from(payload)
  for (let i = 0; i < full.length; i++) {
    full[i] ^= keyBytes[i % keyBytes.length]
  }
  if (full.length > 4 && full[0] === 0x89 && full[1] === 0x50 && full[2] === 0x4E && full[3] === 0x47) {
    return full
  }

  // neither worked — return header-only result anyway
  return out
}

files.get('/root-status', async (c) => {
  try {
    await fs.access(ROOT, fs.constants.R_OK)
    return c.json({ valid: true, path: ROOT })
  } catch {
    return c.json({ valid: false, path: ROOT, error: `Root directory does not exist or is not accessible: ${ROOT}` })
  }
})

files.get('/', async (c) => {
  const queryPath = c.req.query('path')
  const dirPath = queryPath ? path.resolve(queryPath) : ROOT

  if (!checkAccess(dirPath)) {
    return c.json({ error: 'Access denied' }, 403)
  }

  const showHidden = c.req.query('showHidden') === 'true'

  try {
    let entries = await fs.readdir(dirPath, { withFileTypes: true })
    if (!showHidden) {
      entries = entries.filter(e => !e.name.startsWith('.'))
    }
    // Cache dirs are an implementation detail — never browseable, even with
    // showHidden. Otherwise requesting thumbnails inside .ts spawns .ts/.ts.
    entries = entries.filter(e => !(e.name === CACHE_DIR_NAME && e.isDirectory()))
    // Canonical dir so metadata lookups follow symlinks: files reached via
    // a linked dir share tags with their real-path counterparts.
    const canonicalDir = await canonicalPath(dirPath)
    const contents = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name)
        let lst
        try {
          lst = await fs.lstat(fullPath)
        } catch {
          return null
        }
        const isSymlink = lst.isSymbolicLink()
        let symlinkTarget: string | null = null
        if (isSymlink) {
          try {
            symlinkTarget = await fs.readlink(fullPath)
          } catch {
            symlinkTarget = null
          }
        }

        const metaKey = isSymlink
          ? await canonicalPath(fullPath)
          : (canonicalDir === dirPath ? fullPath : path.join(canonicalDir, entry.name))
        const metadata = loadMetadata(metaKey, fullPath)

        let stat
        try {
          stat = await fs.stat(fullPath)
        } catch {
          // Most likely a broken symlink — still list it instead of hiding it.
          if (isSymlink) {
            const ext = path.extname(entry.name).toLowerCase()
            return {
              name: entry.name,
              path: fullPath,
              isDirectory: false,
              isSymlink: true,
              symlinkTarget,
              isBrokenLink: true,
              size: 0,
              modified: lst.mtime.toISOString(),
              created: lst.birthtime.toISOString(),
              extension: ext,
              mode: lst.mode,
              metadata,
            }
          }
          return null
        }

        const ext = path.extname(entry.name).toLowerCase()

        // `.ts` is ambiguous (MPEG-TS video vs TypeScript source) — sniff it.
        const kind = ext === '.ts' && !stat.isDirectory()
          ? await sniffTsKind(fullPath)
          : null

        return {
          name: entry.name,
          path: fullPath,
          isDirectory: stat.isDirectory(),
          isSymlink,
          symlinkTarget,
          kind,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          created: stat.birthtime.toISOString(),
          extension: ext,
          mode: stat.mode,
          metadata,
        }
      })
    )

    return c.json({
      path: dirPath,
      parent: dirPath !== ROOT ? path.dirname(dirPath) : null,
      contents: contents.filter(Boolean),
      root: ROOT,
      ...(isDemo ? { displayRoot: "/home/demo" } : {}),
    })
  } catch (err: any) {
    if (err.code === 'ENOENT') return c.json({ error: 'Directory not found' }, 404)
    if (err.code === 'EACCES' || err.code === 'EPERM') return c.json({ error: 'Permission denied' }, 403)
    return c.json({ error: err.message || 'Unknown error' }, 500)
  }
})

files.get('/info', async (c) => {
  const filePathQuery = c.req.query('path')
  if (!filePathQuery) return c.json({ error: 'path required' }, 400)

  const filePath = path.resolve(filePathQuery)
  if (!checkAccess(filePath)) {
    return c.json({ error: 'Access denied' }, 403)
  }

  try {
    const lst = await fs.lstat(filePath).catch(() => null)
    if (!lst) return c.json({ error: 'File not found' }, 404)
    const isSymlink = lst.isSymbolicLink()
    let symlinkTarget: string | null = null
    if (isSymlink) {
      try {
        symlinkTarget = await fs.readlink(filePath)
      } catch {
        symlinkTarget = null
      }
    }
    let stat
    try {
      stat = await fs.stat(filePath)
    } catch {
      if (isSymlink) {
        return c.json({
          name: path.basename(filePath),
          path: filePath,
          isDirectory: false,
          isSymlink: true,
          symlinkTarget,
          isBrokenLink: true,
          size: 0,
          modified: lst.mtime.toISOString(),
          created: lst.birthtime.toISOString(),
          extension: path.extname(filePath).toLowerCase(),
          mode: lst.mode,
          metadata: {},
        })
      }
      throw { code: 'ENOENT' }
    }
    const ext = path.extname(filePath).toLowerCase()
    const metadata = loadMetadata(await canonicalPath(filePath), filePath)
    const kind = ext === '.ts' && !stat.isDirectory()
      ? await sniffTsKind(filePath)
      : null

    return c.json({
      name: path.basename(filePath),
      path: filePath,
      isDirectory: stat.isDirectory(),
      isSymlink,
      symlinkTarget,
      kind,
      size: stat.size,
      modified: stat.mtime.toISOString(),
      created: stat.birthtime.toISOString(),
      extension: ext,
      mode: stat.mode,
      metadata,
    })
  } catch (err: any) {
    if (err.code === 'ENOENT') return c.json({ error: 'File not found' }, 404)
    if (err.code === 'EACCES' || err.code === 'EPERM') return c.json({ error: 'Permission denied' }, 403)
    return c.json({ error: err.message || 'Unknown error' }, 500)
  }
})

files.get('/raw', async (c) => {
  const filePathQuery = c.req.query('path')
  if (!filePathQuery) return c.json({ error: 'path required' }, 400)

  const filePath = path.resolve(filePathQuery)
  if (!checkAccess(filePath)) {
    return c.json({ error: 'Access denied' }, 403)
  }

  try {
    await fs.access(filePath, fs.constants.R_OK)
    const dirCheck = await fs.stat(filePath).catch(() => null)
    if (dirCheck?.isDirectory()) return c.json({ error: 'Path is a directory' }, 400)
  } catch (err: any) {
    if (err.code === 'ENOENT') return c.json({ error: 'File not found' }, 404)
    if (err.code === 'EACCES' || err.code === 'EPERM') return c.json({ error: 'Permission denied' }, 403)
    return c.json({ error: err.message || 'Unknown error' }, 500)
  }

  const ext = path.extname(filePath).toLowerCase()
  let contentType = 'application/octet-stream'
  if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg'
  else if (ext === '.png') contentType = 'image/png'
  else if (ext === '.gif') contentType = 'image/gif'
  else if (ext === '.webp') contentType = 'image/webp'
  else if (ext === '.svg') contentType = 'image/svg+xml'
  else if (ext === '.tiff' || ext === '.tif') contentType = 'image/tiff'
  else if (ext === '.ico') contentType = 'image/x-icon'
  else if (ext === '.mp3') contentType = 'audio/mpeg'
  else if (ext === '.wav') contentType = 'audio/wav'
  else if (ext === '.flac') contentType = 'audio/flac'
  else if (ext === '.ogg') contentType = 'audio/ogg'
  else if (ext === '.m4a') contentType = 'audio/mp4'
  else if (ext === '.aac') contentType = 'audio/aac'
  else if (ext === '.opus') contentType = 'audio/opus'
  else if (ext === '.wma') contentType = 'audio/x-ms-wma'
  else if (ext === '.m4v') contentType = 'video/x-m4v'

  if (ext === '.ts') {
    const sniffed = await sniffTsKind(filePath)
    if (sniffed === 'text') {
      contentType = 'text/plain; charset=utf-8'
    } else {
      // Browsers can't play MPEG-TS — serve a cached MP4 remux instead.
      const remux = await remuxTsToMp4(filePath)
      if (remux) return serveFile(c, remux, 'video/mp4', c.req.header('range'))
      contentType = 'video/mp2t'
    }
  }

  if (ext === '.rpgmvp' || ext === '.png_' || ext === '.rpgmvm' || ext === '.rpgmvo') {
    const decrypted = await decryptRpgmvp(filePath)
    if (decrypted) {
      const mime = ext === '.rpgmvm' || ext === '.rpgmvo' ? 'audio/ogg' : 'image/png'
      return serveBytes(c, Buffer.from(decrypted), mime, c.req.header('range'))
    }
  }

  return serveFile(c, filePath, contentType, c.req.header('range'))
})

/**
 * Serve a byte payload (full or ranged) with seek support. Used for content
 * held in memory rather than streamed from disk.
 */
function serveBytes(
  c: Context,
  data: Buffer,
  contentType: string,
  rangeHeader: string | undefined,
) {
  const total = data.length
  const range = parseRangeHeader(rangeHeader, total)
  if (range === 'unsatisfiable') {
    c.status(416)
    c.header('Content-Range', `bytes */${total}`)
    return c.body(null)
  }
  c.header('Content-Type', contentType)
  c.header('Accept-Ranges', 'bytes')
  if (range) {
    c.status(206)
    c.header('Content-Range', `bytes ${range.start}-${range.end}/${total}`)
    c.header('Content-Length', String(range.end - range.start + 1))
    return c.body(new Uint8Array(data.subarray(range.start, range.end + 1)))
  }
  if (total > 0) c.header('Content-Length', String(total))
  return c.body(new Uint8Array(data))
}

files.get('/read-text', async (c) => {
  const filePathQuery = c.req.query('path')
  if (!filePathQuery) return c.json({ error: 'path required' }, 400)

  const filePath = path.resolve(filePathQuery)
  if (!checkAccess(filePath)) return c.json({ error: 'Access denied' }, 403)

  try {
    const stat = await fs.stat(filePath)
    const MAX_SIZE = 100 * 1024
    if (stat.size > MAX_SIZE) {
      return c.json({ error: 'File too large', size: stat.size, maxSize: MAX_SIZE })
    }
    const content = await fs.readFile(filePath, 'utf-8')
    return c.json({ content })
  } catch {
    return c.json({ error: 'Failed to read file' }, 500)
  }
})

files.put('/write-text', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const body = await c.req.json() as { path?: string; content?: string }
  const filePathQuery = body.path
  const content = body.content
  if (!filePathQuery || content === undefined) return c.json({ error: 'path and content required' }, 400)

  const filePath = path.resolve(filePathQuery)
  if (!checkAccess(filePath)) return c.json({ error: 'Access denied' }, 403)

  try {
    const stat = await fs.stat(filePath)
    const MAX_SIZE = 100 * 1024
    if (stat.size > MAX_SIZE) {
      return c.json({ error: 'File too large to write', size: stat.size, maxSize: MAX_SIZE }, 413)
    }
    await fs.writeFile(filePath, content, 'utf-8')
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to write file' }, 500)
  }
})

files.get('/thumbnail', async (c) => {
  const filePathQuery = c.req.query('path')
  if (!filePathQuery) return c.json({ error: 'path required' }, 400)

  const filePath = path.resolve(filePathQuery)
  if (!checkAccess(filePath)) return c.json({ error: 'Access denied' }, 403)

  const canonicalForGuard = await canonicalPath(filePath)
  // Refuse to thumbnail cache files themselves — the frontend falls back to
  // /raw for images and to an icon for videos, so this safely breaks the
  // .ts/.ts/.ts recursion instead of nesting another cache level.
  if (isCachePath(canonicalForGuard)) {
    return c.json({ error: 'Path is a thumbnail cache file' }, 400)
  }

  const { thumbDir, thumbPath } = await thumbPathFor(filePath)

  // Migrate/clean up pre-canonical twins: thumbs previously hashed the literal
  // path, so one file could own two .ts images (link path + real path).
  const legacyThumbPath = thumbPathForCanonical(filePath).thumbPath
  if (legacyThumbPath !== thumbPath) {
    if (!existsSync(thumbPath) && existsSync(legacyThumbPath)) {
      try {
        if (!existsSync(thumbDir)) mkdirSync(thumbDir, { recursive: true })
        await fs.rename(legacyThumbPath, thumbPath)
      } catch { /* fall through to generation */ }
    } else if (existsSync(thumbPath) && existsSync(legacyThumbPath)) {
      await fs.unlink(legacyThumbPath).catch(() => {})
    }
  }

  // A previous failed run may leave a 0-byte file behind — treat it as
  // missing so generation is retried instead of serving an empty body.
  let cached: { size: number } | null = null
  try {
    cached = { size: (await fs.stat(thumbPath)).size }
  } catch {
    cached = null
  }
  if (cached && cached.size === 0) {
    await fs.unlink(thumbPath).catch(() => {})
    cached = null
  }

  if (!cached) {
    let stat
    try {
      stat = await fs.stat(filePath)
    } catch {
      return c.json({ error: 'File not found' }, 404)
    }
    if (stat.isDirectory()) return c.json({ error: 'Path is a directory' }, 400)

    if (!existsSync(thumbDir)) {
      try {
        mkdirSync(thumbDir, { recursive: true })
      } catch (err: any) {
        console.error(`[thumbnail] cannot create cache dir ${thumbDir} for ${filePath}: ${err?.message || err}`)
        return c.json({ error: 'Failed to generate thumbnail' }, 500)
      }
    }

    // Raster images get a scaled-down cached copy so grids don't load full
    // multi-MB originals (SVG/RPGMaker assets are served as-is instead).
    // NOTE: `-c:v libwebp` forces the still-image encoder. Without it ffmpeg
    // picks libwebp_anim for .webp output, which fails on some files (e.g.
    // 10-bit HDR phone footage) with WebPAnimEncoderAssemble errors.
    const ext = path.extname(filePath).toLowerCase()
    const isRasterImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff'].includes(ext)
    const args = isRasterImage
      ? ['-i', filePath, '-vframes', '1', '-vf', 'scale=320:-1', '-c:v', 'libwebp', '-q:v', '50', '-y', thumbPath]
      : (() => {
        const durationSec = 30
        const seek = Math.max(1, Math.floor(Math.random() * Math.min(durationSec, 10)))
        return [
          '-ss', String(seek),
          '-i', filePath,
          '-vframes', '1',
          '-vf', 'scale=320:-1',
          '-c:v', 'libwebp',
          '-q:v', '50',
          '-y',
          thumbPath,
        ]
      })()
    try {
      await execFileAsync('ffmpeg', args, { timeout: 30000 })
      const out = await fs.stat(thumbPath).catch(() => null)
      if (!out || out.size === 0) {
        await fs.unlink(thumbPath).catch(() => {})
        throw new Error('ffmpeg produced an empty thumbnail file')
      }
    } catch (err: any) {
      // ffmpeg's useful error is at the END of stderr (banner comes first),
      // so keep the tail, not the head.
      const tail = (v: unknown, n = 1000): string => {
        const s = typeof v === 'string' ? v : v ? String(v) : ''
        return s.length > n ? `…${s.slice(-n)}` : s
      }
      const detail = tail(err?.stderr) || tail(err?.message) || 'unknown error'
      console.error(`[thumbnail] ffmpeg failed for ${filePath}: ${detail}`)
      return c.json({ error: 'Failed to generate thumbnail' }, 500)
    }
  }

  c.header('Content-Type', 'image/webp')

  const stream = abortableFileStream(c.req.raw.signal, thumbPath)
  return c.body(Readable.toWeb(stream) as ReadableStream)
})

async function listZipFiles(filePath: string): Promise<string[]> {
  const buffer = await fs.readFile(filePath)
  const filesList: string[] = []

  // 1. Search for EOCD signature (0x06054b50) from the end of the file
  let eocdOffset = -1
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Not a valid ZIP file (EOCD signature not found)')
  }

  // 2. Read Central Directory info from EOCD
  const totalRecords = buffer.readUInt16LE(eocdOffset + 10)
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16)

  // 3. Parse Central Directory headers
  let offset = cdOffset
  for (let r = 0; r < totalRecords; r++) {
    if (offset + 46 > buffer.length) break
    const signature = buffer.readUInt32LE(offset)
    if (signature !== 0x02014b50) {
      break
    }

    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraFieldLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)

    if (offset + 46 + fileNameLength > buffer.length) break
    const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength)
    if (fileName) {
      filesList.push(fileName)
    }

    offset += 46 + fileNameLength + extraFieldLength + commentLength
  }

  return filesList
}

files.get('/archive/list', async (c) => {
  const filePathQuery = c.req.query('path')
  if (!filePathQuery) return c.json({ error: 'path required' }, 400)

  const filePath = path.resolve(filePathQuery)
  if (!checkAccess(filePath)) {
    return c.json({ error: 'Access denied' }, 403)
  }

  try {
    await fs.access(filePath, fs.constants.R_OK)
  } catch (err: any) {
    if (err.code === 'ENOENT') return c.json({ error: 'File not found' }, 404)
    if (err.code === 'EACCES' || err.code === 'EPERM') return c.json({ error: 'Permission denied' }, 403)
    return c.json({ error: 'File not found' }, 404)
  }

  try {
    const fileList = await listZipFiles(filePath)
    return c.json({ files: fileList })
  } catch (err: any) {
    if (err.code === 'ENOENT') return c.json({ error: 'File not found' }, 404)
    if (err.code === 'EACCES' || err.code === 'EPERM') return c.json({ error: 'Permission denied' }, 403)
    return c.json({ error: err.message || 'Unknown error' }, 500)
  }
})

files.delete('/delete', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const filePathQuery = c.req.query('path')
  if (!filePathQuery) return c.json({ error: 'path required' }, 400)

  const filePath = path.resolve(filePathQuery)
  if (!checkAccess(filePath)) return c.json({ error: 'Access denied' }, 403)

  try {
    const lst = await fs.lstat(filePath)
    const isLink = lst.isSymbolicLink()
    // Snapshot the canonical identity first: remux/thumb caches are keyed by
    // it, and realpath stops working once the file is gone.
    const canon = isLink ? null : await canonicalPath(filePath)
    if (isLink || lst.isFile()) {
      // Unlink the link itself — never follow it into the target.
      await fs.unlink(filePath)
    } else if (lst.isDirectory()) {
      await fs.rm(filePath, { recursive: true, force: true })
    } else {
      await fs.unlink(filePath)
    }
    db.prepare('DELETE FROM file_metadata WHERE path = ?').run(filePath)
    if (canon) {
      // Drop derived caches so a deleted file leaves no multi-GB orphans.
      // (A deleted link keeps the target's caches — the target still exists.)
      await fs.unlink(thumbPathForCanonical(canon).thumbPath).catch(() => {})
      await fs.unlink(remuxPathForCanonical(canon)).catch(() => {})
    }
    return c.json({ success: true })
  } catch (err: any) {
    if (err.code === 'ENOENT') return c.json({ error: 'File not found' }, 404)
    return c.json({ error: err.message || 'Failed to delete' }, 500)
  }
})

files.post('/create-folder', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const body = await c.req.json() as { parentPath?: string; name?: string }
  const parentPath = body.parentPath
  const name = body.name
  if (!parentPath || !name) return c.json({ error: 'parentPath and name required' }, 400)

  const resolved = path.resolve(parentPath, name)
  if (!checkAccess(resolved)) return c.json({ error: 'Access denied' }, 403)

  try {
    await fs.access(resolved)
    return c.json({ error: 'Already exists', conflict: name }, 409)
  } catch { /* doesn't exist, good */ }

  try {
    await fs.mkdir(resolved, { recursive: false })
    return c.json({ path: resolved })
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create folder' }, 500)
  }
})

files.post('/create-file', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const body = await c.req.json() as { parentPath?: string; name?: string; overwrite?: boolean }
  const parentPath = body.parentPath
  const name = body.name
  const overwrite = body.overwrite === true
  if (!parentPath || !name) return c.json({ error: 'parentPath and name required' }, 400)

  const resolved = path.resolve(parentPath, name)
  if (!checkAccess(resolved)) return c.json({ error: 'Access denied' }, 403)

  try {
    await fs.access(resolved)
    if (!overwrite) return c.json({ error: 'Already exists', conflict: name }, 409)
    // Explicit replace with an empty file: files only, never folders.
    // Cached metadata/thumbs are keyed by path and must go first.
    const dstStat = await fs.lstat(resolved).catch(() => null)
    if (!dstStat || dstStat.isDirectory()) return c.json({ error: 'Cannot replace a folder' }, 409)
    try {
      const canonDst = await canonicalPath(resolved)
      for (const k of new Set([canonDst, resolved])) {
        db.prepare('DELETE FROM file_metadata WHERE path = ?').run(k)
      }
      const { thumbPath: dstThumb } = thumbPathForCanonical(canonDst)
      await fs.rm(dstThumb, { force: true }).catch(() => {})
      await fs.rm(remuxPathForCanonical(canonDst), { force: true }).catch(() => {})
      await fs.rm(resolved, { force: true })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to replace file' }, 500)
    }
  } catch (err: any) {
    // fs.access threw = doesn't exist, good. Anything else is a real error.
    if (err?.code !== 'ENOENT') return c.json({ error: err.message || 'Failed to create file' }, 500)
  }

  try {
    await fs.writeFile(resolved, '', 'utf-8')
    return c.json({ path: resolved })
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create file' }, 500)
  }
})

files.post('/rename', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const body = await c.req.json() as { path?: string; name?: string; overwrite?: boolean }
  const filePath = body.path
  const newName = body.name
  const overwrite = body.overwrite === true
  if (!filePath || !newName) return c.json({ error: 'path and name required' }, 400)
  if (newName.includes('/') || newName.includes('\\')) return c.json({ error: 'Invalid name' }, 400)

  const resolved = path.resolve(filePath)
  if (!checkAccess(resolved)) return c.json({ error: 'Access denied' }, 403)

  try {
    await fs.access(resolved, fs.constants.W_OK)
  } catch (err: any) {
    if (err.code === 'ENOENT') return c.json({ error: 'File not found' }, 404)
    if (err.code === 'EACCES' || err.code === 'EPERM') return c.json({ error: 'Permission denied' }, 403)
    return c.json({ error: 'File not found' }, 404)
  }

  const newPath = path.join(path.dirname(resolved), newName)
  if (existsSync(newPath)) {
    if (!overwrite) return c.json({ error: 'Destination already exists', conflict: newName }, 409)
    // Explicit replace: files only, never directories. Metadata, thumbnails
    // and remux caches are keyed by path, so the replaced file's rows must
    // go — otherwise its tags/thumbnail would haunt the new file.
    const [srcStat, dstStat] = await Promise.all([
      fs.lstat(resolved).catch(() => null),
      fs.lstat(newPath).catch(() => null),
    ])
    const sameFile = !!srcStat && !!dstStat &&
      (srcStat as any).ino === (dstStat as any).ino && (srcStat as any).dev === (dstStat as any).dev
    if (!sameFile) {
      if (!dstStat || dstStat.isDirectory()) return c.json({ error: 'Cannot replace a folder' }, 409)
      if (!srcStat || srcStat.isDirectory()) return c.json({ error: 'Cannot replace with a folder' }, 409)
      try {
        const canonDst = await canonicalPath(newPath)
        for (const k of new Set([canonDst, newPath])) {
          db.prepare('DELETE FROM file_metadata WHERE path = ?').run(k)
        }
        const { thumbPath: dstThumb } = thumbPathForCanonical(canonDst)
        await fs.rm(dstThumb, { force: true }).catch(() => {})
        await fs.rm(remuxPathForCanonical(canonDst), { force: true }).catch(() => {})
        await fs.rm(newPath, { force: true })
      } catch (err: any) {
        return c.json({ error: err.message || 'Failed to replace file' }, 500)
      }
    }
  }

  // Snapshot link/canonical identity before renaming: tags live under the
  // canonical path so they survive access via symlinked dirs.
  const srcLst = await fs.lstat(resolved).catch(() => null)
  const srcIsLink = !!srcLst?.isSymbolicLink()
  const canonSrc = srcIsLink ? resolved : await canonicalPath(resolved)
  const canonDstDir = await canonicalPath(path.dirname(newPath))

  try {
    await fs.rename(resolved, newPath)
    if (!srcIsLink) {
      // Renaming a link itself leaves the target's tags untouched.
      const meta = loadMetadata(canonSrc, resolved)
      if (Object.keys(meta).length > 0) {
        const dstKey = path.join(canonDstDir, newName)
        storeMetadata(dstKey, newPath, meta)
        for (const k of new Set([canonSrc, resolved])) {
          if (k !== dstKey && k !== newPath) db.prepare('DELETE FROM file_metadata WHERE path = ?').run(k)
        }
      }
    }
    return c.json({ path: newPath })
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to rename' }, 500)
  }
})

files.post('/move', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const body = await c.req.json() as { source?: string; destination?: string }
  const { source, destination } = body
  if (!source || !destination) return c.json({ error: 'source and destination required' }, 400)

  const srcPath = path.resolve(source)
  const dstPath = path.resolve(destination)
  if (!checkAccess(srcPath) || !checkAccess(dstPath)) return c.json({ error: 'Access denied' }, 403)

  try {
    await fs.access(srcPath)
  } catch (err: any) {
    if (err.code === 'ENOENT') return c.json({ error: 'Source not found' }, 404)
    if (err.code === 'EACCES' || err.code === 'EPERM') return c.json({ error: 'Permission denied' }, 403)
    return c.json({ error: 'Source not found' }, 404)
  }

  if (existsSync(dstPath)) return c.json({ error: 'Destination already exists' }, 409)

  const dstDir = path.dirname(dstPath)
  try {
    await fs.access(dstDir, fs.constants.W_OK)
  } catch (err: any) {
    if (err.code === 'ENOENT') return c.json({ error: 'Destination directory does not exist' }, 404)
    if (err.code === 'EACCES' || err.code === 'EPERM') return c.json({ error: 'Permission denied' }, 403)
    return c.json({ error: 'Destination directory does not exist' }, 404)
  }

  // Snapshot identity before moving (source must still exist for realpath).
  const moveSrcLst = await fs.lstat(srcPath).catch(() => null)
  const moveSrcIsLink = !!moveSrcLst?.isSymbolicLink()
  const canonSrc = moveSrcIsLink ? srcPath : await canonicalPath(srcPath)
  const canonDstKey = path.join(await canonicalPath(dstDir), path.basename(dstPath))

  try {
    await fs.rename(srcPath, dstPath)

    // Moving a link itself leaves the target's tags untouched.
    if (!moveSrcIsLink) {
      const meta = loadMetadata(canonSrc, srcPath)
      if (Object.keys(meta).length > 0) {
        storeMetadata(canonDstKey, dstPath, meta)
        for (const k of new Set([canonSrc, srcPath])) {
          if (k !== canonDstKey && k !== dstPath) db.prepare('DELETE FROM file_metadata WHERE path = ?').run(k)
        }
      }
    }

    const { thumbPath: srcThumb } = thumbPathForCanonical(canonSrc)
    if (!moveSrcIsLink && existsSync(srcThumb)) {
      // Moving a link itself must not steal the target's thumbnail.
      const { thumbPath: dstThumb, thumbDir: dstThumbDir } = thumbPathForCanonical(canonDstKey)
      if (!existsSync(dstThumbDir)) mkdirSync(dstThumbDir, { recursive: true })
      await fs.rename(srcThumb, dstThumb)
    }
    if (!moveSrcIsLink) {
      const srcRemux = remuxPathForCanonical(canonSrc)
      if (existsSync(srcRemux)) {
        const dstRemux = remuxPathForCanonical(canonDstKey)
        const dstRemuxDir = path.dirname(dstRemux)
        if (!existsSync(dstRemuxDir)) mkdirSync(dstRemuxDir, { recursive: true })
        await fs.rename(srcRemux, dstRemux)
      }
    }

    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to move' }, 500)
  }
})

files.post('/open-with/mpv', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const body = await c.req.json() as { path?: string }
  const filePathQuery = body.path
  if (!filePathQuery) return c.json({ error: 'path required' }, 400)

  const filePath = path.resolve(filePathQuery)
  if (!checkAccess(filePath)) return c.json({ error: 'Access denied' }, 403)

  try {
    await fs.access(filePath, fs.constants.R_OK)
  } catch (err: any) {
    if (err.code === 'ENOENT') return c.json({ error: 'File not found' }, 404)
    if (err.code === 'EACCES' || err.code === 'EPERM') return c.json({ error: 'Permission denied' }, 403)
    return c.json({ error: 'File not found' }, 404)
  }

  spawn('mpv', [filePath], {
    detached: true,
    stdio: 'ignore',
  }).unref()

  return c.json({ success: true })
})

files.post('/open-with/yacreader', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const body = await c.req.json() as { path?: string }
  const filePathQuery = body.path
  if (!filePathQuery) return c.json({ error: 'path required' }, 400)

  const filePath = path.resolve(filePathQuery)
  if (!checkAccess(filePath)) return c.json({ error: 'Access denied' }, 403)

  try {
    await fs.access(filePath, fs.constants.R_OK)
  } catch (err: any) {
    if (err.code === 'ENOENT') return c.json({ error: 'File not found' }, 404)
    if (err.code === 'EACCES' || err.code === 'EPERM') return c.json({ error: 'Permission denied' }, 403)
    return c.json({ error: 'File not found' }, 404)
  }

  spawn('YACReader', [filePath], { detached: true, stdio: 'ignore' }).unref()

  return c.json({ success: true })
})

files.post('/extract', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const body = await c.req.json() as { path?: string }
  const filePathQuery = body.path
  if (!filePathQuery) return c.json({ error: 'path required' }, 400)

  const filePath = path.resolve(filePathQuery)
  if (!checkAccess(filePath)) return c.json({ error: 'Access denied' }, 403)

  try {
    await fs.access(filePath, fs.constants.R_OK)
  } catch (err: any) {
    if (err.code === 'ENOENT') return c.json({ error: 'File not found' }, 404)
    if (err.code === 'EACCES' || err.code === 'EPERM') return c.json({ error: 'Permission denied' }, 403)
    return c.json({ error: 'File not found' }, 404)
  }

  const outDir = path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath)))

  try {
    await fs.mkdir(outDir, { recursive: true })
  } catch {
    return c.json({ error: 'Failed to create output directory' }, 500)
  }

  try {
    await execFileAsync('7z', ['x', filePath, `-o${outDir}`, '-y'], { timeout: 120000 })
    return c.json({ success: true, output: outDir })
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to extract archive' }, 500)
  }
})

files.post('/decrypt-rpgmaker', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const body = await c.req.json() as { path?: string }
  const filePathQuery = body.path
  if (!filePathQuery) return c.json({ error: 'path required' }, 400)

  const filePath = path.resolve(filePathQuery)
  if (!checkAccess(filePath)) return c.json({ error: 'Access denied' }, 403)

  try {
    await fs.access(filePath, fs.constants.R_OK)
  } catch (err: any) {
    if (err.code === 'ENOENT') return c.json({ error: 'File not found' }, 404)
    if (err.code === 'EACCES' || err.code === 'EPERM') return c.json({ error: 'Permission denied' }, 403)
    return c.json({ error: 'File not found' }, 404)
  }

  const decrypted = await decryptRpgmvp(filePath)
  if (!decrypted) return c.json({ error: 'Failed to decrypt' }, 500)

  const ext = path.extname(filePath).toLowerCase()
  const isImage = ext === '.rpgmvp' || ext === '.png_'
  const outName = path.basename(filePath, path.extname(filePath)) + (isImage ? '.png' : '.ogg')
  const outPath = path.join(path.dirname(filePath), outName)

  if (existsSync(outPath)) return c.json({ error: 'Output already exists' }, 409)

  try {
    await fs.writeFile(outPath, decrypted)
    return c.json({ success: true, output: outPath })
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to write decrypted file' }, 500)
  }
})

export default files
