import type { FileEntry } from './types'

export interface InfoRow {
  label: string
  value: string
}

export type FileInfoProvider = (file: FileEntry) => Promise<InfoRow[]>

const providers: { extensions: string[]; fn: FileInfoProvider }[] = []

export function registerProvider(extensions: string[], fn: FileInfoProvider) {
  providers.push({ extensions: extensions.map(e => e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`), fn })
}

export async function getExtraRows(file: FileEntry): Promise<InfoRow[]> {
  const matching = providers.filter(p =>
    file.extension && p.extensions.includes(file.extension),
  )
  const results = await Promise.all(matching.map(p => p.fn(file)))
  return results.flat()
}

async function fetchExtras(file: FileEntry): Promise<InfoRow[]> {
  const res = await fetch(`/api/files/file-info-extras?path=${encodeURIComponent(file.path)}`, {
    credentials: 'include',
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.rows || []
}

registerProvider(['.gif'], (file) => fetchExtras(file))
