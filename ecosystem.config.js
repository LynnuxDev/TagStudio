module.exports = {
  apps: [{
    name: 'tagger',
    script: 'pnpm',
    args: 'start',
    interpreter: 'none',
    env: { NODE_ENV: 'demo', PORT: 3000 }
  }]
}