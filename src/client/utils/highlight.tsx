import React from 'react'
import { extOf } from './media'

// Lightweight zero-dependency syntax highlighter for the text preview.
// Returns React nodes so content stays XSS-safe (no innerHTML).

const JS_KEYWORDS = [
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'default', 'break', 'continue', 'new', 'delete',
  'class', 'extends', 'import', 'export', 'from', 'async', 'await', 'try',
  'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'yield',
  'this', 'super', 'static', 'get', 'set', 'enum', 'interface', 'type',
  'implements', 'public', 'private', 'protected', 'readonly', 'void',
  'null', 'undefined', 'true', 'false', 'nan', 'infinity',
  'number', 'string', 'boolean', 'any', 'never', 'unknown', 'object',
]

const PY_KEYWORDS = [
  'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not',
  'and', 'or', 'is', 'none', 'true', 'false', 'class', 'import', 'from',
  'as', 'with', 'lambda', 'yield', 'try', 'except', 'finally', 'raise',
  'pass', 'global', 'nonlocal', 'assert', 'del', 'async', 'await',
  'self', 'cls',
]

const SH_KEYWORDS = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do',
  'done', 'case', 'esac', 'in', 'function', 'select', 'time', 'coproc',
  'echo', 'exit', 'export', 'local', 'return', 'source', 'alias',
  'true', 'false', 'null',
]

const SQL_KEYWORDS = [
  'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set',
  'delete', 'create', 'table', 'alter', 'drop', 'join', 'left', 'right',
  'inner', 'outer', 'on', 'as', 'and', 'or', 'not', 'null', 'primary',
  'key', 'foreign', 'references', 'index', 'view', 'distinct', 'order',
  'by', 'group', 'having', 'limit', 'offset', 'union', 'all', 'exists',
  'in', 'like', 'between', 'is', 'case', 'when', 'then', 'else', 'end',
]

const CSS_KEYWORDS = [
  'import', 'media', 'font-face', 'keyframes', 'supports', 'charset',
  'namespace', 'page', 'important',
]

interface LangConfig {
  label: string
  hashComments: boolean
  slashComments: boolean
  keywords: string[]
  caseInsensitiveKeywords?: boolean
}

function configForExt(ext: string): LangConfig | null {
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return { label: 'javascript', hashComments: false, slashComments: true, keywords: JS_KEYWORDS }
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return { label: 'typescript', hashComments: false, slashComments: true, keywords: JS_KEYWORDS }
    case 'json':
      return { label: 'json', hashComments: false, slashComments: true, keywords: ['true', 'false', 'null'] }
    case 'py':
    case 'pyw':
    case 'rb':
    case 'r':
      return { label: ext === 'py' || ext === 'pyw' ? 'python' : ext, hashComments: true, slashComments: false, keywords: PY_KEYWORDS }
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'env':
    case 'cfg':
    case 'ini':
    case 'conf':
    case 'toml':
      return { label: ext, hashComments: true, slashComments: false, keywords: SH_KEYWORDS }
    case 'yaml':
    case 'yml':
      return { label: 'yaml', hashComments: true, slashComments: false, keywords: ['true', 'false', 'null', 'yes', 'no', 'on', 'off'] }
    case 'java':
    case 'c':
    case 'h':
    case 'cpp':
    case 'hpp':
    case 'cc':
    case 'go':
    case 'rs':
      return { label: ext, hashComments: false, slashComments: true, keywords: JS_KEYWORDS }
    case 'sql':
      return { label: 'sql', hashComments: false, slashComments: true, keywords: SQL_KEYWORDS, caseInsensitiveKeywords: true }
    case 'css':
    case 'scss':
    case 'less':
      return { label: 'css', hashComments: false, slashComments: true, keywords: CSS_KEYWORDS }
    case 'xml':
    case 'html':
    case 'htm':
    case 'svg':
      return { label: ext, hashComments: false, slashComments: false, keywords: [] }
    case 'md':
    case 'mermaid':
      return { label: ext, hashComments: false, slashComments: false, keywords: [] }
    default:
      return null
  }
}

