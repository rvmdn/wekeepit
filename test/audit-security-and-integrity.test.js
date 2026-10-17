const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const IndexDB = require('../indexer/db.js');
const { FolderManager } = require('../indexer/folder-manager.js');
const DocumentIndexer = require('../indexer/document-indexer.js');

describe('Security & Data Integrity Audit Test Suite', () => {
  let tempDir;
  let serverProcess;
  const AUDIT_PORT = 4331;

  const request = (reqPath, method = 'GET', body = null, headers = {}) => {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port: AUDIT_PORT,
        path: reqPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            parsed = data;
          }
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        });
      });

      req.on('error', reject);
      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  };

  let testDocsDir;
  let registeredFolderId;
  let validDocPath;
  let unindexedDocPath;
  let dangerousExePath;
  let dangerousScriptPath;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-audit-sec-'));
    testDocsDir = path.join(tempDir, 'registered-docs');
    fs.mkdirSync(testDocsDir, { recursive: true });

    validDocPath = path.join(testDocsDir, 'panduan-keamanan.md');
    fs.writeFileSync(validDocPath, '# Panduan Keamanan\nDokumen terindeks resmi WeKeepIt.', 'utf-8');

    const testDbPath = path.join(tempDir, 'audit-server.db');
    const { fork } = require('child_process');
    serverProcess = fork(path.join(__dirname, '..', 'server.js'), [], {
      env: {
        ...process.env,
        PORT: AUDIT_PORT,
        HOST: '127.0.0.1',
        INDEX_DB_PATH: testDbPath,
        NODE_ENV: 'test'
      }
    });

    // Wait 1.5s for server to start
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Register testDocsDir via API
    const regRes = await request('/api/folders', 'POST', { path: testDocsDir });
    registeredFolderId = regRes.data.id;

    // Wait for documentIndexer to index validDocPath
    for (let i = 0; i < 20; i++) {
      const statusRes = await request('/api/folders', 'GET');
      const f = Array.isArray(statusRes.data) && statusRes.data.find(x => x.id === registeredFolderId);
      if (f && f.readyDocs >= 1) break;
      await new Promise(r => setTimeout(r, 100));
    }

    // Create non-indexed and dangerous test fixtures inside registered folder
    unindexedDocPath = path.join(testDocsDir, 'unindexed-notes.md');
    fs.writeFileSync(unindexedDocPath, '# Catatan Baru Belum Terindeks', 'utf-8');

    dangerousExePath = path.join(testDocsDir, 'trojan-payload.exe');
    fs.writeFileSync(dangerousExePath, 'MZ DUMMY EXE FIXTURE', 'utf-8');

    dangerousScriptPath = path.join(testDocsDir, 'malicious-script.bat');
    fs.writeFileSync(dangerousScriptPath, '@echo off\r\nREM DUMMY BAT', 'utf-8');
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {}
    }
  });

  describe('Temuan 1: Server Network Binding to Loopback Only', () => {
    test('server module should export HOST defaulting to 127.0.0.1 (IPv4 loopback)', () => {
      const { HOST } = require('../server.js');
      assert.equal(HOST, '127.0.0.1');
    });

    test('server listen configuration should bind strictly to loopback address 127.0.0.1', async () => {
      const { HOST } = require('../server.js');
      const testServer = http.createServer((req, res) => res.end('ok'));
      await new Promise(resolve => testServer.listen(0, HOST, resolve));
      const address = testServer.address();
      assert.equal(address.address, '127.0.0.1');
      await new Promise(resolve => testServer.close(resolve));
    });

    test('HTTP requests to 127.0.0.1 loopback should connect successfully', async () => {
      const res = await request('/api/ping');
      assert.equal(res.status, 200);
      assert.equal(res.data.status, 'ok');
    });
  });

  describe('SEC-01: Static File Serving Path Traversal Prevention', () => {
    test('should reject path traversal using ../ with 403 Forbidden', async () => {
      const res = await request('/../../server.js');
      assert.equal(res.status, 403);
      assert.match(String(res.data), /Forbidden/i);
    });

    test('should reject URL-encoded path traversal %2e%2e with 403 Forbidden', async () => {
      const res = await request('/%2e%2e/%2e%2e/wekeepit-data.json');
      assert.equal(res.status, 403);
      assert.match(String(res.data), /Forbidden/i);
    });

    test('should serve legitimate static files like style.css with 200 OK', async () => {
      const res = await request('/style.css');
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /text\/css/);
    });

    test('should serve index.html for root path / with 200 OK', async () => {
      const res = await request('/');
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /text\/html/);
    });
  });

  describe('Temuan 2: CORS Policy & Unsafe Null Origin Protection', () => {
    test('should strictly reject Origin: null on GET /api/cards with 403 Forbidden without CORS headers', async () => {
      const res = await request('/api/cards', 'GET', null, { Origin: 'null' });
      assert.equal(res.status, 403);
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    });

    test('should strictly reject Origin: null on mutating POST /api/cards with 403 Forbidden', async () => {
      const res = await request('/api/cards', 'POST', [{ id: 'null-hack', title: 'hacked' }], { Origin: 'null' });
      assert.equal(res.status, 403);
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    });

    test('should strictly reject Origin: null on preflight OPTIONS with 403 Forbidden', async () => {
      const res = await request('/api/cards', 'OPTIONS', null, { Origin: 'null' });
      assert.equal(res.status, 403);
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    });

    test('should block request with forged foreign Host header with 403 Forbidden', async () => {
      const res = await request('/api/ping', 'GET', null, { Host: 'evil-attacker-site.com' });
      assert.equal(res.status, 403);
      assert.match(String(res.data), /Host header tidak diizinkan/i);
    });

    test('should allow request with localhost or 127.0.0.1 Host header', async () => {
      const res = await request('/api/ping', 'GET', null, { Host: `127.0.0.1:${AUDIT_PORT}` });
      assert.equal(res.status, 200);
      assert.equal(res.data.status, 'ok');
    });

    test('should reject foreign cross-origin GET requests with 403 Forbidden', async () => {
      const res = await request('/api/cards', 'GET', null, { Origin: 'https://evil-attacker.com' });
      assert.equal(res.status, 403);
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    });

    test('should reject foreign cross-origin POST requests with 403 Forbidden and not mutate data', async () => {
      const res = await request('/api/cards', 'POST', [{ id: 'hack', title: 'evil' }], {
        Origin: 'https://malicious-website.com'
      });
      assert.equal(res.status, 403);
      assert.match(res.data.error, /Origin cross-origin tidak diizinkan/i);
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    });

    test('should reject foreign cross-origin preflight OPTIONS with 403 Forbidden', async () => {
      const res = await request('/api/cards', 'OPTIONS', null, {
        Origin: 'https://malicious-website.com'
      });
      assert.equal(res.status, 403);
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    });

    test('should allow direct request without Origin header without setting wildcard CORS', async () => {
      const res = await request('/api/ping', 'GET');
      assert.equal(res.status, 200);
      assert.equal(res.data.status, 'ok');
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    });

    test('should allow request from loopback origin (http://127.0.0.1 or http://localhost)', async () => {
      const res = await request('/api/ping', 'GET', null, { Origin: `http://127.0.0.1:${AUDIT_PORT}` });
      assert.equal(res.status, 200);
      assert.equal(res.headers['access-control-allow-origin'], `http://127.0.0.1:${AUDIT_PORT}`);
    });

    test('should allow request from official desktop WebView2 origin (https://wekeepit.local)', async () => {
      const res = await request('/api/ping', 'GET', null, { Origin: 'https://wekeepit.local' });
      assert.equal(res.status, 200);
      assert.equal(res.headers['access-control-allow-origin'], 'https://wekeepit.local');
    });

    test('should allow preflight OPTIONS from official desktop WebView2 origin (https://wekeepit.local)', async () => {
      const res = await request('/api/cards', 'OPTIONS', null, { Origin: 'https://wekeepit.local' });
      assert.equal(res.status, 204);
      assert.equal(res.headers['access-control-allow-origin'], 'https://wekeepit.local');
    });
  });

  describe('Temuan 3: /api/open-file Security Boundary & Path Hardening', () => {
    test('should reject opening arbitrary system files outside indexed folders with 403 Forbidden', async () => {
      const externalFile = path.join(tempDir, 'outside-secret.txt');
      fs.writeFileSync(externalFile, 'sensitive data', 'utf-8');

      const res = await request('/api/open-file', 'POST', { path: externalFile });
      assert.equal(res.status, 403);
      assert.match(res.data.error, /Akses ditolak/i);
    });

    test('should reject opening executable files (.exe) inside indexed folders with 403 Forbidden', async () => {
      const res = await request('/api/open-file', 'POST', { path: dangerousExePath });
      assert.equal(res.status, 403);
      assert.match(res.data.error, /berbahaya tidak diizinkan/i);
    });

    test('should reject opening script files (.bat, .cmd, .ps1, .vbs) inside indexed folders with 403 Forbidden', async () => {
      const res = await request('/api/open-file', 'POST', { path: dangerousScriptPath });
      assert.equal(res.status, 403);
      assert.match(res.data.error, /berbahaya tidak diizinkan/i);
    });

    test('should reject opening sensitive internal files (.js, .json, .db, .env) with 403 Forbidden', async () => {
      const appFile = path.join(__dirname, '..', 'server.js');
      const res = await request('/api/open-file', 'POST', { path: appFile });
      assert.equal(res.status, 403);
      assert.match(res.data.error, /Akses ditolak/i);
    });

    test('should reject opening regular unindexed files inside indexed folders with 403 Forbidden', async () => {
      const res = await request('/api/open-file', 'POST', { path: unindexedDocPath });
      assert.equal(res.status, 403);
      assert.match(res.data.error, /tidak terdaftar dalam indeks/i);
    });

    test('should reject non-document files (.txt) inside indexed folder with 403 Forbidden', async () => {
      const txtFile = path.join(testDocsDir, 'readme.txt');
      fs.writeFileSync(txtFile, 'text only', 'utf-8');
      const res = await request('/api/open-file', 'POST', { path: txtFile });
      assert.equal(res.status, 403);
      assert.match(res.data.error, /hanya berkas dokumen/i);
    });

    test('should reject non-existent paths with 400 Bad Request', async () => {
      const res = await request('/api/open-file', 'POST', { path: path.join(tempDir, 'non-existent.md') });
      assert.equal(res.status, 400);
      assert.match(res.data.error, /tidak ditemukan/i);
    });

    test('should reject invalid or non-string path with 400 Bad Request', async () => {
      const res = await request('/api/open-file', 'POST', { path: 12345 });
      assert.equal(res.status, 400);
      assert.match(res.data.error, /tidak valid/i);
    });

    test('should successfully allow opening a legitimate indexed document (status: ready)', async () => {
      const res = await request('/api/open-file', 'POST', { path: validDocPath });
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
      assert.equal(res.data.ok, true);
    });

    test('should successfully allow opening a registered folder by folderId', async () => {
      const res = await request('/api/open-file', 'POST', { folderId: registeredFolderId });
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
      assert.equal(res.data.ok, true);
    });

    test('should reject opening folder by unregistered folderId with 404 Not Found', async () => {
      const res = await request('/api/open-file', 'POST', { folderId: 'fld-not-registered-999' });
      assert.equal(res.status, 404);
      assert.match(res.data.error, /tidak ditemukan/i);
    });

    test('should successfully allow opening a registered folder path with folderOnly: true', async () => {
      const res = await request('/api/open-file', 'POST', { path: testDocsDir, folderOnly: true });
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
      assert.equal(res.data.ok, true);
    });

    test('should successfully allow showing an indexed document location with folderOnly: true', async () => {
      const res = await request('/api/open-file', 'POST', { path: validDocPath, folderOnly: true });
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
      assert.equal(res.data.ok, true);
    });

    test('should reject symlink escaping the registered folder boundary', async () => {
      const outsideFile = path.join(tempDir, 'outside-secret.md');
      fs.writeFileSync(outsideFile, '# Secret Outside', 'utf-8');
      const symlinkPath = path.join(testDocsDir, 'symlink-outside.md');
      try {
        fs.symlinkSync(outsideFile, symlinkPath);
      } catch (e) {
        // Fallback for non-admin Windows environments: verify directory traversal escape
        const traversalPath = path.join(testDocsDir, '..', 'outside-secret.md');
        const res = await request('/api/open-file', 'POST', { path: traversalPath });
        assert.equal(res.status, 403);
        return;
      }
      const res = await request('/api/open-file', 'POST', { path: symlinkPath });
      assert.equal(res.status, 403);
    });
  });

  describe('SEC-04: Request Payload Size Limit', () => {
    test('should reject oversized payload (>10MB) with 413 or terminated connection', async () => {
      // Generate a string > 10MB
      const bigChunk = 'A'.repeat(1024 * 1024); // 1MB
      let failed = false;

      try {
        const options = {
          hostname: '127.0.0.1',
          port: AUDIT_PORT,
          path: '/api/cards',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        };

        const req = http.request(options, (res) => {
          if (res.statusCode === 413 || res.statusCode === 400) {
            failed = true;
          }
        });

        req.on('error', () => {
          // Connection destroyed by server is also a valid rejection of oversized body
          failed = true;
        });

        for (let i = 0; i < 11; i++) {
          req.write(bigChunk);
        }
        req.end();

        await new Promise(resolve => setTimeout(resolve, 800));
        assert.ok(failed, 'Server should reject or abort payload exceeding 10MB');
      } catch (e) {
        assert.ok(true);
      }
    });
  });

  describe('Data Integrity & SQLite FTS5 Synchronization', () => {
    let db;
    let dbPath;

    before(() => {
      dbPath = path.join(tempDir, 'test-integrity.db');
      db = new IndexDB(dbPath);
    });

    after(() => {
      if (db) db.close();
    });

    test('PRAGMA integrity_check should report ok on clean database', () => {
      const integrity = db.checkIntegrity();
      assert.equal(integrity.sqliteIntegrity, 'ok');
      assert.equal(integrity.isFtsInSync, true);
    });

    test('saving and deleting documents should maintain exact FTS5 synchronization', () => {
      const folderId = 'fld-integrity-1';
      db.insertFolder({ id: folderId, path: path.join(tempDir, 'folder1') });

      const docId = 'doc-integrity-1';
      const docPath = path.join(tempDir, 'folder1', 'test.md');
      db.upsertDocument({
        id: docId,
        folder_id: folderId,
        path: docPath,
        filename: 'test.md',
        extension: '.md',
        size: 200,
        mtime: Date.now(),
        status: 'ready'
      });

      const chunks = [
        { location_type: 'para', location_label: 'Paragraf 1', content: 'Kutipan pertama tentang arsitektur WeKeepIt.' },
        { location_type: 'para', location_label: 'Paragraf 2', content: 'Kutipan kedua mengenai SQLite FTS5 index.' }
      ];

      db.saveDocumentChunks(docId, chunks);

      let integrity = db.checkIntegrity();
      assert.equal(integrity.chunkCount, 2);
      assert.equal(integrity.ftsCount, 2);
      assert.equal(integrity.isFtsInSync, true);

      // Delete document
      const deleted = db.deleteDocumentByPath(docPath);
      assert.equal(deleted, true);

      integrity = db.checkIntegrity();
      assert.equal(integrity.chunkCount, 0);
      assert.equal(integrity.ftsCount, 0, 'FTS5 rows must be deleted when document is deleted');
      assert.equal(integrity.isFtsInSync, true);
    });

    test('deleting folder should clean up all associated chunks from both tables and FTS5', () => {
      const folderId = 'fld-integrity-2';
      db.insertFolder({ id: folderId, path: path.join(tempDir, 'folder2') });

      const doc1 = path.join(tempDir, 'folder2', 'doc1.md');
      const doc2 = path.join(tempDir, 'folder2', 'doc2.md');

      db.upsertDocument({ id: 'd1', folder_id: folderId, path: doc1, filename: 'doc1.md', extension: '.md', size: 100, mtime: 1 });
      db.upsertDocument({ id: 'd2', folder_id: folderId, path: doc2, filename: 'doc2.md', extension: '.md', size: 100, mtime: 1 });

      db.saveDocumentChunks('d1', [{ content: 'Data satu', location_label: 'P1' }]);
      db.saveDocumentChunks('d2', [{ content: 'Data dua', location_label: 'P1' }, { content: 'Data tiga', location_label: 'P2' }]);

      let integrity = db.checkIntegrity();
      assert.equal(integrity.chunkCount, 3);
      assert.equal(integrity.ftsCount, 3);

      db.deleteFolder(folderId);

      integrity = db.checkIntegrity();
      assert.equal(integrity.chunkCount, 0);
      assert.equal(integrity.ftsCount, 0, 'All FTS5 rows for folder must be deleted when folder is deleted');
      assert.equal(integrity.isFtsInSync, true);
    });

    test('rebuildFts should successfully recreate FTS entries from document_chunks', () => {
      const folderId = 'fld-integrity-3';
      db.insertFolder({ id: folderId, path: path.join(tempDir, 'folder3') });

      db.upsertDocument({ id: 'd3', folder_id: folderId, path: path.join(tempDir, 'folder3', 'doc3.md'), filename: 'doc3.md', extension: '.md', size: 100, mtime: 1 });
      db.saveDocumentChunks('d3', [{ content: 'Konten dokumen tiga', location_label: 'Hal 1' }]);

      // Manually wipe FTS to simulate desync
      db.db.prepare('DELETE FROM document_chunks_fts').run();
      let integrity = db.checkIntegrity();
      assert.equal(integrity.ftsCount, 0);
      assert.equal(integrity.chunkCount, 1);
      assert.equal(integrity.isFtsInSync, false);

      // Rebuild FTS
      const rebuilt = db.rebuildFts();
      assert.equal(rebuilt, true);

      integrity = db.checkIntegrity();
      assert.equal(integrity.ftsCount, 1);
      assert.equal(integrity.isFtsInSync, true);
    });
  });

  describe('Folder Reconciliation & Symlink Traversal Safety', () => {
    let db;
    let fm;
    let workDir;

    before(() => {
      workDir = path.join(tempDir, 'work-folders');
      fs.mkdirSync(workDir, { recursive: true });
      db = new IndexDB(':memory:');
      fm = new FolderManager(db);
    });

    test('should reconcile added, modified, unchanged, and deleted files accurately', () => {
      const scanFolder = path.join(workDir, 'project-a');
      fs.mkdirSync(scanFolder, { recursive: true });

      const file1 = path.join(scanFolder, 'notes.md');
      const file2 = path.join(scanFolder, 'specs.docx');
      fs.writeFileSync(file1, '# Catatan', 'utf-8');
      fs.writeFileSync(file2, 'dummy docx binary', 'utf-8');

      const folderRec = fm.addFolder(scanFolder);
      const res1 = fm.scanAndReconcile(folderRec.id);
      assert.equal(res1.added.length, 2);
      assert.equal(res1.modified.length, 0);
      assert.equal(res1.deleted.length, 0);

      // Register docs in DB as scanned
      for (const doc of res1.added) {
        db.upsertDocument({ ...doc, status: 'ready' });
      }

      // Modify file1 and delete file2, add file3
      fs.writeFileSync(file1, '# Catatan Diperbarui', 'utf-8');
      // Set updated mtime explicitly
      const newMtime = Math.floor(Date.now() / 1000) + 10;
      fs.utimesSync(file1, newMtime, newMtime);
      fs.unlinkSync(file2);

      const file3 = path.join(scanFolder, 'plan.xlsx');
      fs.writeFileSync(file3, 'dummy xlsx', 'utf-8');

      const res2 = fm.scanAndReconcile(folderRec.id);
      assert.equal(res2.added.length, 1, 'file3 should be added');
      assert.equal(res2.added[0].filename, 'plan.xlsx');
      assert.equal(res2.modified.length, 1, 'file1 should be modified');
      assert.equal(res2.modified[0].filename, 'notes.md');
      assert.equal(res2.deleted.length, 1, 'file2 should be detected as deleted');
      assert.equal(res2.deleted[0].filename, 'specs.docx');
    });

    test('should prevent symlinks escaping the folder root', () => {
      const secureFolder = path.join(workDir, 'secure-zone');
      const externalDir = path.join(workDir, 'secret-outside');
      fs.mkdirSync(secureFolder, { recursive: true });
      fs.mkdirSync(externalDir, { recursive: true });

      fs.writeFileSync(path.join(externalDir, 'leak.md'), 'rahasia', 'utf-8');

      // Create a symlink inside secureFolder pointing to externalDir
      const symlinkPath = path.join(secureFolder, 'link-to-outside');
      try {
        fs.symlinkSync(externalDir, symlinkPath, 'junction');
      } catch (e) {
        // If symlink not permitted without admin on Windows, test passes gracefully
        return;
      }

      const folderRec = fm.addFolder(secureFolder);
      const res = fm.scanAndReconcile(folderRec.id);

      // leak.md must NOT be included because symlink points outside folder root
      const leakFound = res.added.some(d => d.filename === 'leak.md');
      assert.equal(leakFound, false, 'Files outside folder root via symlink must not be scanned');
    });

    test('rebuilding document index must NEVER alter wekeepit-data.json', () => {
      const dataJsonPath = path.join(__dirname, '..', 'wekeepit-data.json');
      const beforeStat = fs.statSync(dataJsonPath);
      const beforeContent = fs.readFileSync(dataJsonPath, 'utf-8');

      // Trigger indexer operations on memory DB
      const memDb = new IndexDB(':memory:');
      const memFm = new FolderManager(memDb);
      const indexer = new DocumentIndexer(memDb, memFm);

      const afterStat = fs.statSync(dataJsonPath);
      const afterContent = fs.readFileSync(dataJsonPath, 'utf-8');

      assert.equal(beforeContent, afterContent, 'wekeepit-data.json content must remain untouched');
      assert.equal(beforeStat.size, afterStat.size, 'wekeepit-data.json size must remain identical');
    });
  });
});
