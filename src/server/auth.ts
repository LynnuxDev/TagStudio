import { betterAuth } from 'better-auth'
import Database from 'better-sqlite3'
import { SqliteDialect } from 'kysely'
import path from 'path'
import fs from 'fs'

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

const sqliteDialect = new SqliteDialect({
  database: new Database(path.join(DATA_DIR, 'tagger.db')),
})

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

export const auth = betterAuth({
  database: {
    dialect: sqliteDialect,
    type: 'sqlite',
  },
  baseURL: `${BASE_URL}/api/auth`,
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: process.env.NODE_ENV === 'development'
    ? ['http://localhost:5173', 'http://localhost:3000']
    : [BASE_URL],
})

auth.$context.then(ctx => ctx.runMigrations()).catch(console.error)