export function getCodeLanguage(filename: string): string {
  const ext = extOf(filename)
  if (ext === 'ts' && filename.endsWith('.d.ts')) return 'typescript'
  return configForExt(ext)?.label ?? 'text'
}

const STR = `"(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'|\`(?:\\\\.|[^\`\\\\])*\``
const NUM = `\\b(?:0x[\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?)\\b`

function buildCodePattern(cfg: LangConfig): RegExp {
  const parts: string[] = []
  // block comments first (longest match wins at a position)
  parts.push(`(?<com>/\\*[\\s\\S]*?(?:\\*/|$))`)
  const lineAlts: string[] = []
  if (cfg.slashComments) lineAlts.push(`//[^\\n]*`)
  if (cfg.hashComments) lineAlts.push(`#[^\\n]*`)
  if (lineAlts.length > 0) parts.push(`(?<com2>${lineAlts.join('|')})`)
  parts.push(`(?<str>${STR})`)
  parts.push(`(?<num>${NUM})`)
  if (cfg.keywords.length > 0) {
    const kw = cfg.keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    parts.push(`(?<kw>\\b(?:${kw})\\b)`)
  }
  parts.push(`(?<fn>\\b[A-Za-z_]\\w*(?=\\())`)
  // Note: no inline (?i:) in JS RegExp — case-insensitive languages (SQL)
  // get the 'i' flag on the whole pattern. Other groups are case-neutral,
  // so this only affects keyword matching.
  return new RegExp(parts.join('|'), cfg.caseInsensitiveKeywords ? 'gis' : 'gs')
}

function tokenizeCode(code: string, cfg: LangConfig): React.ReactNode[] {
  const pattern = buildCodePattern(cfg)
  const out: React.ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of code.matchAll(pattern)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(code.slice(last, idx))
    const text = m[0]
    const g = m.groups || {}
    const cls = g.com !== undefined || g.com2 !== undefined
      ? 'tok-com'
      : g.str !== undefined
        ? 'tok-str'
        : g.num !== undefined
          ? 'tok-num'
          : g.kw !== undefined
            ? 'tok-kw'
            : 'tok-fn'
    out.push(<span key={key++} className={cls}>{text}</span>)
    last = idx + text.length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

const MARKUP_PATTERN = /(<!--[\s\S]*?(?:-->|$))|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(<\/?[A-Za-z][\w:.-]*|\/?>|[\w:.-]+(?=\s*=\s*["']))/gs

function tokenizeMarkup(code: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of code.matchAll(MARKUP_PATTERN)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(code.slice(last, idx))
    const [text, comment, str] = m
    const cls = comment !== undefined ? 'tok-com' : str !== undefined ? 'tok-str' : 'tok-kw'
    out.push(<span key={key++} className={cls}>{text}</span>)
    last = idx + text.length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

const MD_PATTERN = /(^#{1,6}\s+[^\n]*|^```[^\n]*|```|`[^`\n]*`|\*\*[^*\n]+\*\*|\[[^\]\n]*\]\([^)\n]*\))/gm

function tokenizeMarkdown(code: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of code.matchAll(MD_PATTERN)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(code.slice(last, idx))
    out.push(<span key={key++} className="tok-kw">{m[0]}</span>)
    last = idx + m[0].length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

export function highlightToNodes(code: string, filename: string): React.ReactNode[] {
  const ext = extOf(filename)
  if (ext === 'html' || ext === 'htm' || ext === 'xml' || ext === 'svg') {
    return tokenizeMarkup(code)
  }
  if (ext === 'md' || ext === 'mermaid') {
    return tokenizeMarkdown(code)
  }
  const cfg = configForExt(ext)
  if (!cfg) return [code]
  return tokenizeCode(code, cfg)
}
