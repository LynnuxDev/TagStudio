# Contributing

## Prerequisites

- Node.js >= 20
- pnpm
- ffmpeg (for video thumbnails)
- p7zip (for archive extraction)
- mpv (optional, "open with mpv")
- YACReader (optional, "open with YACReader")

## Setup

```bash
pnpm install
pnpm dev
```

## Project Structure

```
src/
├── client/   # React SPA (Vite)
└── server/   # Hono API server
```

## Guidelines

- **TypeScript** — use strict types. Avoid `any` and `as` casts.
- **No comments** — code should be self-documenting.
- **Tests** — add or update tests in `tests/`. Run with `pnpm test`.
- **API routes** — add auth middleware in `app.ts` if the route needs authentication.
- **Path safety** — always use `isWithinRoot()` from `utils/path.ts` for file path validation.

## Before Submitting

1. `pnpm tsc --noEmit` — no type errors
2. `pnpm test` — all tests pass
3. `pnpm build` — client and server build
