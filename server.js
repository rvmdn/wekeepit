const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const IndexDB = require('./indexer/db.js');
const { FolderManager } = require('./indexer/folder-manager.js');
const DocumentIndexer = require('./indexer/document-indexer.js');
const SearchEngine = require('./indexer/search-engine.js');
const MetadataEngine = require('./metadata-engine.js');
const { AuthManager, PERMISSIONS, ROLES } = require('./auth.js');

const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 4321;

// Loopback Host Resolution and Enforcement (Temuan 1 & Phase 6.2)
const ALLOWED_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function isLoopbackHost(host) {
  if (!host || typeof host !== 'string') return false;
  const clean = host.trim().toLowerCase();
  return ALLOWED_LOOPBACK_HOSTS.has(clean);
}

function resolveLoopbackHost(candidate, strict = false) {
  if (process.env.ALLOW_REMOTE_HOST === 'true' && candidate) {
    return candidate;
  }
  if (isLoopbackHost(candidate)) {
    const clean = candidate.trim().toLowerCase();
    // Prioritize 127.0.0.1 for desktop app reliability unless IPv6 loopback is explicitly requested
    return clean === '::1' ? '::1' : '127.0.0.1';
  }
  if (strict) {
    const err = new Error(`Host '${candidate}' tidak diizinkan: hanya alamat loopback (127.0.0.1, localhost, ::1) yang diterima.`);
    err.code = 'ERR_INVALID_HOST';
    throw err;
  }
  return '127.0.0.1';
}

function validateLoopbackHost(host) {
  if (!isLoopbackHost(host)) {
    const err = new Error(`Host '${host}' tidak diizinkan: hanya alamat loopback (127.0.0.1, localhost, ::1) yang diterima.`);
    err.code = 'ERR_INVALID_HOST';
    throw err;
  }
  return true;
}

const HOST = resolveLoopbackHost(process.env.HOST);
const DATA_FILE = process.env.DATA_FILE_PATH || path.join(__dirname, 'wekeepit-data.json');
const SCHEMA_FILE = process.env.SCHEMA_FILE_PATH || path.join(__dirname, 'metadata-schema.json');

// Security policy constants (Temuan 2 & Temuan 3)
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.ps1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.msc', '.msi', '.msp', '.com', '.scr', '.pif', '.reg', '.dll', '.sys',
  '.json', '.db', '.db-wal', '.db-shm', '.log', '.env', '.key', '.config', '.ini'
]);

const ALLOWED_DOC_EXTENSIONS = new Set(['.md', '.pdf', '.docx', '.xlsx']);

const ALLOWED_LOOPBACK_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const ALLOWED_EXACT_ORIGINS = new Set([
  'https://wekeepit.local',
  'http://wekeepit.local'
]);

function isAllowedOrigin(origin, reqHost = '') {
  if (!origin || typeof origin !== 'string') return false;
  const clean = origin.trim();
  if (clean === 'null' || clean === '') return false; // Strictly reject null origin (Temuan 2)
  if (ALLOWED_EXACT_ORIGINS.has(clean)) return true;
  if (ALLOWED_LOOPBACK_ORIGIN_REGEX.test(clean)) return true;
  if (process.env.ALLOW_REMOTE_HOST === 'true' && reqHost) {
    // Allow strictly same-origin requests when remote host mode is enabled
    return clean === `http://${reqHost}` || clean === `https://${reqHost}`;
  }
  return false;
}

function launchTarget(executable, args) {
  if (process.env.NODE_ENV === 'test' || process.env.TEST_MODE === '1' || process.argv.some(arg => typeof arg === 'string' && (arg.includes('test') || arg === '--test'))) {
    return;
  }
  spawn(executable, args, { detached: true, stdio: 'ignore' });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function readJsonFile(filePath, fallback = {}) {
  // Try primary file first, then .bak if primary is corrupt
  const candidates = [filePath, filePath + '.bak'];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const raw = fs.readFileSync(candidate, 'utf-8');
      if (!raw || !raw.trim()) continue; // empty file → try next
      const parsed = JSON.parse(raw);
      if (candidate !== filePath) {
        // Recovered from backup — log warning
        console.warn(`[RECOVERY] Primary file corrupt or empty, restored from ${candidate}`);
      }
      return parsed;
    } catch (err) {
      console.error(`Error reading ${candidate}:`, err.message);
    }
  }
  // Fallback to sample data for cards file
  if (filePath === DATA_FILE) {
    try {
      const samplePath = path.join(__dirname, 'wekeepit-data.sample.json');
      if (fs.existsSync(samplePath)) {
        return JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
      }
    } catch (_) {}
  }
  return fallback;
}

/**
 * Atomic write: write to <filePath>.tmp first, then fs.rename() — which is
 * a single syscall on Linux (POSIX rename(2) guarantee: atomic, no partial
 * state visible to readers). Also keeps a .bak of the previous good version.
 */
function writeJsonFile(filePath, data) {
  try {
    const resolved = path.resolve(filePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = resolved + '.tmp';
    const bakPath = resolved + '.bak';
    const payload = JSON.stringify(data, null, 2);

    // 1. Write to temp file
    fs.writeFileSync(tmpPath, payload, 'utf-8');

    // 2. Rotate: current → .bak (best-effort, non-fatal if it fails)
    try {
      if (fs.existsSync(resolved)) {
        fs.renameSync(resolved, bakPath);
      }
    } catch (bakErr) {
      console.warn(`[WARN] Could not rotate backup for ${resolved}:`, bakErr.message);
    }

    // 3. Atomic promote: .tmp → primary (POSIX atomic rename)
    fs.renameSync(tmpPath, resolved);

    return true;
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err.message);
    return false;
  }
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB limit (SEC-04)
const MAX_VAULT_UPLOAD_BODY_SIZE = 25 * 1024 * 1024; // 25MB base64 JSON (~18MB raw file)
const MAX_VAULT_FILE_SIZE = 18 * 1024 * 1024; // 18MB raw file limit

function parseBody(req, maxBytes = MAX_BODY_SIZE) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        const mb = Math.round(maxBytes / (1024 * 1024));
        const err = new Error(`Ukuran payload melebihi batas maksimum (${mb}MB)`);
        err.statusCode = 413;
        reject(err);
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Format JSON tidak valid'));
      }
    });
    req.on('error', reject);
  });
}

