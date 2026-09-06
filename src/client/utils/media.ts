// Single source of truth for extension-based media classification.
// `.ts` is ambiguous (MPEG-TS video vs TypeScript source): the server sniffs
// the content and reports `kind`, which always wins over the extension here.

export const IMAGE_EXTS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'tif', 'tiff', 'ico', 'bmp',
  'rpgmvp', 'png_',
]

export const VIDEO_EXTS = [
  'mp4', 'mov', 'webm', 'avi', 'mkv', 'wmv', 'flv', 'm4v',
]

export const AUDIO_EXTS = [
  'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma',
]

export const TEXT_EXTS = [
  'txt', 'md', 'json', 'xml', 'yaml', 'yml', 'csv', 'log', 'sh', 'js', 'ts',
  'py', 'rb', 'html', 'css', 'cfg', 'ini', 'conf', 'env', 'toml', 'lock',
  'sql', 'r', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'mermaid',
]

export interface EntryLike {
  name: string
  kind?: 'video' | 'text' | null
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function isVideoEntry(e: EntryLike): boolean {
  if (e.kind === 'video') return true
  if (e.kind === 'text') return false
  const ext = extOf(e.name)
  if (ext === 'ts') return false
  return VIDEO_EXTS.includes(ext)
}

export function isTextEntry(e: EntryLike): boolean {
  if (e.kind === 'text') return true
  if (e.kind === 'video') return false
  return TEXT_EXTS.includes(extOf(e.name))
}

export function isImageEntry(e: EntryLike): boolean {
  return IMAGE_EXTS.includes(extOf(e.name))
}

export function isAudioEntry(e: EntryLike): boolean {
  return AUDIO_EXTS.includes(extOf(e.name))
}
