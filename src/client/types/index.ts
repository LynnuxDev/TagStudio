export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modified: string
  created: string
  extension?: string
  mode?: number
  metadata: Record<string, unknown>
}

export interface DirListing {
  path: string
  parent: string | null
  contents: FileEntry[]
  root: string
}

export interface MetadataResponse {
  path: string
  metadata: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export interface SearchResult {
  path: string
  metadata: Record<string, unknown>
  updated_at: string
}

export interface User {
  id: string
  email: string
  name?: string
}
