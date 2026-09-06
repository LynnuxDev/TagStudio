import fs from 'fs/promises'
import db from '../db'

/**
 * Resolve a path through any symlinks to its canonical location.
 * Falls back to the input when the target doesn't exist (broken link).
 */
export async function canonicalPath(p: string): Promise<string> {
  try {
    return await fs.realpath(p)
  } catch {
    return p
  }
}

function getRow(p: string): { metadata: string } | undefined {
  return db.prepare('SELECT metadata FROM file_metadata WHERE path = ?').get(p) as { metadata: string } | undefined
}

function parseMetadata(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/**
 * Load the stored metadata for a path, following symlinks so that a file
 * tagged via its real path shows the same tags when accessed via a link
 * (and vice versa for rows stored before links were resolved).
 */
export function loadMetadata(canonical: string, literal: string): Record<string, unknown> {
  const canonRow = getRow(canonical)
  if (canonical === literal) return parseMetadata(canonRow?.metadata)
  const literalRow = getRow(literal)
  if (!canonRow) return parseMetadata(literalRow?.metadata)
  if (!literalRow) return parseMetadata(canonRow.metadata)
  // Both exist (e.g. tagged via each path before convergence) — merge,
  // preferring the canonical row's scalar values and unioning tags.
  const a = parseMetadata(canonRow.metadata)
  const b = parseMetadata(literalRow.metadata)
  const merged: Record<string, unknown> = { ...b, ...a }
  const tagsA = Array.isArray(a.tags) ? (a.tags as unknown[]).map(String) : []
  const tagsB = Array.isArray(b.tags) ? (b.tags as unknown[]).map(String) : []
  if (tagsA.length > 0 || tagsB.length > 0) {
    merged.tags = [...new Set([...tagsB, ...tagsA])]
  }
  return merged
}

/**
 * Persist metadata under the canonical path and drop a stale literal row
 * so future reads converge on a single identity.
 */
export function storeMetadata(canonical: string, literal: string, metadata: Record<string, unknown>): void {
  const metadataStr = JSON.stringify(metadata)
  db.prepare(`
    INSERT INTO file_metadata (path, metadata, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(path) DO UPDATE SET
      metadata = excluded.metadata,
      updated_at = datetime('now')
  `).run(canonical, metadataStr)
  if (literal !== canonical) {
    db.prepare('DELETE FROM file_metadata WHERE path = ?').run(literal)
  }
}
