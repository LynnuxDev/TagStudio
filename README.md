# TagStudio

Tagged file browser and metadata manager — browse, tag, search, and organize files through a web UI.

> **Try the demo:** [tagstudio.lynnux.xyz](https://tagstudio.lynnux.xyz/)

<div align="center">
  <img src=".github/assets/image-list-home.png" width="49%" alt="File list view" />
  <img src=".github/assets/image-grid-videos.png" width="49%" alt="Grid view" />
  <img src=".github/assets/image-search.png" width="49%" alt="Search" />
  <img src=".github/assets/image-video-lightroom.png" width="49%" alt="Video lightbox" />
</div>

## Prerequisites

| Dependency | Required for | Install |
|---|---|---|
| Node.js >= 22 | Runtime | https://nodejs.org |
| pnpm >= 10 | Package management | `npm install -g pnpm` |
| ffmpeg | Video thumbnails | `apt install ffmpeg` / `brew install ffmpeg` |
| 7z | Archive extraction | `apt install p7zip-full` / `brew install p7zip` |
| mpv | "Open with mpv" | `apt install mpv` / `brew install mpv` |
| YACReader | "Open with YACReader" | https://www.yacreader.com |

Optional: Nix (supports `direnv` with flake.nix for dev shell).

## Setup

```bash
# Install JS dependencies
pnpm install

# Configure environment
cp .env.example .env
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ROOT` | `/mnt/other/DATA` | Root directory for file browsing |
| `PORT` | `3000` | Server port |
| `DATA_DIR` | `./data` | SQLite database directory |
| `BASE_URL` | `http://localhost:3000` | Public-facing server URL |
| `ORIGIN` | value of `BASE_URL` | Allowed CORS origin (production) |
| `BETTER_AUTH_SECRET` | — (required) | Session signing secret. Generate with `openssl rand -base64 32` |
| `NODE_ENV` | — | `production` in production, `demo` for read-only demo mode |

Example `.env`:

```
ROOT=/path/to/your/files
PORT=3000
BASE_URL=http://localhost:3000
ORIGIN=http://localhost:3000
DATA_DIR=./data
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
NODE_ENV=development
```

A plain `KEY=VALUE` file is all you need — the server loads `.env`
automatically on boot (both `pnpm dev` and `pnpm start`). dotenvx
encryption is optional: if `.env` contains a `DOTENV_PUBLIC_KEY`, it is
decrypted via dotenvx instead, which needs `.env.keys` alongside it
(`.env.keys` is gitignored — never commit it).

## First run

1. Start the server (`pnpm dev` or `pnpm build && pnpm start`).
2. Open the app — the setup screen asks you to create the admin account.
3. After setup, open Settings → Administration to **disable sign-up** (otherwise anyone who can reach the server can create a full-access account).

TagStudio is single-admin by design: every authenticated account has full
read/write access to `ROOT`. Only expose it to the network if sign-up is
disabled (or keep it on localhost).

### Guest read-only access

Settings → Administration → **Allow guest read-only access**. Visitors land
directly in a read-only view (browse, preview, search) without logging in;
a Login button stays in the header for the admin. Text-file contents,
archive listings, and all edits stay admin-only.

## Development

```bash
# Start both server and client with hot reload
pnpm dev

# Or separately:
pnpm dev:server   # Hono API server (port 3000)
pnpm dev:client   # Vite dev server (port 5173, proxies /api to :3000)
```

## Production

```bash
# Build client + server
pnpm build

# Start production server
pnpm start
```

The server serves the built client SPA and the API on the same port.

### Docker

```bash
export BETTER_AUTH_SECRET=$(openssl rand -base64 32)
docker compose up --build
```

The compose setup mounts `./data` (database) and `$HOME` (browsable files
as `/host`, i.e. `ROOT=/host`). Override with env vars, e.g.
`ROOT=/media` with an extra volume mount.

> If you previously used a `BETTER_AUTH_SECRET` that was committed to git
> history, generate a fresh one — old sessions will be invalidated.

## Demo mode

```bash
NODE_ENV=demo pnpm dev:server
```

Serves the bundled `./demo` folder read-only with auth bypassed. Used for
the public demo site.

## Tests

```bash
pnpm test
```

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Concurrent dev servers |
| `pnpm dev:server` | API server with tsx watch |
| `pnpm dev:client` | Vite dev server |
| `pnpm build:client` | Build client to `dist/client` |
| `pnpm build:server` | Build server to `dist/server` |
| `pnpm build` | Full build |
| `pnpm start` | Production start |
| `pnpm test` | Run tests |

## Architecture

```
src/
├── client/          # React SPA (Vite)
│   ├── components/  # UI components
│   ├── hooks/       # API client hooks
│   ├── styles/      # CSS
│   └── types/       # TypeScript types
└── server/          # Hono API server
    ├── routes/      # Route handlers
    ├── db/          # SQLite setup
    ├── utils/       # Shared utilities
    └── fileInfoExtras/ # Extension-specific file parsers
```

Data is stored in a SQLite database (`data/tagger.db`) with WAL mode. Authentication uses `better-auth` with email/password.

---

*Built with [opencode](https://opencode.ai) assistance.*
