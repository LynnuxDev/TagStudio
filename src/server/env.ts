import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * Load `./.env` before anything else reads `process.env`.
 *
 * - Encrypted file (contains `DOTENV_PUBLIC_KEY`) → decrypted via dotenvx,
 *   which needs `.env.keys` next to it.
 * - Plain `KEY=VALUE` file → parsed here, no extra tooling needed, so a
 *   fresh `cp .env.example .env` just works.
 * - No `.env` at all (e.g. Docker, where env comes from compose) → no-op.
 *
 * Existing environment variables always win over file values.
 */
function parsePlainEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const body = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trimStart()
      : trimmed
    const eq = body.indexOf('=')
    if (eq <= 0) continue
    const key = body.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = body.slice(eq + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      const quote = value[0]
      value = value.slice(1, -1)
      if (quote === '"') {
        value = value
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
      }
    } else {
      const commentAt = value.search(/\s+#/)
      if (commentAt !== -1) value = value.slice(0, commentAt).trimEnd()
    }
    out[key] = value
  }
  return out
}

export function loadEnv(
  envPath: string = path.resolve(process.cwd(), '.env'),
): 'dotenvx' | 'plain' | 'none' {
  let raw: string
  try {
    raw = fs.readFileSync(envPath, 'utf8')
  } catch {
    return 'none'
  }

  if (raw.includes('DOTENV_PUBLIC_KEY')) {
    try {
      const requireFromCwd = createRequire(
        path.join(process.cwd(), 'package.json'),
      )
      requireFromCwd('@dotenvx/dotenvx/config')
    } catch (err) {
      throw new Error(
        `Failed to load encrypted .env via dotenvx (is @dotenvx/dotenvx installed and .env.keys present?): ${(err as Error).message}`,
      )
    }
    return 'dotenvx'
  }

  const parsed = parsePlainEnv(raw)
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) process.env[key] = value
  }
  return 'plain'
}

loadEnv()
