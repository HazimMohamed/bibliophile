# Bibliophile

Bibliophile is an EPUB reader with a position-aware AI reading companion.

The big-picture product and architectural intent lives in [reader-design.md](/home/zuzu/Code/bibliophile/reader-design.md). This README is the practical repo guide: how the codebase is laid out, how to run it, how it is deployed, and how the Android development flow works.

## Screenshots

Add screenshots here later.

<!-- ![Library screenshot](docs/images/library-placeholder.png) -->

<!-- ![Reader screenshot](docs/images/reader-placeholder.png) -->

<!-- ![Conversation screenshot](docs/images/conversation-placeholder.png) -->

## What It Does

- Imports and reads EPUB books
- Tracks reading position by chapter and paragraph
- Stores highlights, notes, and reading-state locally on the backend
- Lets you open a conversation anchored to a selected passage
- Gives the AI only local reading context rather than the whole book at once

## Repo Shape

- [`backend/`](/home/zuzu/Code/bibliophile/backend): FastAPI app, EPUB ingestion, storage, summaries, chat routes
- [`frontend/`](/home/zuzu/Code/bibliophile/frontend): React + Vite web app, plus Capacitor Android project
- [`scripts/`](/home/zuzu/Code/bibliophile/scripts): utility scripts, Android deploy helpers, local dev proxy
- [`nginx/`](/home/zuzu/Code/bibliophile/nginx): nginx config for same-origin frontend + API serving
- [`systemd/`](/home/zuzu/Code/bibliophile/systemd): backend service unit for deployment
- [`reader-design.md`](/home/zuzu/Code/bibliophile/reader-design.md): design doc and architectural north star

## Architecture

### Backend

The backend is a single FastAPI app in [backend/main.py](/home/zuzu/Code/bibliophile/backend/main.py).

Important pieces:

- EPUB ingestion lives in [backend/epub.py](/home/zuzu/Code/bibliophile/backend/epub.py)
- Flat-file persistence lives in [backend/store.py](/home/zuzu/Code/bibliophile/backend/store.py)
- Chapter summarization lives in [backend/summarize.py](/home/zuzu/Code/bibliophile/backend/summarize.py)
- Reading-companion chat routes live in [backend/chat.py](/home/zuzu/Code/bibliophile/backend/chat.py)

Storage is intentionally simple:

- books are stored as JSON under `data/books`
- annotations and conversations are stored under `data/annotations`

`data/` is local runtime state and is intentionally not tracked in git.

### Frontend

The frontend is a React app under [frontend/src](/home/zuzu/Code/bibliophile/frontend/src).

Important pieces:

- [frontend/src/screens/Library.jsx](/home/zuzu/Code/bibliophile/frontend/src/screens/Library.jsx): library grid and upload entry point
- [frontend/src/screens/Reader.jsx](/home/zuzu/Code/bibliophile/frontend/src/screens/Reader.jsx): reading surface, selection flow, annotations
- [frontend/src/components/ChatPanel.jsx](/home/zuzu/Code/bibliophile/frontend/src/components/ChatPanel.jsx): reading companion UI
- [frontend/src/api.js](/home/zuzu/Code/bibliophile/frontend/src/api.js): app-facing API surface
- [frontend/src/transport.js](/home/zuzu/Code/bibliophile/frontend/src/transport.js): web vs native transport abstraction

### Web + API Same-Origin Setup

In deployed web mode, nginx serves the built frontend and proxies `/api/*` to the FastAPI backend.

That means:

- frontend loads from `/`
- API requests go to `/api/...`
- the browser sees one origin
- no CORS gymnastics are needed for the main deployed web app

The nginx config for that is in [nginx/bibliophile.conf](/home/zuzu/Code/bibliophile/nginx/bibliophile.conf).

## Local Development

### Prerequisites

- Python 3
- Node.js + npm
- Android Studio / Android SDK if you are doing Android work

### Backend + Frontend Together

The easiest local dev entrypoint is:

```bash
python3 dev.py
```

That starts:

- FastAPI backend on port `8000`
- Vite frontend dev server on port `5173`

In normal web dev, Vite proxies `/api` to `http://localhost:8000`, as configured in [frontend/vite.config.js](/home/zuzu/Code/bibliophile/frontend/vite.config.js).

### Manual Local Setup

Backend:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Environment Variables

Root-level backend env is loaded from `.env`.

Frontend env conventions:

