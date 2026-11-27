# WeKeepIt — Architecture & Institutional Knowledge Guide

> **Purpose**: Single source of truth for developers and AI assistants (e.g., Antigravity) resuming work on **WeKeepIt** from any machine without prior conversation context.

---

## 1. System Overview & Core Principles

- **Stack**: Pure Node.js (`http`, `https`, `fs`, `path`, `crypto`, `child_process`) + Vanilla HTML/CSS/JS (`index.html`, `style.css`, `app.js`), with SQLite FTS5 (`better-sqlite3` in `indexer/db.js`) for document indexing.
- **Zero-dependency frontend & minimal backend**: No frontend build step, no Express/framework overhead. All HTML/CSS/JS edits take effect immediately on server restart / browser hard refresh (`Ctrl+F5`).
- **Dual Mode (Adaptive Auth)**:
  - **Desktop Mode (`AUTH_ENABLED=false`, default)**: Zero-friction single-owner mode on `http://127.0.0.1:4321`.
  - **Team Server Mode (`AUTH_ENABLED=true`)**: Multi-user RBAC (`admin`, `editor`, `viewer`), HTTP-only session cookies + Bearer tokens, real-time SSE sync, online presence, and private per-user `🔒 My Board`.
- **Atomic Persistence**: All JSON writes (`writeJsonFile()` in `server.js`, `_atomicWriteUsers()` in `auth.js`, `_saveSessions()`) write to `.tmp` → rotate existing to `.bak` → atomic `fs.renameSync()`, with `.bak` auto-recovery on read.

---

## 2. File Map

| File / Directory | Role |
|---|---|
| `server.js` | HTTP/HTTPS server, REST & SSE API, adaptive auth enforcement, Vault file explorer/upload/download/images, Selective Server→Local Sync (`/api/sync/preview`, `/api/sync/pull`), graceful shutdown (`close()`). |
| `auth.js` | `AuthManager`, `ROLES` (`admin`, `editor`, `viewer`), `PERMISSIONS`, PBKDF2-SHA512 (100k iterations, 16-byte salt), persistent `sessions.json`, login brute-force rate limiter (5 failed attempts → `429`). |
| `app.js` | Entire client SPA: Notice Board, Kanban Flow, Timeline Gantt, Calendar, Table View, `🔒 My Board`, Document Vault Explorer, Real-time SSE (`EventSource`), Presence Bar, Comments/Activity/Screenshots, Selective Sync UI, 1-click Move to My Board, `Ctrl+V` Smart Pre-fill, Reports (`.md`, `.csv`, `.doc`). |
| `index.html` | SPA markup and all modals (`#cardModal`, `#dataModal`, `#archiveModal`, `#authModal`, `#userProfileModal`, `#userManagementModal`, `#folderModal`, `#schemaModal`). |
| `style.css` | Themes (`default`, `acrylic`, `daylight`, `cream`, `ocean`, `bulletin`), responsive layouts, Kanban/Gantt/Calendar/Sync/Presence styles. |
| `metadata-engine.js` | Tag & query parser (`+` AND, `,` OR), dynamic schema helpers. |
| `document-engine.js` | Frontend document browser & search UI helper. |
| `reminder-service.js` | Due-date countdowns, snooze, repeat, and Web Audio notifications. |
| `indexer/` | `db.js` (SQLite FTS5), `folder-manager.js`, `document-indexer.js`, `search-engine.js`, and parsers (`.md`, `.pdf`, `.docx`, `.xlsx`). |
| `deploy/` | RHEL/Linux production templates: `wekeepit.service`, `nginx-wekeepit.conf`, `.env.example`, `README-SERVER-DEPLOYMENT.md`. |
| `launch-team-server.bat` | Windows Team Server launcher (`AUTH_ENABLED=true`, `ALLOW_REMOTE_HOST=true`, `HOST=0.0.0.0`, auto-detects `wekeepit.pfx` or `.key`/`.crt` for native HTTPS). |
| `launch-auth-mode.bat` | Local auth-mode launcher (`AUTH_ENABLED=true` on `127.0.0.1:4321`). |
| `launch-desktop.bat` / `launch-silent.vbs` | Local Windows desktop launchers. |
| `backup-wekeepit.bat` / `setup-windows-tasks.ps1` | Daily backup script (14-day retention) and Windows Task Scheduler setup. |
| `test/*.test.js` | `node --test` integration & unit suites (**172 tests** as of v2.7.0). |

---

## 3. Data & Storage Layout