function createServerApp(options = {}) {
  const isTest = process.env.NODE_ENV === 'test' ||
    process.env.TEST_MODE === '1' ||
    process.argv.some(arg => typeof arg === 'string' && (arg.includes('test') || arg === '--test'));

  let dbPath = options.dbPath;
  if (dbPath === undefined) {
    if (process.env.INDEX_DB_PATH) {
      dbPath = process.env.INDEX_DB_PATH;
    } else if (isTest) {
      dbPath = ':memory:';
    } else {
      dbPath = undefined;
    }
  }

  const db = options.db || new IndexDB(dbPath);
  const folderManager = options.folderManager || new FolderManager(db);
  const documentIndexer = options.documentIndexer || new DocumentIndexer(db, folderManager);
  const searchEngine = options.searchEngine || new SearchEngine(db);
  const metaEngine = options.metaEngine || new MetadataEngine();
  const authManager = options.authManager || new AuthManager({
    usersFile: options.usersFile,
    authEnabled: options.authEnabled !== undefined ? options.authEnabled : (process.env.AUTH_ENABLED === 'true' || process.env.AUTH_ENABLED === '1')
  });
  const dataFile = options.dataFile || process.env.DATA_FILE_PATH || DATA_FILE;
  const schemaFile = options.schemaFile || process.env.SCHEMA_FILE_PATH || SCHEMA_FILE;
  const launcher = options.launchTarget || launchTarget;
  const baseDir = options.baseDir || __dirname;
  const defaultVaultDir = options.vaultDir
    || process.env.VAULT_STORAGE_DIR
    || (process.platform === 'win32' && fs.existsSync('D:\\') ? 'D:\\WeKeepIt-Vault' : path.join(baseDir, 'vault-storage'));
  const myBoardsDir = options.myBoardsDir
    || process.env.MY_BOARDS_DIR
    || path.join(path.dirname(path.resolve(dataFile)), 'my-boards');

  function getUserBoardFile(username) {
    const clean = String(username || 'local-owner').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!clean) throw new Error('Username tidak valid untuk My Board.');
    const resolvedDir = path.resolve(myBoardsDir);
    const target = path.resolve(resolvedDir, `${clean}.json`);
    const prefix = resolvedDir.endsWith(path.sep) ? resolvedDir : resolvedDir + path.sep;
    if (!target.startsWith(prefix)) throw new Error('Path My Board tidak valid.');
    return target;
  }

  const sseClients = new Map(); // res -> { username, displayName, role, view, editingTitle }

  function getActivePresenceList() {
    const byUser = new Map();
    for (const info of sseClients.values()) {
      if (!info || !info.username) continue;
      byUser.set(info.username, {
        username: info.username,
        displayName: info.displayName || info.username,
        role: info.role || 'viewer',
        view: info.view || 'Notice Board',
        statusText: info.statusText || '',
        editingTitle: info.editingTitle || null
      });
    }
    return Array.from(byUser.values());
  }

  function broadcastEvent(eventName, payload = {}) {
    if (sseClients.size === 0) return;
    const frame = `event: ${eventName}\ndata: ${JSON.stringify({ ...payload, ts: Date.now() })}\n\n`;
    for (const clientRes of sseClients.keys()) {
      try {
        clientRes.write(frame);
      } catch {
        sseClients.delete(clientRes);
      }
    }
  }

  function broadcastToUser(username, eventName, payload = {}) {
    if (sseClients.size === 0 || !username) return;
    const clean = String(username).trim().toLowerCase();
    const frame = `event: ${eventName}\ndata: ${JSON.stringify({ ...payload, ts: Date.now() })}\n\n`;
    for (const [clientRes, info] of sseClients.entries()) {
      if (info && info.username && info.username.toLowerCase() === clean) {
        try {
          clientRes.write(frame);
        } catch {
          sseClients.delete(clientRes);
        }
      }
    }
  }

  function initWatchers() {
    try {
      const folders = folderManager.listFolders();
      for (const f of folders) {
        if (f.enabled) {
          folderManager.startWatcher(f.id, (folderId, eventType, filename) => {
            console.log(`[Watcher] Deteksi perubahan (${eventType}) pada ${filename} di folder ${folderId}`);
            documentIndexer.reindexFolder(folderId).catch(err => {
              console.warn(`[Watcher] Auto-reindex error:`, err.message);
            });
          });
        }
      }
    } catch (err) {
      console.warn('[Watcher] Gagal menginisialisasi folder watchers:', err.message);
    }
  }

  const requestHandler = async (req, res) => {
    // 1. Host Header Validation (Prevent DNS Rebinding attacks)
    const host = req.headers.host || '';
    const isHostValid = !host || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host) || (process.env.ALLOW_REMOTE_HOST === 'true');
    if (!isHostValid) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden: Host header tidak diizinkan');
      return;
    }

    // 2. Strict CORS policy (Temuan 2: Reject null Origin, block foreign origins, allowlist desktop/loopback)
    const origin = req.headers.origin;

    if (origin !== undefined) {
      if (isAllowedOrigin(origin, host)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Vary', 'Origin');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
      } else {
        // Disallowed Origin (e.g. null, https://malicious.com, or arbitrary foreign scheme)
        if (req.method === 'OPTIONS') {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('403 Forbidden: Origin tidak diizinkan');
          return;
        }

        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '403 Forbidden: Origin cross-origin tidak diizinkan' }));
        return;
      }
    } else {
      // No Origin header: direct same-origin browser navigation, internal curl/PowerShell, or native app
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // 3. Path Traversal Protection on raw request path (SEC-01)
    const rawPath = (req.url || '').split('?')[0];
    if (rawPath.includes('..') || /%2e%2e/i.test(rawPath) || rawPath.includes('\\')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden: Akses path traversal ditolak');
      return;
    }

    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = reqUrl.pathname;

    // Authentication & Session Context
    const authUser = authManager.authenticateRequest(req);

    // --- Authentication & Session API ---
    if (pathname === '/api/auth/config') {
      sendJson(res, 200, {
        authEnabled: authManager.isAuthEnabled()
      });
      return;
    }

    if (pathname === '/api/auth/me') {
      if (!authManager.isAuthEnabled()) {
        sendJson(res, 200, {
          authenticated: true,
          authEnabled: false,
          user: { username: 'local-owner', role: ROLES.ADMIN, displayName: 'Local Owner' }
        });
        return;
      }

      if (authUser) {
        sendJson(res, 200, {
          authenticated: true,
          authEnabled: true,
          user: {
            username: authUser.username,
            role: authUser.role,
            displayName: authUser.displayName
          }
        });
      } else {
        sendJson(res, 200, {
          authenticated: false,
          authEnabled: true,
          user: null
        });
      }
      return;
    }

    if (pathname === '/api/auth/login') {
      if (req.method === 'POST') {
        try {
          const body = await parseBody(req);
          const { username, password } = body;
          const result = authManager.login(username, password);
          if (!result.success) {
            sendJson(res, 401, { error: result.error });
            return;
          }

          const secureFlag = req.socket && req.socket.encrypted ? '; Secure' : '';
          res.setHeader('Set-Cookie', `wekeepit_token=${result.token}; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=${7 * 24 * 3600}`);
          sendJson(res, 200, {
            success: true,
            token: result.token,
            user: result.user
          });
          return;
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return;
        }
      }
    }

    if (pathname === '/api/auth/logout') {
      if (req.method === 'POST') {
        const token = authManager.extractToken(req);
        if (token) {
          authManager.logout(token);
        }
        const secureFlag = req.socket && req.socket.encrypted ? '; Secure' : '';
        res.setHeader('Set-Cookie', `wekeepit_token=; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=0`);
        sendJson(res, 200, { success: true });
        return;
      }
    }

    // Self-service profile & password update (any authenticated user)
    if (pathname === '/api/auth/profile') {
      if (req.method === 'PUT') {
        if (authManager.isAuthEnabled() && !authUser) {
          sendJson(res, 401, { error: '401 Unauthorized: Otentikasi diperlukan.', authRequired: true });
          return;
        }
        if (!authManager.isAuthEnabled()) {
          sendJson(res, 400, { error: 'Profil pengguna hanya tersedia pada mode server (AUTH_ENABLED=true).' });
          return;
        }
        try {
          const body = await parseBody(req);
          const updated = authManager.updateOwnProfile(authUser.username, body);
          for (const info of sseClients.values()) {
            if (info.username === updated.username) {
              info.displayName = updated.displayName;
              info.statusText = updated.statusText || '';
            }
          }
          broadcastEvent('presence_updated', { users: getActivePresenceList() });
          sendJson(res, 200, { success: true, user: updated });
          return;
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return;
        }
      }
    }

    // User management (Roster read for all authenticated users, mutations for Admin only)
    if (pathname === '/api/auth/users') {
      if (req.method === 'GET') {
        if (authManager.isAuthEnabled() && !authUser) {
          sendJson(res, 401, { error: '401 Unauthorized: Otentikasi diperlukan.', authRequired: true });
          return;
        }
        sendJson(res, 200, authManager.listUsers());
        return;
      }

      if (req.method === 'POST') {
        if (authManager.isAuthEnabled() && (!authUser || !authManager.can(authUser, PERMISSIONS.MANAGE_USERS))) {
          sendJson(res, 403, { error: '403 Forbidden: Hanya Administrator yang dapat mengelola pengguna.' });
          return;
        }
        try {
          const body = await parseBody(req);
          const newUser = authManager.createUser(body);
          sendJson(res, 201, { success: true, user: newUser });
          return;
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return;
        }
      }
    }

    if (pathname.startsWith('/api/auth/users/')) {
      if (authManager.isAuthEnabled() && (!authUser || !authManager.can(authUser, PERMISSIONS.MANAGE_USERS))) {
        sendJson(res, 403, { error: '403 Forbidden: Hanya Administrator yang dapat mengelola pengguna.' });
        return;
      }

      const targetUsername = decodeURIComponent(pathname.substring('/api/auth/users/'.length));

      if (req.method === 'PUT') {
        try {
          const body = await parseBody(req);
          const updated = authManager.updateUser(targetUsername, body);
          sendJson(res, 200, { success: true, user: updated });
          return;
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return;
        }
      }

      if (req.method === 'DELETE') {
        try {
          authManager.deleteUser(targetUsername, authUser ? authUser.username : null);
          sendJson(res, 200, { success: true });
          return;
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return;
        }
      }
    }

    // Gate all other /api/* endpoints when authentication is enabled:
    if (pathname.startsWith('/api/') && pathname !== '/api/ping') {
      if (authManager.isAuthEnabled() && !authUser) {
        sendJson(res, 401, {
          error: '401 Unauthorized: Otentikasi diperlukan. Silakan login terlebih dahulu.',
          authRequired: true
        });
        return;
      }
    }

    // Private per-user My Board cards (any authenticated user may read/write their OWN board only)
    if (pathname === '/api/my-cards') {
      const ownerUsername = authUser ? authUser.username : 'local-owner';
      if (req.method === 'GET') {
        try {
          const userFile = getUserBoardFile(ownerUsername);
          const myCards = readJsonFile(userFile, []);
          sendJson(res, 200, Array.isArray(myCards) ? myCards : []);
        } catch (err) {
          sendJson(res, 400, { error: err.message });
        }
        return;
      }

      if (req.method === 'POST') {
        try {
          const myCards = await parseBody(req);
          if (!Array.isArray(myCards)) {
            sendJson(res, 400, { error: 'Payload harus berupa array kartu.' });
            return;
          }
          const userFile = getUserBoardFile(ownerUsername);
          writeJsonFile(userFile, myCards);
          broadcastToUser(ownerUsername, 'my_cards_updated', { count: myCards.length });
          sendJson(res, 200, { success: true, count: myCards.length });
          return;
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return;
        }
      }
    }

    // --- API V1 Endpoints (Preserved 100%) ---
    if (pathname === '/api/cards') {
      if (req.method === 'GET') {
        const cards = readJsonFile(dataFile, []);
        sendJson(res, 200, cards);
        return;
      }

      if (req.method === 'POST') {
        if (authManager.isAuthEnabled() && !authManager.can(authUser, PERMISSIONS.WRITE_CARDS)) {
          sendJson(res, 403, { error: '403 Forbidden: Peran Anda (Viewer) tidak memiliki izin menambah atau mengubah kartu.' });
          return;
        }
        try {
          const cards = await parseBody(req);
          if (Array.isArray(cards)) {
            writeJsonFile(dataFile, cards);
            broadcastEvent('cards_updated', {
              count: cards.length,
              by: authUser ? authUser.username : 'local'
            });
            sendJson(res, 200, { success: true, count: cards.length });
            return;
          }
          throw new Error('Cards payload must be an array');
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return;
        }
      }
    }

    if (pathname === '/api/schema') {
      if (req.method === 'GET') {
        const schema = readJsonFile(schemaFile, { fields: [], tagPalette: {} });
        sendJson(res, 200, schema);
        return;
      }

      if (req.method === 'POST') {
        if (authManager.isAuthEnabled() && !authManager.can(authUser, PERMISSIONS.WRITE_SCHEMA)) {
          sendJson(res, 403, { error: '403 Forbidden: Peran Anda tidak memiliki izin memodifikasi skema metadata.' });
          return;
        }
        try {
          const schema = await parseBody(req);
          writeJsonFile(schemaFile, schema);
          broadcastEvent('schema_updated', { by: authUser ? authUser.username : 'local' });
          sendJson(res, 200, { success: true });
          return;
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return;
        }
      }
    }

    if (pathname === '/api/ping') {
      sendJson(res, 200, {
        status: 'ok',
        version: '2.0.0',
        time: new Date().toISOString(),
        stats: db.getStats()
      });
      return;
    }

    // Real-time Server-Sent Events (SSE) stream for live multi-user sync & presence
    if (pathname === '/api/events') {
      if (req.method === 'GET') {
        const viewParam = reqUrl.searchParams.get('view') || 'Notice Board';
        const clientInfo = {
          username: authUser ? authUser.username : 'local-owner',
          displayName: authUser ? (authUser.displayName || authUser.username) : 'Pemilik Lokal',
          role: authUser ? authUser.role : 'admin',
          view: String(viewParam).slice(0, 60),
          statusText: authUser ? (authUser.statusText || '') : '',
          editingTitle: null
        };

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        sseClients.set(res, clientInfo);
        res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);
        broadcastEvent('presence_updated', { users: getActivePresenceList() });

        const heartbeat = setInterval(() => {
          try {
            res.write(': heartbeat\n\n');
          } catch {
            clearInterval(heartbeat);
            sseClients.delete(res);
            broadcastEvent('presence_updated', { users: getActivePresenceList() });
          }
        }, 25000);
        if (typeof heartbeat.unref === 'function') heartbeat.unref();

        req.on('close', () => {
          clearInterval(heartbeat);
          sseClients.delete(res);
          broadcastEvent('presence_updated', { users: getActivePresenceList() });
        });
        return;
      }
    }

    // Update current user's active view / editing status for presence bar
    if (pathname === '/api/presence') {
      if (req.method === 'POST') {
        try {
          const payload = await parseBody(req);
          const uname = authUser ? authUser.username : 'local-owner';
          for (const info of sseClients.values()) {
            if (info.username === uname) {
              if (payload.view !== undefined) info.view = String(payload.view || 'Notice Board').slice(0, 60);
              if (payload.editingTitle !== undefined) {
                info.editingTitle = payload.editingTitle ? String(payload.editingTitle).slice(0, 80) : null;
              }
            }
          }
          broadcastEvent('presence_updated', { users: getActivePresenceList() });
          sendJson(res, 200, { success: true });
          return;
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return;
        }
      }
    }

    if (pathname === '/api/browse-folder') {
      if (req.method === 'GET' || req.method === 'POST') {
        if (process.env.NODE_ENV === 'test') {
          sendJson(res, 200, { path: 'C:\\fake-test-folder' });
          return;
        }
        if (process.platform === 'win32') {
          const { execFile } = require('child_process');
          const psScript = `
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.StartPosition = 'CenterScreen'
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Pilih Folder Dokumen untuk Diindeks'
$dialog.UseDescriptionForTitle = $true
$dialog.ShowNewFolderButton = $true
$res = $dialog.ShowDialog($form)
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
}
`;
          const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
          execFile('powershell', ['-NoProfile', '-STA', '-EncodedCommand', b64], (err, stdout) => {
            const selected = (stdout || '').trim();
            sendJson(res, 200, { path: selected || null });
          });
          return;
        }
        sendJson(res, 400, { error: 'Folder picker dialog hanya didukung di Windows.' });
        return;
      }
    }

    // --- API V2 Endpoints (Document Library, Indexing, and Search) ---

    // Folders management
    if (pathname === '/api/folders') {
      if (req.method === 'GET') {
        const folders = folderManager.listFolders();
        // Attach doc counts for each folder
        const foldersWithMeta = folders.map(f => {
          const docs = db.getDocumentsByFolder(f.id);
          return {
            ...f,
            totalDocs: docs.length,
            readyDocs: docs.filter(d => d.status === 'ready').length,
            failedDocs: docs.filter(d => d.status === 'failed').length
          };
        });
        sendJson(res, 200, foldersWithMeta);
        return;
      }

      if (req.method === 'POST') {
        if (authManager.isAuthEnabled() && !authManager.can(authUser, PERMISSIONS.MANAGE_FOLDERS)) {
          sendJson(res, 403, { error: '403 Forbidden: Peran Anda tidak memiliki izin mengelola folder dokumen.' });
          return;
        }
        try {
          const payload = await parseBody(req);
          const folder = folderManager.addFolder(payload.path, payload);
          // Start watcher
          folderManager.startWatcher(folder.id, (folderId) => {
            documentIndexer.reindexFolder(folderId).catch(() => {});
          });
          // Trigger initial index in background
          setImmediate(() => {
            documentIndexer.reindexFolder(folder.id).catch(err => {
              console.warn(`Initial indexing error for ${folder.path}:`, err.message);
            });
          });
          sendJson(res, 201, folder);
          return;
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return;
        }
      }

      if (req.method === 'PUT') {
        if (authManager.isAuthEnabled() && !authManager.can(authUser, PERMISSIONS.MANAGE_FOLDERS)) {
          sendJson(res, 403, { error: '403 Forbidden: Peran Anda tidak memiliki izin mengelola folder dokumen.' });
          return;
        }
        try {
          const payload = await parseBody(req);
          const id = payload.id || reqUrl.searchParams.get('id');
          if (!id) throw new Error('ID folder wajib diberikan');

          if (payload.enabled !== undefined) {
            folderManager.toggleFolder(id, payload.enabled);
          }
          if (payload.excluded_patterns !== undefined) {
            folderManager.updateFolderExclusions(id, payload.excluded_patterns);
          }
          sendJson(res, 200, { success: true });
          return;
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return;
        }
      }

      if (req.method === 'DELETE') {
        if (authManager.isAuthEnabled() && !authManager.can(authUser, PERMISSIONS.MANAGE_FOLDERS)) {
          sendJson(res, 403, { error: '403 Forbidden: Peran Anda tidak memiliki izin mengelola folder dokumen.' });
          return;
        }
        try {
          const id = reqUrl.searchParams.get('id');
          if (!id) throw new Error('ID folder wajib disertakan');
          folderManager.removeFolder(id);
          sendJson(res, 200, { success: true });
          return;
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return;
        }
      }
    }

    // Indexer status & control
    if (pathname === '/api/indexer/status') {
      if (req.method === 'GET') {
        sendJson(res, 200, documentIndexer.getStatus());
        return;
      }
    }

    if (pathname === '/api/indexer/scan') {
      if (req.method === 'POST') {
        if (authManager.isAuthEnabled() && !authManager.can(authUser, PERMISSIONS.MANAGE_INDEXER)) {
          sendJson(res, 403, { error: '403 Forbidden: Peran Anda tidak memiliki izin memicu indexing dokumen.' });
          return;
        }
        try {
          const payload = await parseBody(req);
          const folderId = payload.folderId;
          
          if (documentIndexer.isIndexing) {
            sendJson(res, 409, { error: 'Proses indexing sudah berjalan' });
            return;
          }

          // Run asynchronously in background
          setImmediate(() => {
            if (folderId) {
              documentIndexer.reindexFolder(folderId).catch(err => console.warn('Scan error:', err.message));
            } else {
              documentIndexer.reindexAll().catch(err => console.warn('Scan all error:', err.message));
            }
          });

          sendJson(res, 202, { message: 'Indexing telah dimulai di latar belakang' });
          return;
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return;
        }
      }
    }

    if (pathname === '/api/indexer/cancel') {
      if (req.method === 'POST') {
        if (authManager.isAuthEnabled() && !authManager.can(authUser, PERMISSIONS.MANAGE_INDEXER)) {
          sendJson(res, 403, { error: '403 Forbidden: Peran Anda tidak memiliki izin menghentikan proses indexing.' });
          return;
        }
        const cancelled = documentIndexer.cancel();
        sendJson(res, 200, { cancelled });
        return;
      }
    }

    // Documents listing
    if (pathname === '/api/documents') {
      if (req.method === 'GET') {
        const folderId = reqUrl.searchParams.get('folderId');
        const docs = folderId ? db.getDocumentsByFolder(folderId) : db.getAllDocuments();
        sendJson(res, 200, docs);
        return;
      }
    }

    // Vault Document Upload (stores file on server storage, auto-registers D:\WeKeepIt-Vault, & indexes)
    if (pathname === '/api/vault/upload') {
      if (req.method === 'POST') {
        if (authManager.isAuthEnabled() && (!authUser || !authManager.can(authUser, PERMISSIONS.WRITE_CARDS))) {
          sendJson(res, 403, { error: '403 Forbidden: Peran Anda (Viewer) tidak memiliki izin mengunggah dokumen.' });
          return;
        }
        try {
          const payload = await parseBody(req, MAX_VAULT_UPLOAD_BODY_SIZE);
          const rawName = typeof payload.fileName === 'string' ? payload.fileName : '';
          const baseName = path.basename(rawName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
          if (!baseName) {
            sendJson(res, 400, { error: 'Nama berkas tidak valid.' });
            return;
          }
          const ext = path.extname(baseName).toLowerCase();
          if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
            sendJson(res, 400, { error: `Tipe berkas '${ext || '(tanpa ekstensi)'}' tidak didukung. Gunakan: .md, .pdf, .docx, .xlsx` });
            return;
          }
          if (typeof payload.contentBase64 !== 'string' || !payload.contentBase64) {
            sendJson(res, 400, { error: 'Isi berkas (contentBase64) tidak boleh kosong.' });
            return;
          }
          const fileBuffer = Buffer.from(payload.contentBase64, 'base64');
          if (fileBuffer.length === 0) {
            sendJson(res, 400, { error: 'Berkas kosong atau format base64 tidak valid.' });
            return;
          }
          if (fileBuffer.length > MAX_VAULT_FILE_SIZE) {
            sendJson(res, 413, { error: 'Ukuran berkas melebihi batas maksimum (18MB).' });
            return;
          }

          // Resolve target folder (explicit folderId or defaultVaultDir on D:\WeKeepIt-Vault)
          let targetFolder = null;
          if (payload.folderId) {
            targetFolder = db.getFolderById(String(payload.folderId));
            if (!targetFolder || !targetFolder.path) {
              sendJson(res, 404, { error: 'Folder tujuan tidak ditemukan.' });
              return;
            }
          } else {
            if (!fs.existsSync(defaultVaultDir)) {
              fs.mkdirSync(defaultVaultDir, { recursive: true });
            }
            const resolvedVault = path.resolve(defaultVaultDir);
            const existing = folderManager.listFolders().find(f => {
              try {
                return path.resolve(f.path).toLowerCase() === resolvedVault.toLowerCase();
              } catch {
                return false;
              }
            });
            targetFolder = existing || await folderManager.addFolder(resolvedVault, { name: 'WeKeepIt Vault (Server)' });
          }

          const resolvedFolder = fs.realpathSync(targetFolder.path);
          let finalName = baseName;
          let destPath = path.resolve(resolvedFolder, finalName);

          // Avoid silent overwrite on filename collision
          if (fs.existsSync(destPath)) {
            const stem = path.basename(baseName, ext);
            finalName = `${stem}-${Date.now()}${ext}`;
            destPath = path.resolve(resolvedFolder, finalName);
          }

          // Strict path boundary check
          const folderPrefix = resolvedFolder.endsWith(path.sep) ? resolvedFolder : resolvedFolder + path.sep;
          if (!destPath.startsWith(folderPrefix)) {
            sendJson(res, 403, { error: '403 Forbidden: Lokasi tujuan tidak valid.' });
            return;
          }

          const tmpDest = destPath + '.tmp';
          fs.writeFileSync(tmpDest, fileBuffer);
          fs.renameSync(tmpDest, destPath);

          // Trigger indexing for this folder so the file is immediately searchable
          await documentIndexer.reindexFolder(targetFolder.id);
          broadcastEvent('vault_updated', {
            fileName: finalName,
            folderId: targetFolder.id,
            by: authUser ? authUser.username : 'local'
          });

          sendJson(res, 201, {
            success: true,
            fileName: finalName,
            size: fileBuffer.length,
            path: destPath,
            folderId: targetFolder.id,
            folderPath: targetFolder.path
          });
          return;
        } catch (err) {
          sendJson(res, err.statusCode || 400, { error: err.message });
          return;
        }
      }
    }

    // Vault Document Download (remote-safe download by indexed document id)
    if (pathname === '/api/vault/download') {
      if (req.method === 'GET') {
        const docId = reqUrl.searchParams.get('id');
        if (!docId) {
          sendJson(res, 400, { error: 'Parameter id dokumen diperlukan.' });
          return;
        }
        const doc = db.getAllDocuments().find(d => String(d.id) === String(docId));
        if (!doc || !doc.path || !fs.existsSync(doc.path)) {
          sendJson(res, 404, { error: 'Dokumen tidak ditemukan pada penyimpanan server.' });
          return;
        }
        try {
          const canonicalTarget = fs.realpathSync(doc.path);
          const ext = path.extname(canonicalTarget).toLowerCase();
          if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
            sendJson(res, 403, { error: 'Tipe berkas tidak diizinkan untuk diunduh.' });
            return;
          }
          // Verify file sits inside a registered folder
          const registeredFolders = folderManager.listFolders();
          const inRegistered = registeredFolders.some(f => {
            try {
              if (!f.path || !fs.existsSync(f.path)) return false;
              const cf = fs.realpathSync(f.path);
              const prefix = cf.endsWith(path.sep) ? cf : cf + path.sep;
              return canonicalTarget.toLowerCase().startsWith(prefix.toLowerCase());
            } catch {
              return false;
            }
          });
          if (!inRegistered) {
            sendJson(res, 403, { error: '403 Forbidden: Berkas berada di luar folder terdaftar.' });
            return;
          }

          const downloadName = path.basename(canonicalTarget).replace(/["\r\n]/g, '_');
          const content = fs.readFileSync(canonicalTarget);
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${downloadName}"`,
            'Content-Length': content.length
          });
          res.end(content);
          return;
        } catch (err) {
          sendJson(res, 500, { error: 'Gagal membaca berkas: ' + err.message });
          return;
        }
      }
    }

    // Universal Search Endpoint
    if (pathname === '/api/search') {
      if (req.method === 'GET') {
        const q = reqUrl.searchParams.get('q') || '';
        const mode = reqUrl.searchParams.get('mode') || null; // 'exact' | 'all_terms'
        const scope = (reqUrl.searchParams.get('scope') || 'all').toLowerCase(); // 'board' | 'documents' | 'all'
        const page = parseInt(reqUrl.searchParams.get('page'), 10) || 1;
        const limit = parseInt(reqUrl.searchParams.get('limit'), 10) || 20;

        let boardResults = [];
        let docSearchResults = { results: [], total: 0, totalPages: 0 };

        // Search documents
        if (scope === 'documents' || scope === 'all') {
          docSearchResults = searchEngine.searchDocuments(q, { mode, page, limit });
        }

        // Search board cards
        if (scope === 'board' || scope === 'all') {
          const cards = readJsonFile(dataFile, []);
          const schema = readJsonFile(schemaFile, { fields: [], tagPalette: {} });
          metaEngine.setSchema(schema);
          boardResults = searchEngine.searchBoardCards(cards, q, metaEngine);
        }

        sendJson(res, 200, {
          query: q,
          scope,
          mode: docSearchResults.mode || mode || 'all_terms',
          board: {
            count: boardResults.length,
            cards: boardResults
          },
          documents: docSearchResults
        });
        return;
      }
    }

    // Native Open File or Show in Folder (Temuan 3: Strict security boundaries)
    if (pathname === '/api/open-file') {
      if (req.method === 'POST') {
        if (authManager.isAuthEnabled() && !authManager.can(authUser, PERMISSIONS.OPEN_FILES)) {
          sendJson(res, 403, { error: '403 Forbidden: Peran Anda tidak memiliki izin membuka berkas pada sistem host.' });
          return;
        }
        try {
          const payload = await parseBody(req);
          const folderOnly = Boolean(payload.folderOnly);
          const folderId = payload.folderId;
          const targetPath = payload.path;

          // --- Action A: Open registered folder by folderId ---
          if (folderId) {
            if (typeof folderId !== 'string') {
              throw new Error('ID folder tidak valid');
            }
            const folder = folderManager.db.getFolderById(folderId);
            if (!folder || !folder.path || !fs.existsSync(folder.path)) {
              sendJson(res, 404, { error: 'Folder terdaftar tidak ditemukan pada disk' });
              return;
            }
            const canonicalFolder = fs.realpathSync(folder.path);

            if (process.platform === 'win32') {
              launcher('explorer.exe', [path.normalize(canonicalFolder)]);
            } else {
              const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
              launcher(cmd, [canonicalFolder]);
            }
            sendJson(res, 200, { success: true, ok: true });
            return;
          }

          // Target path is required for file actions
          if (!targetPath || typeof targetPath !== 'string') {
            throw new Error('Path berkas atau folder tidak valid');
          }

          const resolvedPath = path.resolve(targetPath);
          if (!fs.existsSync(resolvedPath)) {
            throw new Error('Path berkas atau folder tidak ditemukan di komputer');
          }

          let canonicalTarget = resolvedPath;
          try {
            canonicalTarget = fs.realpathSync(resolvedPath);
          } catch (e) {
            canonicalTarget = resolvedPath;
          }

          const normTarget = canonicalTarget.toLowerCase();
          const ext = path.extname(canonicalTarget).toLowerCase();

          // Strictly disallow executable, script, or configuration files under any circumstance
          if (BLOCKED_EXTENSIONS.has(ext)) {
            sendJson(res, 403, { error: 'Akses ditolak: tipe berkas berbahaya tidak diizinkan untuk dibuka' });
            return;
          }

          // --- Action B: Show in folder / Open containing folder (folderOnly: true) ---
          if (folderOnly) {
            // Check if target is directly a registered folder path
            const registeredFolders = folderManager.listFolders();
            const matchedFolder = registeredFolders.find(f => {
              try {
                return fs.existsSync(f.path) && fs.realpathSync(f.path).toLowerCase() === normTarget;
              } catch {
                return false;
              }
            });

            if (matchedFolder) {
              if (process.platform === 'win32') {
                launcher('explorer.exe', [path.normalize(canonicalTarget)]);
              } else {
                const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
                launcher(cmd, [canonicalTarget]);
              }
              sendJson(res, 200, { success: true, ok: true });
              return;
            }

            // Otherwise, target must be a registered indexed document
            const doc = db.getDocumentByPath(canonicalTarget) || db.getDocumentByPath(resolvedPath);
            if (!doc) {
              sendJson(res, 403, { error: 'Akses ditolak: berkas berada di luar folder yang diizinkan atau tidak terdaftar dalam indeks' });
              return;
            }

            // Verify document parent folder & symlink containment
            const parentFolder = folderManager.db.getFolderById(doc.folder_id);
            if (!parentFolder || !fs.existsSync(parentFolder.path)) {
              sendJson(res, 403, { error: 'Akses ditolak: folder induk dokumen tidak ditemukan' });
              return;
            }

            const canonicalParent = fs.realpathSync(parentFolder.path).toLowerCase();
            if (!normTarget.startsWith(canonicalParent + path.sep) && normTarget !== canonicalParent) {
              sendJson(res, 403, { error: 'Akses ditolak: berkas berada di luar batas folder terdaftar (symlink escape terdeteksi)' });
              return;
            }

            if (process.platform === 'win32') {
              launcher('explorer.exe', ['/select,', path.normalize(canonicalTarget)]);
            } else {
              const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
              launcher(cmd, [path.dirname(canonicalTarget)]);
            }
            sendJson(res, 200, { success: true, ok: true });
            return;
          }

          // --- Action C: Open regular document (folderOnly: false) ---
          // 1. Must have an allowed document extension (.md, .pdf, .docx, .xlsx)
          if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
            sendJson(res, 403, { error: 'Akses ditolak: hanya berkas dokumen (.md, .pdf, .docx, .xlsx) yang diizinkan untuk dibuka' });
            return;
          }

          // 2. Must be an active indexed document in the database
          const doc = db.getDocumentByPath(canonicalTarget) || db.getDocumentByPath(resolvedPath);
          if (!doc) {
            sendJson(res, 403, { error: 'Akses ditolak: berkas berada di luar folder yang diizinkan atau tidak terdaftar dalam indeks' });
            return;
          }

          // 3. Document status must be ready
          if (doc.status !== 'ready') {
            sendJson(res, 400, { error: 'Akses ditolak: dokumen belum siap atau gagal diindeks' });
            return;
          }

          // 4. Verify canonical path matches registered document canonical path
          let registeredCanonical = doc.path;
          try {
            if (fs.existsSync(doc.path)) {
              registeredCanonical = fs.realpathSync(doc.path);
            }
          } catch (e) {}

          if (registeredCanonical.toLowerCase() !== canonicalTarget.toLowerCase()) {
            sendJson(res, 403, { error: 'Akses ditolak: path berkas tidak cocok dengan path kanonikal yang terdaftar' });
            return;
          }

          // 5. Verify parent folder and symlink containment
          const parentFolder = folderManager.db.getFolderById(doc.folder_id);
          if (!parentFolder || !fs.existsSync(parentFolder.path)) {
            sendJson(res, 403, { error: 'Akses ditolak: folder induk dokumen tidak ditemukan' });
            return;
          }

          const canonicalParent = fs.realpathSync(parentFolder.path).toLowerCase();
          if (!normTarget.startsWith(canonicalParent + path.sep) && normTarget !== canonicalParent) {
            sendJson(res, 403, { error: 'Akses ditolak: berkas berada di luar batas folder terdaftar (symlink escape terdeteksi)' });
            return;
          }

          // 6. Must not be inside application internal directory (baseDir)
          const appDir = fs.realpathSync(baseDir).toLowerCase();
          if (normTarget.startsWith(appDir + path.sep) || normTarget === appDir) {
            sendJson(res, 403, { error: 'Akses ditolak: berkas internal aplikasi tidak dapat dibuka' });
            return;
          }

          // Launch document safely
          if (process.platform === 'win32') {
            launcher('explorer.exe', [path.normalize(canonicalTarget)]);
          } else {
            const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
            launcher(cmd, [canonicalTarget]);
          }

          sendJson(res, 200, { success: true, ok: true });
          return;
        } catch (err) {
          const status = err.statusCode || 400;
          sendJson(res, status, { error: err.message });
          return;
        }
      }
    }

    // --- Static File Serving (SEC-01: Prevent Path Traversal) ---
    const safeBase = path.resolve(baseDir);
    let requestedPath = pathname === '/' ? '/index.html' : pathname;
    try {
      requestedPath = decodeURIComponent(requestedPath);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('400 Bad Request');
      return;
    }

    const cleanRelative = requestedPath.replace(/^(\/|\\)+/, '');
    const filePath = path.resolve(safeBase, cleanRelative);

    // Containment check: must stay within safeBase
    if (!filePath.startsWith(safeBase + path.sep) && filePath !== safeBase) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden: Akses di luar direktori ditolak');
      return;
    }
    
    fs.stat(filePath, (err, stats) => {
      let finalPath = filePath;
      if (err || !stats.isFile()) {
        finalPath = path.join(safeBase, 'index.html');
      }

      const ext = path.extname(finalPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      fs.readFile(finalPath, (readErr, content) => {
        if (readErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('404 Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content);
        }
      });
    });
  };

  const sslPfxPath = options.sslPfxPath || process.env.SSL_PFX_PATH || '';
  const sslKeyPath = options.sslKeyPath || process.env.SSL_KEY_PATH || '';
  const sslCertPath = options.sslCertPath || process.env.SSL_CERT_PATH || '';
  const sslPassphrase = options.sslPassphrase || process.env.SSL_PASSPHRASE || '';

  let isHttps = false;
  let server;
  if (sslPfxPath) {
    server = https.createServer({
      pfx: fs.readFileSync(sslPfxPath),
      passphrase: sslPassphrase
    }, requestHandler);
    isHttps = true;
  } else if (sslKeyPath && sslCertPath) {
    server = https.createServer({
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath),
      ...(sslPassphrase ? { passphrase: sslPassphrase } : {})
    }, requestHandler);
    isHttps = true;
  } else {
    server = http.createServer(requestHandler);
  }

  // Wrap server.listen to strictly enforce loopback binding unless ALLOW_REMOTE_HOST=true
  const originalListen = server.listen.bind(server);

  function sanitizeListenHost(candidate) {
    if (process.env.ALLOW_REMOTE_HOST === 'true') {
      return resolveLoopbackHost(candidate);
    }
    if (!isLoopbackHost(candidate)) {
      console.warn(`[Security] Host '${candidate}' bukan loopback. Mengabaikan secara aman dan menggunakan fallback loopback '127.0.0.1'.`);
      return '127.0.0.1';
    }
    return resolveLoopbackHost(candidate);
  }

  server.listen = function (...args) {
    // Support options object signature: server.listen(options[, callback])
    if (args[0] && typeof args[0] === 'object') {
      const opts = { ...args[0] };
      opts.host = opts.host ? sanitizeListenHost(opts.host) : HOST;
      return originalListen(opts, args[1]);
    }

    // Positional signature: server.listen(port[, host[, backlog]][, callback])
    const port = args[0] !== undefined ? args[0] : PORT;
    let host = HOST;
    let callback;

    if (typeof args[1] === 'string') {
      host = sanitizeListenHost(args[1]);
      callback = typeof args[2] === 'function' ? args[2] : (typeof args[3] === 'function' ? args[3] : undefined);
    } else if (typeof args[1] === 'function') {
      callback = args[1];
    } else if (typeof args[2] === 'function') {
      callback = args[2];
    }

    return originalListen(port, host, callback);
  };

  const originalClose = server.close.bind(server);
  let closePromise = null;
  let isClosed = false;
  let lastCloseError = null;

  function close(callback) {
    if (isClosed) {
      if (lastCloseError) {
        if (typeof callback === 'function') {
          process.nextTick(() => callback(lastCloseError));
        }
        return Promise.reject(lastCloseError);
      }
      if (typeof callback === 'function') {
        process.nextTick(() => callback(null));
      }
      return Promise.resolve();
    }

    if (closePromise) {
      if (typeof callback === 'function') {
        closePromise.then(
          () => callback(null),
          (err) => callback(err)
        );
      }
      return closePromise;
    }

    closePromise = new Promise((resolve, reject) => {
      // Close any active SSE streams immediately so server.close() never hangs
      for (const clientRes of sseClients.keys()) {
        try {
          clientRes.end();
        } catch {}
      }
      sseClients.clear();

      const closeHttpServer = (done) => {
        if (server.listening) {
          originalClose((err) => {
            if (err) return done(err);
            done(null);
          });
        } else {
          done(null);
        }
      };

      closeHttpServer((serverErr) => {
        const shutdownErrors = [];
        if (serverErr) {
          shutdownErrors.push(serverErr);
        }

        // 2. File-system watchers dihentikan (tetap dijalankan meski serverErr terjadi)
        try {
          if (folderManager && typeof folderManager.stopAllWatchers === 'function') {
            folderManager.stopAllWatchers();
          }
        } catch (watcherErr) {
          shutdownErrors.push(watcherErr);
        }

        // 3. Database ditutup (tetap dijalankan meski watcherErr terjadi)
        try {
          if (db && typeof db.close === 'function') {
            db.close();
          }
        } catch (dbErr) {
          shutdownErrors.push(dbErr);
        }

        isClosed = true;

        if (shutdownErrors.length > 0) {
          const combinedError = shutdownErrors.length === 1
            ? shutdownErrors[0]
            : (typeof AggregateError === 'function'
                ? new AggregateError(shutdownErrors, `Shutdown encountered ${shutdownErrors.length} errors: ${shutdownErrors.map(e => e.message || String(e)).join('; ')}`)
                : Object.assign(new Error(`Shutdown errors: ${shutdownErrors.map(e => e.message || String(e)).join('; ')}`), { errors: shutdownErrors }));

          lastCloseError = combinedError;
          if (typeof callback === 'function') {
            callback(combinedError);
          }
          return reject(combinedError);
        }

        if (typeof callback === 'function') {
          callback(null);
        }
        resolve();
      });
    });

    return closePromise;
  }

  server.close = function (callback) {
    close(callback);
    return server;
  };

  if (options.autoWatch) {
    initWatchers();
  }

  return {
    server,
    db,
    folderManager,
    documentIndexer,
    searchEngine,
    metaEngine,
    authManager,
    initWatchers,
    close,
    get isClosed() { return isClosed; }
  };
}

