import path from 'path'

export function isWithinRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}
