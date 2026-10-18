const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const IndexDB = require('./indexer/db.js');
const { FolderManager } = require('./indexer/folder-manager.js');
const DocumentIndexer = require('./indexer/document-indexer.js');
const SearchEngine = require('./indexer/search-engine.js');
const MetadataEngine = require('./metadata-engine.js');

const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 4321;

// Loopback Host Resolution and Enforcement (Temuan 1 & Phase 6.2)
const ALLOWED_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function isLoopbackHost(host) {
  if (!host || typeof host !== 'string') return false;
  const clean = host.trim().toLowerCase();
  return ALLOWED_LOOPBACK_HOSTS.has(clean);
}

function resolveLoopbackHost(candidate, strict = false) {
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

function isAllowedOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  const clean = origin.trim();
  if (clean === 'null' || clean === '') return false; // Strictly reject null origin (Temuan 2)
  if (ALLOWED_EXACT_ORIGINS.has(clean)) return true;
  return ALLOWED_LOOPBACK_ORIGIN_REGEX.test(clean);
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
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
    if (filePath === DATA_FILE) {
      const samplePath = path.join(__dirname, 'wekeepit-data.sample.json');
      if (fs.existsSync(samplePath)) {
        const sampleData = fs.readFileSync(samplePath, 'utf-8');
        return JSON.parse(sampleData);
      }
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
  }
  return fallback;
}

function writeJsonFile(filePath, data) {
  try {
    const dir = path.dirname(path.resolve(filePath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
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

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        const err = new Error('Ukuran payload melebihi batas maksimum (10MB)');
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
  const dataFile = options.dataFile || process.env.DATA_FILE_PATH || DATA_FILE;
  const schemaFile = options.schemaFile || process.env.SCHEMA_FILE_PATH || SCHEMA_FILE;
  const launcher = options.launchTarget || launchTarget;
  const baseDir = options.baseDir || __dirname;

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

  const server = http.createServer(async (req, res) => {
    // 1. Host Header Validation (Prevent DNS Rebinding attacks)
    const host = req.headers.host || '';
    const isHostValid = !host || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
    if (!isHostValid) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden: Host header tidak diizinkan');
      return;
    }

    // 2. Strict CORS policy (Temuan 2: Reject null Origin, block foreign origins, allowlist desktop/loopback)
    const origin = req.headers.origin;

    if (origin !== undefined) {
      if (isAllowedOrigin(origin)) {
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

    // --- API V1 Endpoints (Preserved 100%) ---
    if (pathname === '/api/cards') {
      if (req.method === 'GET') {
        const cards = readJsonFile(dataFile, []);
        sendJson(res, 200, cards);
        return;
      }

      if (req.method === 'POST') {
        try {
          const cards = await parseBody(req);
          if (Array.isArray(cards)) {
            writeJsonFile(dataFile, cards);
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
        try {
          const schema = await parseBody(req);
          writeJsonFile(schemaFile, schema);
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
  });

  // Wrap server.listen to strictly enforce loopback binding even if non-loopback host is passed directly
  const originalListen = server.listen.bind(server);

  server.listen = function (...args) {
    // Support options object signature: server.listen(options[, callback])
    if (args[0] && typeof args[0] === 'object') {
      const opts = { ...args[0] };
      if (opts.host) {
        if (!isLoopbackHost(opts.host)) {
          console.warn(`[Security] Host '${opts.host}' bukan loopback. Mengabaikan secara aman dan menggunakan fallback loopback '127.0.0.1'.`);
          opts.host = '127.0.0.1';
        } else {
          opts.host = resolveLoopbackHost(opts.host);
        }
      } else {
        opts.host = HOST;
      }
      return originalListen(opts, args[1]);
    }

    // Positional signature: server.listen(port[, host[, backlog]][, callback])
    const port = args[0] !== undefined ? args[0] : PORT;
    let host = HOST;
    let callback;

    if (typeof args[1] === 'string') {
      if (!isLoopbackHost(args[1])) {
        console.warn(`[Security] Host '${args[1]}' bukan loopback. Mengabaikan secara aman dan menggunakan fallback loopback '127.0.0.1'.`);
        host = '127.0.0.1';
      } else {
        host = resolveLoopbackHost(args[1]);
      }
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
    console.log(`WeKeepIt V2 running at: http://${HOST}:${actualPort}`);
    if (process.send) {
      process.send({ event: 'listening', port: actualPort, host: HOST, address: app.server.address() });
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