let defaultApp = null;
function getDefaultApp() {
  if (!defaultApp || defaultApp.isClosed) {
    defaultApp = createServerApp({
      autoWatch: false // Never start background watchers on passive module access
    });
  }
  return defaultApp;
}

if (require.main === module) {
  const app = getDefaultApp();
  app.initWatchers();
  app.server.listen(PORT, HOST, () => {
    const actualPort = app.server.address() ? app.server.address().port : PORT;
    const proto = (process.env.SSL_PFX_PATH || (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH)) ? 'https' : 'http';
    console.log(`WeKeepIt V2 running at: ${proto}://${HOST}:${actualPort}`);
    if (process.send) {
      process.send({ event: 'listening', port: actualPort, host: HOST, protocol: proto, address: app.server.address() });
    }
  });

  const cleanup = () => {
    try {
      app.close();
    } catch (e) {}
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

module.exports = {
  createServerApp,
  PORT,
  HOST,
  isLoopbackHost,
  resolveLoopbackHost,
  validateLoopbackHost,
  get server() {
    return getDefaultApp().server;
  },
  get db() {
    return getDefaultApp().db;
  },
  get folderManager() {
    return getDefaultApp().folderManager;
  },
  get documentIndexer() {
    return getDefaultApp().documentIndexer;
  },
  get searchEngine() {
    return getDefaultApp().searchEngine;
  },
  get authManager() {
    return getDefaultApp().authManager;
  },
  AuthManager,
  ROLES,
  PERMISSIONS,
  initWatchers: () => {
    return getDefaultApp().initWatchers();
  },
  close: (cb) => {
    if (defaultApp) {
      const p = defaultApp.close(cb);
      defaultApp = null;
      return p;
    }
    if (cb) cb();
    return Promise.resolve();
  }
};
