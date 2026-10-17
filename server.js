const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const IndexDB = require('./indexer/db.js');
const { FolderManager } = require('./indexer/folder-manager.js');
const DocumentIndexer = require('./indexer/document-indexer.js');
const SearchEngine = require('./indexer/search-engine.js');
const MetadataEngine = require('./metadata-engine.js');

const PORT = process.env.PORT || 4321;
const DATA_FILE = path.join(__dirname, 'wekeepit-data.json');
const SCHEMA_FILE = path.join(__dirname, 'metadata-schema.json');

// Initialize V2 Indexing & Search Engine
const db = new IndexDB();
const folderManager = new FolderManager(db);
const documentIndexer = new DocumentIndexer(db, folderManager);
const searchEngine = new SearchEngine(db);
const metaEngine = new MetadataEngine();

// Setup background watchers for existing active folders
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
initWatchers();

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
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
  }
  return fallback;
}

function writeJsonFile(filePath, data) {
  try {
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

const server = http.createServer(async (req, res) => {
  // 1. Host Header Validation (Prevent DNS Rebinding attacks)
  const host = req.headers.host || '';
  const isHostValid = !host || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  if (!isHostValid) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Host header tidak diizinkan');
    return;
  }

  // 2. Strict CORS policy (SEC-03: Restrict cross-origin access from external websites)
  const origin = req.headers.origin;
  const isAllowedOrigin = !origin || origin === 'null' ||
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin) ||
    /^(vscode-webview|file|tauri|capacitor):\/\//i.test(origin);

  if (isAllowedOrigin) {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  } else {
    // Foreign origins attempting preflight or mutations are blocked
    if (req.method === 'OPTIONS') {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden: Origin cross-origin tidak diizinkan');
      return;
    }
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '403 Forbidden: Origin cross-origin tidak diizinkan' }));
      return;
    }
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
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
      const cards = readJsonFile(DATA_FILE, []);
      sendJson(res, 200, cards);
      return;
    }

    if (req.method === 'POST') {
      try {
        const cards = await parseBody(req);
        if (Array.isArray(cards)) {
          writeJsonFile(DATA_FILE, cards);
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
      const schema = readJsonFile(SCHEMA_FILE, { fields: [], tagPalette: {} });
      sendJson(res, 200, schema);
      return;
    }

    if (req.method === 'POST') {
      try {
        const schema = await parseBody(req);
        writeJsonFile(SCHEMA_FILE, schema);
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
        const cards = readJsonFile(DATA_FILE, []);
        const schema = readJsonFile(SCHEMA_FILE, { fields: [], tagPalette: {} });
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

  // Native Open File or Show in Folder (SEC-02: Enforce security boundary)
  if (pathname === '/api/open-file') {
    if (req.method === 'POST') {
      try {
        const payload = await parseBody(req);
        const targetPath = payload.path;
        const folderOnly = Boolean(payload.folderOnly);

        if (!targetPath || typeof targetPath !== 'string') {
          throw new Error('Path berkas tidak valid');
        }

        const resolvedPath = path.resolve(targetPath);
        if (!fs.existsSync(resolvedPath)) {
          throw new Error('Path berkas tidak ditemukan di komputer');
        }

        // Canonicalize path to resolve symlinks
        let canonicalTarget = resolvedPath;
        try {
          canonicalTarget = fs.realpathSync(resolvedPath);
        } catch (e) {
          canonicalTarget = resolvedPath;
        }

        // Validate boundary: Must be inside a registered indexed folder, an active indexed doc, or app directory
        const folders = folderManager.listFolders();
        const allowedRoots = folders.map(f => {
          try {
            return fs.existsSync(f.path) ? fs.realpathSync(f.path) : path.resolve(f.path);
          } catch {
            return path.resolve(f.path);
          }
        });

        try {
          allowedRoots.push(fs.realpathSync(__dirname));
        } catch {
          allowedRoots.push(path.resolve(__dirname));
        }

        const normTarget = canonicalTarget.toLowerCase();
        const isInsideAllowedRoot = allowedRoots.some(root => {
          const normRoot = root.toLowerCase();
          return normTarget === normRoot || normTarget.startsWith(normRoot + path.sep);
        });

        const isIndexedDoc = !isInsideAllowedRoot && Boolean(
          db.getDocumentByPath(canonicalTarget) || db.getDocumentByPath(resolvedPath)
        );

        if (!isInsideAllowedRoot && !isIndexedDoc) {
          sendJson(res, 403, { error: 'Akses ditolak: berkas berada di luar folder yang diizinkan' });
          return;
        }

        if (process.platform === 'win32') {
          if (folderOnly) {
            spawn('explorer.exe', ['/select,', path.normalize(canonicalTarget)], { detached: true, stdio: 'ignore' });
          } else {
            spawn('explorer.exe', [path.normalize(canonicalTarget)], { detached: true, stdio: 'ignore' });
          }
        } else {
          // Fallback macOS / Linux
          const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
          spawn(cmd, [canonicalTarget], { detached: true, stdio: 'ignore' });
        }

        sendJson(res, 200, { success: true });
        return;
      } catch (err) {
        const status = err.statusCode || 400;
        sendJson(res, status, { error: err.message });
        return;
      }
    }
  }

  // --- Static File Serving (SEC-01: Prevent Path Traversal) ---
  const safeBase = path.resolve(__dirname);
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

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`WeKeepIt V2 running at: http://localhost:${PORT}`);
  });
}

module.exports = { server, PORT, db, folderManager, documentIndexer, searchEngine };