| Data | Default Path | Notes |
|---|---|---|
| Shared Notice Board & Kanban cards | `wekeepit-data.json` (or `DATA_FILE_PATH`) | Atomic `.tmp` / `.bak`. Cards with `status` belong to Kanban; without `status` belong to Notice Board. `archived: true` = Soft Delete. |
| Private per-user board (`🔒 My Board`) | `my-boards/<username>.json` (or `MY_BOARDS_DIR`) | Isolated per authenticated user (`local-owner.json` when auth disabled). Client also supports optional `localStorage` mode. |
| Metadata schema | `metadata-schema.json` (or `SCHEMA_FILE_PATH`) | Dynamic card metadata fields & `tagPalette`. |
| Users & password hashes | `users.json` (or `USERS_FILE_PATH`) | Single-seed `admin` (`admin123`) on first run. |
| Active auth sessions | `sessions.json` (alongside `users.json`) | Persisted across server restarts; expired sessions pruned automatically. |
| Document FTS5 index | `wekeepit-index.db` (or `INDEX_DB_PATH`) | Uses `:memory:` automatically under `NODE_ENV=test` / `TEST_MODE=1`. |
| Document Vault | `D:\WeKeepIt-Vault` on Windows (if `D:\` exists), else `./vault-storage` (or `VAULT_STORAGE_DIR`) | Max upload 18 MB (`MAX_VAULT_FILE_SIZE`). Allowed extensions: `.md`, `.pdf`, `.docx`, `.xlsx`. |
| Card Screenshots | `<vaultDir>/_images/` | Stored on disk, served via `/api/vault/image?name=...`. `cleanupOrphanVaultImages()` deletes unreferenced images older than a **10-minute grace period**. |

---

## 4. Key API Endpoints (`server.js`)

### Cards & Boards
- `GET /api/cards`, `POST /api/cards` (full replace), `PUT /api/cards/:id` (conflict-free single-card upsert), `DELETE /api/cards/:id` (single-card delete).
- `GET /api/my-cards`, `POST /api/my-cards` (private per-user `My Board`).
- `GET /api/schema`, `POST /api/schema`.

### Auth & Users (`auth.js`)
- `GET /api/auth/me`, `POST /api/auth/login`, `POST /api/auth/logout`.
- `PUT /api/auth/profile` (self-service displayName / password change).
- `GET /api/auth/users` (readable by all authenticated users for Kanban `assignees[]` picker), `POST/PUT/DELETE /api/auth/users` (Admin only; guards against removing/demoting the last Admin and syncs active sessions on role change).

### Real-Time & Presence
- `GET /api/events` (SSE stream: `cards_updated`, `my_cards_updated`, `schema_updated`, `vault_updated`, `presence_updated`).
- `POST /api/presence` (active view, editing card title, status text).

### Document Vault & Search
- `GET /api/vault/list?subPath=...`, `POST /api/vault/mkdir`, `POST /api/vault/upload`, `GET /api/vault/download?id=...`, `DELETE /api/vault/file`.
- `POST /api/vault/image`, `GET /api/vault/image?name=...`.
- `GET /api/folders`, `POST/PUT/DELETE /api/folders`, `POST /api/indexer/scan`, `GET /api/indexer/status`, `GET /api/search`, `POST /api/open-file`.

### Selective Server → Local Sync
- `POST /api/sync/preview`: Connects from local `server.js` to a remote WeKeepIt server (`http://` or `https://`, optional `allowSelfSigned` for LAN certs) to avoid browser CORS/TLS blocks. Returns Notice Board/Kanban cards, My Board cards, and recursive Vault files with exact byte sizes.
- `POST /api/sync/pull`: Merges selected `cards` and `myCards` into local storage without overwriting unrelated local cards, downloads referenced `_images/`, downloads selected Vault files into local `defaultVaultDir`, and triggers `documentIndexer.reindexFolder()`.

---

## 5. Deployment & Environment Topologies

1. **Local Development Workspace**: `f:\Project\Desktop\wekeepit`
   - Run tests: `npm test` (uses `node --test test/**/*.test.js`).
   - Run local auth server: `$env:AUTH_ENABLED="true"; node server.js` (or `launch-auth-mode.bat`).
2. **Installed Desktop App Sync Target (Windows)**: `C:\Users\822117\AppData\Local\Programs\WeKeepIt`
   - After editing `server.js`, `index.html`, `app.js`, or `style.css`, copy updated files there if testing the installed Windows app.
3. **Team Server (LAN)**: `ADV-3C88CE46B` (`https://10.63.99.44:4321`)
   - Launched via `launch-team-server.bat` with `AUTH_ENABLED=true`, `ALLOW_REMOTE_HOST=true`, `HOST=0.0.0.0`, and self-signed `wekeepit.pfx`.
   - Scheduled Task `WeKeepIt-TeamServer` (registered by `setup-windows-tasks.ps1`).

---

## 6. Critical Gotchas & Lessons Learned (Do Not Repeat)

- **PowerShell `Restart-ScheduledTask`**: Not available on older Windows PowerShell setups; use `Stop-ScheduledTask -TaskName 'WeKeepIt-TeamServer'; Start-Sleep -Seconds 2; Start-ScheduledTask -TaskName 'WeKeepIt-TeamServer'` instead.
- **PowerShell 5.1 command chaining**: Use `;` (and check `$LASTEXITCODE`), not `&&`.
- **Batch `else (...)` blocks (`launch-team-server.bat`)**: Unescaped `)` inside `echo` statements breaks `cmd.exe` `else (...)` blocks. Use `goto` labels instead.
- **`server.listen` Host Binding**: `sanitizeListenHost()` must allow `HOST=0.0.0.0` when `ALLOW_REMOTE_HOST=true`; otherwise it falls back to `127.0.0.1`.
- **Same-Origin LAN Check**: `isAllowedOrigin(origin, reqHost)` allows `http://${reqHost}` and `https://${reqHost}` only when `ALLOW_REMOTE_HOST=true`, preventing `403` on LAN IP/HTTPS logins while still blocking cross-origin attacks.
- **Browser Acrylic Theme Washout**: `body.theme-acrylic` using semi-transparent `rgba(...)` looks washed-out gray in regular browsers over white `<html>`; `html.is-web-browser` forces solid `--bg-app` background.
- **Duplicate Function Declarations in `app.js`**: Keep `renderIndexedDocsTable()` defined once; duplicate definitions inside the IIFE shadowed earlier fixes (e.g. Bulletin Board text contrast).
- **Orphan Image Grace Period**: Never delete `_images/` files immediately on card save if created < 10 minutes ago, or newly pasted images on unsaved/in-flight cards will be wiped.
- **No External `npm` Runtime Dependencies for Sync/Auth**: Use Node built-in `http`, `https`, `crypto`, `fs`, `path` so deployment on offline/air-gapped Windows & RHEL servers remains frictionless.
