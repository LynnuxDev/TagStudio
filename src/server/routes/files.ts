import { Hono } from 'hono'
import fs from 'fs/promises'
import { createReadStream, existsSync, mkdirSync } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { Readable } from 'stream'
import db from '../db'
import { isWithinRoot } from '../utils/path'

const execFileAsync = promisify(execFile)

const files = new Hono()

const isDemo = process.env.NODE_ENV === "demo"
const readonly = isDemo && process.env.ALLOW_EDITS_IN_DEMO !== "true"
const ROOT = isDemo
  ? path.resolve(process.cwd(), "demo")
  : (process.env.ROOT || '/mnt/other/DATA')

function checkAccess(target: string): boolean {
  return isWithinRoot(ROOT, target)
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
    const contents = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name)
        let stat
        try {
          stat = await fs.stat(fullPath)
        } catch {
          return null
        }

        const row = db.prepare('SELECT metadata FROM file_metadata WHERE path = ?').get(fullPath) as { metadata: string } | undefined
        let metadata: Record<string, unknown> = {}
        if (row) {
          try { metadata = JSON.parse(row.metadata) } catch { }
        }

        const ext = path.extname(entry.name).toLowerCase()

        return {
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
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
    const stat = await fs.stat(filePath)
    const row = db.prepare('SELECT metadata FROM file_metadata WHERE path = ?').get(filePath) as { metadata: string } | undefined
    let metadata: Record<string, unknown> = {}
    if (row) {
      try { metadata = JSON.parse(row.metadata) } catch { }
    }

    const ext = path.extname(filePath).toLowerCase()

    return c.json({
      name: path.basename(filePath),
      path: filePath,
      isDirectory: stat.isDirectory(),
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

  c.header('Content-Type', contentType)
  const fileStream = createReadStream(filePath)
  return c.body(Readable.toWeb(fileStream) as ReadableStream)
})

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

  const thumbDir = path.join(path.dirname(filePath), '.ts')
  const hash = crypto.createHash('md5').update(filePath).digest('hex')
  const thumbPath = path.join(thumbDir, `${hash}.webp`)

  if (!existsSync(thumbPath)) {
    try {
      await fs.stat(filePath)
    } catch {
      return c.json({ error: 'File not found' }, 404)
    }

    if (!existsSync(thumbDir)) {
      mkdirSync(thumbDir, { recursive: true })
    }

    try {
      const durationSec = 30
      const seek = Math.max(1, Math.floor(Math.random() * Math.min(durationSec, 10)))
      await execFileAsync('ffmpeg', [
        '-ss', String(seek),
        '-i', filePath,
        '-vframes', '1',
        '-vf', 'scale=320:-1',
        '-q:v', '50',
        '-y',
        thumbPath,
      ], { timeout: 30000 })
    } catch {
      return c.json({ error: 'Failed to generate thumbnail' }, 500)
    }
  }

  c.header('Content-Type', 'image/webp')

  const stream = createReadStream(thumbPath)
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

files.get('/read-text', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const filePathQuery = c.req.query('path')
  if (!filePathQuery) return c.json({ error: 'path required' }, 400)

  const filePath = path.resolve(filePathQuery)
  if (!checkAccess(filePath)) return c.json({ error: 'Access denied' }, 403)

  try {
    const stat = await fs.stat(filePath)
    if (stat.isDirectory()) {
      await fs.rm(filePath, { recursive: true, force: true })
    } else {
      await fs.unlink(filePath)
    }
    db.prepare('DELETE FROM file_metadata WHERE path = ?').run(filePath)
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to delete' }, 500)
  }
})

files.delete('/delete', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const filePathQuery = c.req.query('path')
  if (!filePathQuery) return c.json({ error: 'path required' }, 400)

  const filePath = path.resolve(filePathQuery)
  if (!checkAccess(filePath)) return c.json({ error: 'Access denied' }, 403)

  try {
    const stat = await fs.stat(filePath)
    if (stat.isDirectory()) {
      await fs.rm(filePath, { recursive: true, force: true })
    } else {
      await fs.unlink(filePath)
    }
    db.prepare('DELETE FROM file_metadata WHERE path = ?').run(filePath)
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
    return c.json({ error: 'Already exists' }, 409)
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
  const body = await c.req.json() as { parentPath?: string; name?: string }
  const parentPath = body.parentPath
  const name = body.name
  if (!parentPath || !name) return c.json({ error: 'parentPath and name required' }, 400)

  const resolved = path.resolve(parentPath, name)
  if (!checkAccess(resolved)) return c.json({ error: 'Access denied' }, 403)

  try {
    await fs.access(resolved)
    return c.json({ error: 'Already exists' }, 409)
  } catch { /* doesn't exist, good */ }

  try {
    await fs.writeFile(resolved, '', 'utf-8')
    return c.json({ path: resolved })
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create file' }, 500)
  }
})

files.post('/rename', async (c) => {
  if (readonly) return c.json({ error: "This action is not available in the demo" }, 403)
  const body = await c.req.json() as { path?: string; name?: string }
  const filePath = body.path
  const newName = body.name
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
  if (existsSync(newPath)) return c.json({ error: 'Destination already exists' }, 409)

  try {
    await fs.rename(resolved, newPath)
    const row = db.prepare('SELECT metadata FROM file_metadata WHERE path = ?').get(resolved) as { metadata: string } | undefined
    if (row) {
      db.prepare('DELETE FROM file_metadata WHERE path = ?').run(resolved)
      db.prepare('INSERT OR REPLACE INTO file_metadata (path, metadata) VALUES (?, ?)').run(newPath, row.metadata)
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

  try {
    await fs.rename(srcPath, dstPath)

    const row = db.prepare('SELECT metadata FROM file_metadata WHERE path = ?').get(srcPath) as { metadata: string } | undefined
    if (row) {
      db.prepare('DELETE FROM file_metadata WHERE path = ?').run(srcPath)
      db.prepare('INSERT OR REPLACE INTO file_metadata (path, metadata) VALUES (?, ?)').run(dstPath, row.metadata)
    }

    const srcThumbDir = path.join(path.dirname(srcPath), '.ts')
    const srcHash = crypto.createHash('md5').update(srcPath).digest('hex')
    const srcThumb = path.join(srcThumbDir, `${srcHash}.webp`)
    if (existsSync(srcThumb)) {
      const dstThumbDir = path.join(path.dirname(dstPath), '.ts')
      const dstHash = crypto.createHash('md5').update(dstPath).digest('hex')
      const dstThumb = path.join(dstThumbDir, `${dstHash}.webp`)
      if (!existsSync(dstThumbDir)) mkdirSync(dstThumbDir, { recursive: true })
      await fs.rename(srcThumb, dstThumb)
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

export default files
