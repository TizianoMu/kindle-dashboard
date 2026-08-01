# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A monochrome, e-ink planner dashboard for a jailbroken Kindle. It is a
**bring-your-own-backend kit**: each owner runs their own InsForge project,
Telegram bot, and KUAL package config rather than sharing one backend. Three
independent surfaces meet at an InsForge backend:

- **Native C++ renderer** on the Kindle (`kindle/`) — fetches one JSON payload, draws it to the framebuffer, caches it for offline use.
- **InsForge edge functions** (`functions/`) — the cloud spine: dashboard read/toggle/events endpoints, Telegram webhook, health sync.
- **iOS companion** (`ios/HealthSyncCompanion/`) — reads Apple Health daily sums and POSTs them to the `health-sync` function.

`README.md` has a detailed, code-linked "Technical Breakdown" of the full data flow; read it before making cross-surface changes.

## Commands

Node scripts (`package.json`) orchestrate builds and setup; the actual C++ build lives in `kindle/native/Makefile`.

```bash
npm run native:check      # build the host binary and render fixtures/dashboard-data.json (the main sanity check)
npm run native:install    # deploy the ARM binary to a connected Kindle (scripts/install-kindle-native.mjs)
npm run native:proof      # scripts/check-kindle-proof.mjs
npm run kit:backend       # bootstrap a fresh InsForge project (scripts/bootstrap-insforge-kit.mjs)
npm run telegram:chat-id  # discover your Telegram chat ID
npm run telegram:configure

npx tsc                   # typecheck the edge functions (tsconfig noEmit; include = functions/**/*.ts)
```

Native build targets (run from `kindle/native/`):

```bash
make local        # host binary build/kindle-dashboard-local (for local render tests)
make check        # local build + --render on the JSON fixture
make kindle       # cross-compile ARM binary via KINDLE_CXX (default arm-linux-gnueabi-g++)
make kindle-zig   # cross-compile ARM binary via zig c++ (alternative toolchain)
make extension    # build ARM binary + package the full KUAL extension tarball
```

There is **no test framework**. Verification for the renderer is `make check`
(or running the local binary against a fixture with `--render` / `--save-pgm`);
verification for functions is `npx tsc`.

### Iterating on the renderer without a Kindle

The binary detects hardware; off-device it falls back to file output. Useful flags:

```bash
./build/kindle-dashboard-local --render fixtures/dashboard-data.json --save-pgm /tmp/out.pgm
./build/kindle-dashboard-local --url URL --cache /tmp/c.json --once --save-pgm /tmp/out.pgm   # exercise the fetch/render loop once
```

Key flags (see `parseOptions` / `main` in the renderer): `--url`, `--events-url`,
`--toggle-url`, `--read-token`, `--toggle-token`, `--cache`, `--interval`,
`--sleep-window HH:MM-HH:MM|off`, `--once`, `--invert-images`, `--render`,
`--view`, `--dump-pgm`, `--dump-size WxH`, `--save-pgm`.

## Architecture notes that span files

**Version-hash change detection is the sync backbone.** The dashboard read
endpoint (`functions/kindle-dashboard-data.ts`) hashes the visible state
(health, challenge, lists, meal_plan, recipes) into a short `version` string.
The SSE events endpoint (`functions/kindle-dashboard-events.ts`) recomputes that
version on a timer and only emits `event: planner` + the version when it
changes — the event never carries data, it just tells the Kindle to re-fetch.
The renderer's event watcher flips `g_event_refresh` on that line. If you change
what's considered "visible state," update the hash inputs or the Kindle stops
noticing changes.

**The renderer is a single ~3300-line C++ file**
(`kindle/native/src/kindle_dashboard.cpp`) with no external libraries: a
hand-rolled JSON parser fills a fixed `Dashboard` struct (bounded arrays, no
heap growth for the payload), a software rasterizer draws onto a grayscale
`Canvas`, and pixels go straight to `/dev/fb0` via mmap (with an `eips`/text
fallback). Fixed-size `char[]` fields everywhere — respect the size caps when
adding fields.

**Touch has no widget framework.** Each frame registers tappable rectangles
(`addTouchRegion`) into a global region list; a separate pthread
(`touchWatcher`) reads `/dev/input/event*` (grabbed via `EVIOCGRAB`), maps a tap
to a region, and sets `g_pending_action`, which the main loop drains via
`handlePendingTouch`. Because input is grabbed exclusively, an unresponsive main
loop makes the whole Kindle appear frozen.

**Fetch/render loop and offline behavior.** `main()` fetches to a temp file,
atomically renames it into the cache, then renders the cache; a failed fetch
falls back to the last cached payload (`renderCachedPayload(..., "cached/offline")`).
The fetch runs on a worker thread (`fetchToCacheResponsive`) so touches stay
responsive while `curl` blocks, and a failed fetch retries after
`kOfflineRetrySeconds` rather than the full `--interval`, so the dashboard
recovers quickly when Wi-Fi returns. Task toggles patch the cache optimistically
(`patchCachedItemDone`) and POST asynchronously (`postToggleItemAsync`).

**Telegram parsing is three-tier.** `parseTelegramMessage`
(`functions/telegram-webhook.ts`) tries a fast deterministic heuristic, then
OpenAI (only if `OPENAI_API_KEY` is set), then a deterministic fallback — every
path validates to a strict action object before any DB write. List names resolve
through `LIST_ALIASES`. The webhook gate is intentionally minimal: a secret
header check plus an allowed chat-ID check.

## Backend / config specifics

- Edge functions are **Deno** modules deployed to InsForge; they `import ... from "npm:@insforge/sdk"` and read config via `Deno.env.get(...)`. They are not bundled or run by the Node scripts here.
- App code reads secrets from `.env.local`; the `insforge` CLI reads `.insforge/project.json`. `.env.example` lists every required var (InsForge, Telegram, OpenAI, and the `DASHBOARD_READ_TOKEN` / `DASHBOARD_TOGGLE_TOKEN` / `HEALTH_SYNC_TOKEN` the endpoints check).
- The Kindle side is configured entirely through env vars in `kindle/kual/kindle-dashboard/config.sh` (template: `config.sh.example`), consumed by `kindle/kual/kindle-dashboard/bin/dashboard.sh` and `kindle/launch-dashboard.sh` — e.g. `DASHBOARD_DATA_URL`, `DASHBOARD_EVENTS_URL`, `INTERVAL`, `DASHBOARD_SLEEP_WINDOW`, `INVERT_IMAGES`.
- `migrations/` holds the Postgres schema (planner lists/items, recipes, meal plans, health summaries/targets, challenge logs) plus RLS-enabling and sample-data migrations, applied through InsForge.

## Working with InsForge

`AGENTS.md` documents the installed InsForge skills — prefer them
(`insforge`, `insforge-cli`, `insforge-debug`, `insforge-integrations`) over
guessing the API when touching the backend. Note its conventions: inserts take
an array (`insert([{ ... }])`), reference users via `auth.users(id)` and
`auth.uid()` in RLS, and persist both `url` and `key` for storage uploads.
