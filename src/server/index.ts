import './env'
import { serve } from '@hono/node-server'
import app from './app'
import { authReady } from './auth'

const port = Number(process.env.PORT) || 3000

async function start() {
  await authReady

  const server = serve({
    fetch: app.fetch,
    port,
  }, (info) => {
    console.log(`Server running at http://localhost:${info.port}`)
  })

  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...')
    server.close(() => process.exit(0))
  })

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down...')
    server.close(() => process.exit(0))
  })
}

start().catch(console.error)