- [frontend/.env.example](/home/zuzu/Code/bibliophile/frontend/.env.example): examples and notes
- `VITE_API_BASE_URL`: optional explicit API base for production/mobile builds
- `.env.android`: Android-only build config used by `npm run build:android`

Normal local web development usually does not need `VITE_API_BASE_URL`, because Vite handles `/api` proxying.

## Android Development

### Why Android Is Different

The Android app runs inside Capacitor, and the emulator is a little awkward around Tailscale/private routing during development.

The practical dev solution in this repo is:

- Android dev builds point at `http://10.0.2.2:8787/api`
- a small Windows-side relay forwards that traffic to whatever backend you choose
- the app uses a native/mobile-aware transport layer in [frontend/src/transport.js](/home/zuzu/Code/bibliophile/frontend/src/transport.js)

This avoids having to make the emulator itself a first-class Tailscale citizen during day-to-day development.

The Android-specific env file is:

- [frontend/.env.android](/home/zuzu/Code/bibliophile/frontend/.env.android)

### Local Dev Proxy

The relay lives in:

- [scripts/dev-proxy.js](/home/zuzu/Code/bibliophile/scripts/dev-proxy.js)

It can forward `/api/*` to:

- a local backend
- a tailnet-hosted backend
- any other backend base URL you provide

### Deploying To The Emulator

Primary Windows-side script:

- [scripts/deploy-android.ps1](/home/zuzu/Code/bibliophile/scripts/deploy-android.ps1)

This script:

- starts `adb`
- boots a best-guess emulator if needed
- prompts for the backend target to feed the relay
- starts the local relay
- builds Android-mode frontend assets in WSL
- builds the Android app on Windows
- installs and launches the APK

There is also a Linux/WSL-oriented sibling:

- [scripts/deploy-android.sh](/home/zuzu/Code/bibliophile/scripts/deploy-android.sh)

That script is currently experimental and should be treated as a starting point, not a guaranteed path.

### Script Helpers

Inside [scripts/package.json](/home/zuzu/Code/bibliophile/scripts/package.json):

```bash
cd scripts
npm run dev-proxy
```

This is mostly a convenience dispatch point for local tooling.

## Native Transport vs Web Transport

Bibliophile now branches transport by platform.

On web:

- normal browser `fetch`
- nginx same-origin `/api` proxy for deployed web

On native mobile:

- Capacitor native HTTP patching is enabled in [frontend/capacitor.config.json](/home/zuzu/Code/bibliophile/frontend/capacitor.config.json)
- app requests go through the transport abstraction in [frontend/src/transport.js](/home/zuzu/Code/bibliophile/frontend/src/transport.js)

This keeps the production mobile story sane:

- no dependency on a local relay in production
- no need to contort the mobile app around browser CORS rules
- easier future path to direct HTTPS tailnet or other native-safe backends

## Deployment

Production-ish deployment is handled by:

- [deploy.sh](/home/zuzu/Code/bibliophile/deploy.sh)

It:

- syncs the repo into `/opt/bibliophile`
- preserves local runtime `data/`
- builds the frontend
- installs nginx config
- installs the systemd service
- restarts backend + nginx

Supporting files:

- [nginx/bibliophile.conf](/home/zuzu/Code/bibliophile/nginx/bibliophile.conf)
- [systemd/bibliophile-backend.service](/home/zuzu/Code/bibliophile/systemd/bibliophile-backend.service)

### Deployed Request Flow

In deployed web mode, the flow is:

`browser -> nginx -> frontend at /`

`browser -> nginx -> /api/* -> FastAPI on 127.0.0.1:8000`

That same-origin setup is intentional and important.

## Notes For Contributors

- `data/` is local runtime state. Do not commit it.
- Android build artifacts and Gradle caches should not be committed.
- Windows `:Zone.Identifier` metadata files are ignored on purpose.
- The connection diagnostics UI still exists, but it is hidden by default behind `VITE_SHOW_CONNECTION_LAB=true`.

## Roadmap-ish Things

Add your own priorities here later.

- [ ] Screenshot section
- [ ] Better onboarding flow
- [ ] Better AI memory / continuity around letters and conversations
- [ ] Reader polish
- [ ] Mobile streaming transport refinement

## Big Picture

If you want the philosophical/architectural intent rather than just the repo mechanics, start with:

- [reader-design.md](/home/zuzu/Code/bibliophile/reader-design.md)
