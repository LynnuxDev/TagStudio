export interface FileExtraRow {
  label: string
  value: string
}

export type FileExtraHandler = (
  filePath: string,
  stat: { size: number; mode: number; mtime: Date; birthtime: Date },
) => Promise<FileExtraRow[]>

const handlers = new Map<string, FileExtraHandler>()

export function registerHandler(extensions: string[], handler: FileExtraHandler) {
  for (const ext of extensions) {
    handlers.set(ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`, handler)
  }
}

export function getHandler(ext: string): FileExtraHandler | undefined {
  return handlers.get(ext.toLowerCase())
}
