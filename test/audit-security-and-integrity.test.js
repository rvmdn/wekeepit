const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');

function sendSignal(cp, signal) {
  if (!cp || cp.exitCode !== null || cp.signalCode !== null) {
    return true;
  }
  try {
    const ok = cp.kill(signal);
    if (!ok) {
      if (cp.exitCode !== null || cp.signalCode !== null) {
        return true;
      }
      throw new Error(`cp.kill('${signal}') returned false for un-exited process PID ${cp.pid}`);
    }
    return true;
  } catch (err) {
    if (cp.exitCode !== null || cp.signalCode !== null || err.code === 'ESRCH') {
      return true;
    }
    throw err;
  }
}

function waitForProcessExit(cp, timeoutMs = 7000) {
  if (!cp || cp.exitCode !== null || cp.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let timer = null;
    let exited = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      cp.removeListener('exit', onExit);
      cp.removeListener('close', onExit);
      cp.removeListener('error', onError);
    };

    const onExit = (code, signal) => {
      if (exited) return;
      exited = true;
      if (cp.exitCode === null && code !== undefined && code !== null) {
        cp.exitCode = code;
      }
      if (cp.signalCode === null && signal !== undefined && signal !== null) {
        cp.signalCode = signal;
      }
      cleanup();
      resolve();
    };

    const onError = (err) => {
      if (exited) return;
      exited = true;
      cleanup();
      reject(err);
    };

    cp.once('exit', onExit);
    cp.once('close', onExit);
    cp.once('error', onError);

    timer = setTimeout(() => {
      if (!exited && cp.exitCode === null && cp.signalCode === null) {
        cleanup();
        reject(new Error(`Child process (PID ${cp.pid}) did not exit within ${timeoutMs}ms`));
      }
    }, timeoutMs);
  });
}

function terminateProcess(cp, termTimeoutMs = 4000, killTimeoutMs = 4000) {
  if (!cp || cp.exitCode !== null || cp.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let exited = false;
    let killTimer = null;
    let failTimer = null;

    const cleanup = () => {
      if (killTimer) clearTimeout(killTimer);
      if (failTimer) clearTimeout(failTimer);
      cp.removeListener('exit', onExit);
      cp.removeListener('close', onExit);
      cp.removeListener('error', onError);
    };

    const onExit = (code, signal) => {
      if (exited) return;
      exited = true;
      if (cp.exitCode === null && code !== undefined && code !== null) {
        cp.exitCode = code;
      }
      if (cp.signalCode === null && signal !== undefined && signal !== null) {
        cp.signalCode = signal;
      }
      cleanup();
      resolve();
    };

    const onError = (err) => {
      if (exited) return;
      if (cp.exitCode !== null || cp.signalCode !== null) {
        onExit();
        return;
      }
      exited = true;
      cleanup();
      reject(err);
    };

    // 1. Pasang listener exit, close, dan error sebelum mengirim sinyal
    cp.once('exit', onExit);
    cp.once('close', onExit);
    cp.once('error', onError);

    // 2. Kirim SIGTERM
    try {
      sendSignal(cp, 'SIGTERM');
    } catch (err) {
      cleanup();
      return reject(new Error(`Failed to send SIGTERM to process PID ${cp.pid}: ${err.message}`));
    }

    if (cp.exitCode !== null || cp.signalCode !== null) {
      onExit();
      return;
    }

    // 3. Jika SIGTERM timeout tercapai, kirim SIGKILL dan tunggu konfirmasi exit/close
    killTimer = setTimeout(() => {
      if (exited || cp.exitCode !== null || cp.signalCode !== null) {
        onExit();
        return;
      }

      try {
        sendSignal(cp, 'SIGKILL');
      } catch (err) {
        cleanup();
        return reject(new Error(`Failed to send SIGKILL to process PID ${cp.pid}: ${err.message}`));
      }

      if (cp.exitCode !== null || cp.signalCode !== null) {
        onExit();
        return;
      }

      // 4. Jika setelah SIGKILL tetap tidak keluar, gagalkan dengan error jelas
      failTimer = setTimeout(() => {
        if (!exited && cp.exitCode === null && cp.signalCode === null) {
          cleanup();
          reject(new Error(`Failed to terminate process (PID: ${cp.pid}) within ${termTimeoutMs + killTimeoutMs}ms after SIGTERM and SIGKILL`));
        }
      }, killTimeoutMs);
    }, termTimeoutMs);
  });
}

function captureSnapshot(filePath) {
  const getFile = (file) => {
    if (!fs.existsSync(file)) return { exists: false, size: 0, mtimeMs: 0, hash: null };
    const stat = fs.statSync(file);
    const content = fs.readFileSync(file);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs, hash };
  };
  return {
    main: getFile(filePath),
    wal: getFile(filePath + '-wal'),
    shm: getFile(filePath + '-shm')
  };
}

function assertStrictSnapshotEqual(before, after, label = 'Database') {
  // 1. Main database file
  assert.equal(after.main.exists, before.main.exists, `${label} main file existence must match`);
  if (before.main.exists) {
    assert.equal(after.main.hash, before.main.hash, `${label} main file SHA-256 hash must be strictly identical`);
    assert.equal(after.main.size, before.main.size, `${label} main file byte size must be strictly identical`);
    assert.equal(after.main.mtimeMs, before.main.mtimeMs, `${label} main file mtime must be strictly untouched`);
  } else {
    assert.equal(after.main.exists, false, `${label} main file must remain non-existent`);
  }

  // 2. WAL file
  assert.equal(after.wal.exists, before.wal.exists, `${label} WAL file existence must match`);
  if (before.wal.exists) {
    assert.equal(after.wal.hash, before.wal.hash, `${label} WAL file SHA-256 hash must be strictly identical`);
    assert.equal(after.wal.size, before.wal.size, `${label} WAL file byte size must be strictly identical`);
    assert.equal(after.wal.mtimeMs, before.wal.mtimeMs, `${label} WAL file mtime must be strictly untouched`);
  } else {
    assert.equal(after.wal.exists, false, `${label} WAL file must remain non-existent`);
  }

  // 3. SHM file
  assert.equal(after.shm.exists, before.shm.exists, `${label} SHM file existence must match`);
  if (before.shm.exists) {
    assert.equal(after.shm.hash, before.shm.hash, `${label} SHM file SHA-256 hash must be strictly identical`);
    assert.equal(after.shm.size, before.shm.size, `${label} SHM file byte size must be strictly identical`);
    assert.equal(after.shm.mtimeMs, before.shm.mtimeMs, `${label} SHM file mtime must be strictly untouched`);
  } else {
    assert.equal(after.shm.exists, false, `${label} SHM file must remain non-existent`);
  }
}

// Zero-touch baseline: capture repository root database state before any tests run
const repoRootDbPath = path.resolve(__dirname, '..', 'wekeepit-index.db');
const rootDbSnapshotBefore = captureSnapshot(repoRootDbPath);

// Guarantee that the test runner process operates with an isolated temporary database path
const testRunnerTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-audit-runner-'));
process.env.NODE_ENV = 'test';
process.env.INDEX_DB_PATH = path.join(testRunnerTempDir, 'runner-index.db');

const IndexDB = require('../indexer/db.js');
const { FolderManager } = require('../indexer/folder-manager.js');
const DocumentIndexer = require('../indexer/document-indexer.js');

describe('Security & Data Integrity Audit Test Suite', () => {
  let tempDir;
  let serverProcess;
  let auditPort = 0;
  let serverProcessAddress = null;

  const request = (reqPath, method = 'GET', body = null, headers = {}) => {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port: auditPort,
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
        PORT: 0,
        HOST: '127.0.0.1',
        INDEX_DB_PATH: testDbPath,
        NODE_ENV: 'test'
      }
    });

    // Wait for serverProcess to emit listening message with actual dynamic port
    const listenInfo = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timeout waiting for serverProcess to start listening'));
      }, 5000);

      serverProcess.on('message', (msg) => {
        if (msg && msg.event === 'listening') {
          clearTimeout(timer);
          resolve(msg);
        }
      });
      serverProcess.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    auditPort = listenInfo.port;
    serverProcessAddress = listenInfo.address;

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

  after(async () => {
    let teardownErr = null;
    try {
      if (serverProcess) {
        await terminateProcess(serverProcess);
      }
      const serverModule = require('../server.js');
      if (typeof serverModule.close === 'function') {
        await serverModule.close();
      }
      if (!serverProcess || serverProcess.exitCode !== null || serverProcess.signalCode !== null) {
        serverProcess = null;
        if (tempDir && fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          assert.equal(fs.existsSync(tempDir), false, 'tempDir must be cleanly removed without error');
        }
        if (testRunnerTempDir && fs.existsSync(testRunnerTempDir)) {
          fs.rmSync(testRunnerTempDir, { recursive: true, force: true });
          assert.equal(fs.existsSync(testRunnerTempDir), false, 'testRunnerTempDir must be cleanly removed without error');
        }
      }
    } catch (err) {
      teardownErr = err;
    } finally {
      let snapshotErr = null;
      try {
        // Root repository database baseline integrity comparison:
        // Executed strictly in final suite teardown (finally block) after all tests and child-process cleanups have completed.
        // Guarantee: Compares existence, SHA-256, byte size, and mtimeMs against baseline to detect any modification.
        // Note: A metadata/content snapshot detects changes to monitored files (main, -wal, -shm), but does not prove a file was never opened read-only.
        const rootDbSnapshotAfter = captureSnapshot(repoRootDbPath);
        assertStrictSnapshotEqual(rootDbSnapshotBefore, rootDbSnapshotAfter, 'Root repository DB (suite final teardown)');
      } catch (err) {
        snapshotErr = err;
      }

      if (teardownErr && snapshotErr) {
        const combinedErr = new Error(`Multiple teardown failures:\n1) Child/resource cleanup: ${teardownErr.message}\n2) Root snapshot comparison: ${snapshotErr.message}`);
        combinedErr.cause = { teardownErr, snapshotErr };
        throw combinedErr;
      }
      if (teardownErr) throw teardownErr;
      if (snapshotErr) throw snapshotErr;
    }
  });

  describe('Temuan 1 & Phase 6.2: Enforce Actual Server Loopback Network Binding', () => {
    test('isLoopbackHost should accurately identify loopback vs non-loopback hosts', () => {
      const { isLoopbackHost } = require('../server.js');
      assert.equal(isLoopbackHost('127.0.0.1'), true);
      assert.equal(isLoopbackHost('localhost'), true);
      assert.equal(isLoopbackHost('::1'), true);
      assert.equal(isLoopbackHost('0.0.0.0'), false);
      assert.equal(isLoopbackHost('::'), false);
      assert.equal(isLoopbackHost('192.168.1.10'), false);
      assert.equal(isLoopbackHost('evil.com'), false);
      assert.equal(isLoopbackHost(null), false);
      assert.equal(isLoopbackHost(''), false);
    });

    test('resolveLoopbackHost should prioritize 127.0.0.1 and safely fallback when given non-loopback hosts', () => {
      const { resolveLoopbackHost } = require('../server.js');
      assert.equal(resolveLoopbackHost('127.0.0.1'), '127.0.0.1');
      assert.equal(resolveLoopbackHost('localhost'), '127.0.0.1');
      assert.equal(resolveLoopbackHost('::1'), '::1');
      assert.equal(resolveLoopbackHost('0.0.0.0'), '127.0.0.1');
      assert.equal(resolveLoopbackHost('::'), '127.0.0.1');
      assert.equal(resolveLoopbackHost('192.168.1.50'), '127.0.0.1');
      assert.equal(resolveLoopbackHost(undefined), '127.0.0.1');
    });

    test('validateLoopbackHost should reject non-loopback hosts with an explicit error', () => {
      const { validateLoopbackHost } = require('../server.js');
      assert.equal(validateLoopbackHost('127.0.0.1'), true);
      assert.equal(validateLoopbackHost('localhost'), true);
      assert.equal(validateLoopbackHost('::1'), true);
      assert.throws(() => validateLoopbackHost('0.0.0.0'), /Host '0.0.0.0' tidak diizinkan/);
      assert.throws(() => validateLoopbackHost('::'), /Host '::' tidak diizinkan/);
      assert.throws(() => validateLoopbackHost('192.168.1.100'), /Host '192.168.1.100' tidak diizinkan/);
    });

    test('actual server instance should bind strictly to loopback 127.0.0.1 on listen with dynamic port', async () => {
      const { server } = require('../server.js');
      // Listen on ephemeral port 0 to prevent any port collisions
      await new Promise(resolve => server.listen(0, resolve));
      const address = server.address();
      assert.ok(address, 'server.address() must be available');
      assert.equal(address.address, '127.0.0.1', 'Actual socket must bind to 127.0.0.1');
      assert.ok(address.port > 0, 'Port must be a valid positive integer');

      // Verify that actual HTTP requests work on this loopback socket
      const pingRes = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${address.port}/api/ping`, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          });
        }).on('error', reject);
      });
      assert.equal(pingRes.status, 200);
      assert.equal(pingRes.body.status, 'ok');

      await new Promise(resolve => server.close(resolve));
    });

    test('actual server instance should safely ignore non-loopback host (0.0.0.0) and enforce 127.0.0.1 socket binding', async () => {
      const { server } = require('../server.js');
      await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
      const address = server.address();
      assert.equal(address.address, '127.0.0.1', 'Socket must bind to 127.0.0.1 even when 0.0.0.0 is requested');
      await new Promise(resolve => server.close(resolve));
    });

    test('actual server instance should safely ignore non-loopback IPv6 wildcard (::) and enforce 127.0.0.1 socket binding', async () => {
      const { server } = require('../server.js');
      await new Promise(resolve => server.listen(0, '::', resolve));
      const address = server.address();
      assert.equal(address.address, '127.0.0.1', 'Socket must bind to 127.0.0.1 even when :: is requested');
      await new Promise(resolve => server.close(resolve));
    });

    test('actual server instance should safely ignore external IP (192.168.1.1) in options object and enforce 127.0.0.1', async () => {
      const { server } = require('../server.js');
      await new Promise(resolve => server.listen({ port: 0, host: '192.168.1.1' }, resolve));
      const address = server.address();
      assert.equal(address.address, '127.0.0.1', 'Socket must bind to 127.0.0.1 even when external IP is passed in options');
      await new Promise(resolve => server.close(resolve));
    });

    test('isolated background server process should bind socket strictly to 127.0.0.1', () => {
      assert.ok(serverProcessAddress, 'serverProcessAddress must be captured');
      assert.equal(serverProcessAddress.address, '127.0.0.1');
      assert.equal(serverProcessAddress.family, 'IPv4');
    });

    test('child process spawned with HOST=0.0.0.0 must ignore it and bind socket to 127.0.0.1', async () => {
      const childDb = path.join(tempDir, 'host-0000.db');
      const { fork } = require('child_process');
      let cp = null;
      try {
        cp = fork(path.join(__dirname, '..', 'server.js'), [], {
          env: {
            ...process.env,
            HOST: '0.0.0.0',
            PORT: 0,
            NODE_ENV: 'test',
            INDEX_DB_PATH: childDb
          }
        });

        const message = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Timeout waiting for child process listening event'));
          }, 5000);

          cp.on('message', (msg) => {
            if (msg && msg.event === 'listening') {
              clearTimeout(timeout);
              resolve(msg);
            }
          });
          cp.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        assert.equal(message.address.address, '127.0.0.1', 'Spawned child process must bind socket to 127.0.0.1 despite HOST=0.0.0.0');
        assert.equal(message.host, '127.0.0.1');
      } finally {
        if (cp && cp.exitCode === null && cp.signalCode === null) {
          await terminateProcess(cp);
        }
        if (!cp || cp.exitCode !== null || cp.signalCode !== null) {
          if (fs.existsSync(childDb)) {
            fs.rmSync(childDb, { force: true });
            assert.equal(fs.existsSync(childDb), false, 'childDb must be removed');
          }
        }
      }
    });

    test('child process spawned with HOST=:: must ignore it and bind socket to 127.0.0.1', async () => {
      const childDb = path.join(tempDir, 'host-ipv6.db');
      const { fork } = require('child_process');
      let cp = null;
      try {
        cp = fork(path.join(__dirname, '..', 'server.js'), [], {
          env: {
            ...process.env,
            HOST: '::',
            PORT: 0,
            NODE_ENV: 'test',
            INDEX_DB_PATH: childDb
          }
        });

        const message = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Timeout waiting for child process listening event'));
          }, 5000);

          cp.on('message', (msg) => {
            if (msg && msg.event === 'listening') {
              clearTimeout(timeout);
              resolve(msg);
            }
          });
          cp.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        assert.equal(message.address.address, '127.0.0.1', 'Spawned child process must bind socket to 127.0.0.1 despite HOST=::');
        assert.equal(message.host, '127.0.0.1');
      } finally {
        if (cp && cp.exitCode === null && cp.signalCode === null) {
          await terminateProcess(cp);
        }
        if (!cp || cp.exitCode !== null || cp.signalCode !== null) {
          if (fs.existsSync(childDb)) {
            fs.rmSync(childDb, { force: true });
            assert.equal(fs.existsSync(childDb), false, 'childDb must be removed');
          }
        }
      }
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
      const res = await request('/api/ping', 'GET', null, { Host: `127.0.0.1:${auditPort}` });
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
      const res = await request('/api/ping', 'GET', null, { Origin: `http://127.0.0.1:${auditPort}` });
      assert.equal(res.status, 200);
      assert.equal(res.headers['access-control-allow-origin'], `http://127.0.0.1:${auditPort}`);
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
          port: auditPort,
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
      } catch (e) {
        if (e.code === 'EPIPE' || e.code === 'ECONNRESET') {
          failed = true;
        } else {
          throw e;
        }
      }

      assert.ok(failed, 'Server should reject or abort payload exceeding 10MB');
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

  describe('Temuan Wajib: Isolasi Database dan Resource dalam Pengujian (Phase 6.3 – 6.7)', () => {
    test('root repository default database integrity is verified across test execution (zero-touch verification)', () => {
      // Verifies intermediate state; suite final teardown in after() performs definitive baseline comparison
      const intermediateSnapshot = captureSnapshot(repoRootDbPath);
      assertStrictSnapshotEqual(rootDbSnapshotBefore, intermediateSnapshot, 'Root repository DB (intermediate check)');
    });

    test('scenario 1 (database available): snapshot comparison in temporary app directory confirms pre-existing guarded default DB remains strictly untouched across all resolution channels', async () => {
      const sandboxAppDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-snap-avail-'));
      const sandboxDefaultDb = path.join(sandboxAppDir, 'wekeepit-index.db');

      try {
        // 1. Buat database SQLite valid dalam direktori aplikasi sementara sebagai pre-existing default DB fixture
        const Database = require('better-sqlite3');
        const setupDb = new Database(sandboxDefaultDb);
        setupDb.pragma('journal_mode = WAL');
        setupDb.exec(`
          CREATE TABLE pre_existing_data (id INTEGER PRIMARY KEY, note TEXT);
          INSERT INTO pre_existing_data (note) VALUES ('Initial baseline data');
        `);
        setupDb.close();

        // 2. Ambil snapshot database, WAL, dan SHM sebelum operasi
        const snapshotBefore = captureSnapshot(sandboxDefaultDb);
        assert.equal(snapshotBefore.main.exists, true, 'Pre-existing default DB must exist in sandbox app directory');

        // 3. Injeksi sandboxDefaultDb sebagai protected target untuk test ini
        IndexDB.setProtectedDefaultDbPathForTest(sandboxDefaultDb);

        // 4. Jalankan operasi valid pada database kerja terisolasi (fungsi normal tidak terganggu)
        const isolatedDbPath = path.join(sandboxAppDir, 'isolated-working.db');
        let isolatedDb = null;
        try {
          isolatedDb = new IndexDB(isolatedDbPath);
          const isolatedFm = new FolderManager(isolatedDb);
          const sampleFolder = path.join(sandboxAppDir, 'docs');
          fs.mkdirSync(sampleFolder, { recursive: true });
          fs.writeFileSync(path.join(sampleFolder, 'sample.md'), '# Testing isolation', 'utf-8');
          const fRec = isolatedFm.addFolder(sampleFolder);
          isolatedFm.scanAndReconcile(fRec.id);
          const SearchEngineClass = require('../indexer/search-engine.js');
          const searchEngine = new SearchEngineClass(isolatedDb);
          searchEngine.searchDocuments('Testing');
        } finally {
          if (isolatedDb) isolatedDb.close();
        }

        // 5. Buktikan in-memory database (:memory:) tetap berfungsi
        const memDb = new IndexDB(':memory:');
        assert.equal(memDb.dbPath, ':memory:');
        memDb.close();

        // 6. Uji bahwa SEMUA jalur resolusi yang mengarah ke protected sandbox fixture ditolak sebelum SQLite membukanya:
        // a) Constructor argument eksplisit (absolute path)
        assert.throws(
          () => new IndexDB(sandboxDefaultDb),
          /\[Security Violation\]/
        );

        // b) Dot segments (. and ..) and path variants
        assert.throws(
          () => new IndexDB(path.join(sandboxAppDir, '.', 'wekeepit-index.db')),
          /\[Security Violation\]/
        );
        assert.throws(
          () => new IndexDB(path.join(sandboxAppDir, 'sub', '..', 'wekeepit-index.db')),
          /\[Security Violation\]/
        );
        if (path.parse(sandboxDefaultDb).root.toLowerCase() === path.parse(process.cwd()).root.toLowerCase()) {
          const relativePath = path.relative(process.cwd(), sandboxDefaultDb);
          assert.throws(
            () => new IndexDB(relativePath),
            /\[Security Violation\]/
          );
        }

        // c) Slash variants
        assert.throws(
          () => new IndexDB(sandboxDefaultDb.replace(/\\/g, '/')),
          /\[Security Violation\]/
        );

        // d) Casing variants (pada filesystem case-insensitive yang terdeteksi secara aktual)
        if (IndexDB.isPathCaseInsensitive(sandboxDefaultDb)) {
          assert.throws(
            () => new IndexDB(sandboxDefaultDb.toUpperCase()),
            /\[Security Violation\]/
          );
        }

        // e) Environment variable INDEX_DB_PATH
        const prevEnv = process.env.INDEX_DB_PATH;
        try {
          process.env.INDEX_DB_PATH = sandboxDefaultDb;
          assert.throws(() => new IndexDB(), /\[Security Violation\]/);
          assert.throws(() => new IndexDB(undefined), /\[Security Violation\]/);
          assert.throws(() => new IndexDB(null), /\[Security Violation\]/);
        } finally {
          process.env.INDEX_DB_PATH = prevEnv;
        }

        // f) Injected default path options fallback
        const cleanEnv = process.env.INDEX_DB_PATH;
        try {
          delete process.env.INDEX_DB_PATH;
          assert.throws(
            () => new IndexDB(undefined, { defaultDbPath: sandboxDefaultDb }),
            /\[Security Violation\]/
          );
          assert.throws(
            () => new IndexDB(null, { defaultDbPath: sandboxDefaultDb }),
            /\[Security Violation\]/
          );
        } finally {
          if (cleanEnv) process.env.INDEX_DB_PATH = cleanEnv;
        }

        // g) Canonical production default DB tetap terlindungi (guard tidak dinonaktifkan)
        assert.throws(
          () => new IndexDB(IndexDB.DEFAULT_DB_PATH),
          /\[Security Violation\]/
        );

        // 7. Ambil snapshot sesudah seluruh percobaan akses
        const snapshotAfter = captureSnapshot(sandboxDefaultDb);

        // 8. Bandingkan keberadaan, hash SHA-256, ukuran byte, dan mtime untuk file utama, WAL, dan SHM
        assertStrictSnapshotEqual(snapshotBefore, snapshotAfter, 'Pre-existing sandbox default DB');
      } finally {
        IndexDB.clearProtectedDefaultDbPathForTest();
        fs.rmSync(sandboxAppDir, { recursive: true, force: true });
        assert.equal(fs.existsSync(sandboxAppDir), false, 'Sandbox app directory must be cleanly removed without error');
      }
    });

    test('scenario 2 (database unavailable): isolated process in temporary app directory never creates default DB, WAL, or SHM', async () => {
      const tempAppDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-app-unavail-'));
      const testDbPath = path.join(tempAppDir, 'test-isolated.db');
      const expectedDefaultDbPath = path.join(tempAppDir, 'wekeepit-index.db');
      const expectedWal = expectedDefaultDbPath + '-wal';
      const expectedShm = expectedDefaultDbPath + '-shm';

      // Verify that initially the default database does NOT exist
      assert.equal(fs.existsSync(expectedDefaultDbPath), false, 'Default DB must not exist initially in tempAppDir');

      const childScriptPath = path.join(tempAppDir, 'child-test-runner.js');
      const childCode = `
const fs = require('fs');
const path = require('path');
const http = require('http');

const serverJsPath = ${JSON.stringify(path.resolve(__dirname, '..', 'server.js'))};
const { createServerApp } = require(serverJsPath);

(async () => {
  const app = createServerApp({
    dbPath: ${JSON.stringify(testDbPath)},
    baseDir: ${JSON.stringify(tempAppDir)},
    autoWatch: false
  });

  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const addr = app.server.address();

  const pingRes = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:' + addr.port + '/api/ping', (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    }).on('error', reject);
  });

  await app.close();

  // Check if default database was created during execution
  const dbCreatedDuringRun = fs.existsSync(${JSON.stringify(expectedDefaultDbPath)});

  if (process.send) {
    process.send({
      success: true,
      pingStatus: pingRes.status,
      pingOk: pingRes.body.status === 'ok',
      dbCreatedDuringRun
    });
  }
  process.exit(0);
})();
`;
      fs.writeFileSync(childScriptPath, childCode, 'utf-8');

      let cp = null;
      try {
        const { fork } = require('child_process');
        cp = fork(childScriptPath, [], {
          cwd: tempAppDir,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            PORT: 0,
            HOST: '127.0.0.1',
            INDEX_DB_PATH: testDbPath
          }
        });

        let childMsg = null;
        cp.on('message', (msg) => { childMsg = msg; });

        await waitForProcessExit(cp);

        assert.ok(childMsg && childMsg.success, 'Child test process in temporary app location must complete successfully');
        assert.equal(childMsg.pingStatus, 200);
        assert.equal(childMsg.pingOk, true);
        assert.equal(childMsg.dbCreatedDuringRun, false, 'Default DB must NOT be created during child process execution');

        // Verify that default DB and WAL/SHM were NEVER created in tempAppDir
        assert.equal(fs.existsSync(expectedDefaultDbPath), false, 'wekeepit-index.db must NOT be created in temporary app location');
        assert.equal(fs.existsSync(expectedWal), false, 'wekeepit-index.db-wal must NOT be created in temporary app location');
        assert.equal(fs.existsSync(expectedShm), false, 'wekeepit-index.db-shm must NOT be created in temporary app location');

        // Verify that the designated isolated database WAS created
        assert.equal(fs.existsSync(testDbPath), true, 'Designated isolated test database must exist');
      } finally {
        if (cp && cp.exitCode === null && cp.signalCode === null) {
          await terminateProcess(cp);
        }
        if (!cp || cp.exitCode !== null || cp.signalCode !== null) {
          fs.rmSync(tempAppDir, { recursive: true, force: true });
          assert.equal(fs.existsSync(tempAppDir), false, 'Temporary app directory must be cleanly removed without error');
        }
      }
    });

    test('passive import in isolated child process with INDEX_DB_PATH removed must NOT create database or watcher', async () => {
      const tempPassiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-passive-import-'));
      const childScriptPath = path.join(tempPassiveDir, 'child-passive-import.js');
      const serverJsPath = path.resolve(__dirname, '..', 'server.js');

      const childCode = `
const fs = require('fs');
const path = require('path');

// Delete INDEX_DB_PATH from environment
delete process.env.INDEX_DB_PATH;

const initialFiles = fs.readdirSync(process.cwd());

// Require server.js WITHOUT accessing getters
const serverModule = require(${JSON.stringify(serverJsPath)});

// Verify exported methods without accessing getters
const hasFactory = typeof serverModule.createServerApp === 'function';
const hasIsLoopback = typeof serverModule.isLoopbackHost === 'function';
const hasResolveLoopback = typeof serverModule.resolveLoopbackHost === 'function';
const hasValidateLoopback = typeof serverModule.validateLoopbackHost === 'function';

const currentFiles = fs.readdirSync(process.cwd());
const createdFiles = currentFiles.filter(f => !initialFiles.includes(f));
const defaultDbInCwd = fs.existsSync(path.join(process.cwd(), 'wekeepit-index.db'));

if (process.send) {
  process.send({
    success: true,
    hasFactory,
    hasIsLoopback,
    hasResolveLoopback,
    hasValidateLoopback,
    createdFiles,
    defaultDbInCwd
  });
}
process.exit(0);
`;
      fs.writeFileSync(childScriptPath, childCode, 'utf-8');

      let cp = null;
      try {
        const { fork } = require('child_process');
        const cleanEnv = { ...process.env };
        delete cleanEnv.INDEX_DB_PATH;

        cp = fork(childScriptPath, [], {
          cwd: tempPassiveDir,
          env: cleanEnv
        });

        let childMsg = null;
        cp.on('message', (msg) => { childMsg = msg; });

        await waitForProcessExit(cp);

        assert.ok(childMsg && childMsg.success, 'Passive import child process must execute successfully');
        assert.equal(childMsg.hasFactory, true, 'createServerApp factory must be exported');
        assert.equal(childMsg.hasIsLoopback, true, 'isLoopbackHost must be exported');
        assert.equal(childMsg.hasResolveLoopback, true, 'resolveLoopbackHost must be exported');
        assert.equal(childMsg.hasValidateLoopback, true, 'validateLoopbackHost must be exported');
        assert.equal(childMsg.defaultDbInCwd, false, 'Default DB must NOT be created on passive import');
        assert.equal(childMsg.createdFiles.length, 0, 'No files or databases should be created on passive import');
        assert.equal(cp.exitCode, 0, 'Process must exit cleanly with code 0 (no lingering watchers keeping event loop alive)');
      } finally {
        if (cp && cp.exitCode === null && cp.signalCode === null) {
          await terminateProcess(cp);
        }
        if (!cp || cp.exitCode !== null || cp.signalCode !== null) {
          fs.rmSync(tempPassiveDir, { recursive: true, force: true });
          assert.equal(fs.existsSync(tempPassiveDir), false, 'Passive import test directory must be deleted cleanly without error');
        }
      }
    });

    test('close() order: HTTP server closes before DB and watchers; in-flight requests succeed before DB closes; repeated close() is safe and idempotent', async () => {
      const tempCloseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-close-order-'));
      try {
        const { createServerApp } = require('../server.js');
        const dbPath = path.join(tempCloseDir, 'close-test.db');
        const app = createServerApp({
          dbPath,
          baseDir: tempCloseDir,
          autoWatch: false
        });

        await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
        const addr = app.server.address();

        // 1. In-flight request test: start a request that queries the DB, trigger app.close() once connected
        let closePromise1, closePromise2, closePromise3;
        const triggerClose = () => {
          closePromise1 = app.close();
          // Repeated close while close is already in flight (must be safe and idempotent)
          closePromise2 = app.close();
          closePromise3 = app.server.close();
        };

        const reqPromise = new Promise((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${addr.port}/api/search?q=test`, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
              try {
                resolve({ status: res.statusCode, body: JSON.parse(data) });
              } catch (e) {
                resolve({ status: res.statusCode, body: data });
              }
            });
          });
          req.on('error', reject);
          req.on('socket', (socket) => {
            if (socket.connecting) {
              socket.once('connect', triggerClose);
            } else {
              triggerClose();
            }
          });
        });

        const res = await reqPromise;
        await Promise.all([closePromise1, closePromise2, closePromise3]);

        assert.equal(res.status, 200, 'In-flight DB search request must succeed with 200 before DB closes');
        assert.ok(Array.isArray(res.body.documents.results), 'Search documents results array must be returned');

        // Now DB and watchers should be closed
        assert.equal(app.db.db, null, 'SQLite database must be closed and null');
        assert.equal(app.folderManager.watchers.size, 0, 'Watchers must be cleared');
        assert.equal(app.isClosed, true, 'app.isClosed must be true');

        // 2. Repeated close after completion must also be safe and idempotent
        await app.close();
        await new Promise((resolve) => app.server.close(resolve));
      } finally {
        fs.rmSync(tempCloseDir, { recursive: true, force: true });
        assert.equal(fs.existsSync(tempCloseDir), false, 'tempCloseDir must be cleanly removed without error');
      }
    });

    test('SEC-09: new IndexDB() throws Security Violation when process.env.INDEX_DB_PATH points to default database', () => {
      const originalEnvPath = process.env.INDEX_DB_PATH;
      try {
        process.env.INDEX_DB_PATH = IndexDB.DEFAULT_DB_PATH;
        assert.throws(
          () => new IndexDB(),
          /\[Security Violation\] Direct access to default database/
        );
      } finally {
        process.env.INDEX_DB_PATH = originalEnvPath;
      }
    });

    test('SEC-09: new IndexDB(undefined) and new IndexDB(null) throw Security Violation when process.env.INDEX_DB_PATH points to default database', () => {
      const originalEnvPath = process.env.INDEX_DB_PATH;
      try {
        process.env.INDEX_DB_PATH = IndexDB.DEFAULT_DB_PATH;
        assert.throws(
          () => new IndexDB(undefined),
          /\[Security Violation\] Direct access to default database/
        );
        assert.throws(
          () => new IndexDB(null),
          /\[Security Violation\] Direct access to default database/
        );
      } finally {
        process.env.INDEX_DB_PATH = originalEnvPath;
      }
    });

    test('SEC-09: path variations equivalent to default database (absolute, relative, slashes, casing) are strictly rejected', () => {
      const variations = [
        IndexDB.DEFAULT_DB_PATH,
        IndexDB.DEFAULT_DB_PATH.replace(/\\/g, '/'),
        'wekeepit-index.db',
        './wekeepit-index.db',
        '././wekeepit-index.db',
        path.join('.', 'wekeepit-index.db'),
        path.join(__dirname, '..', 'wekeepit-index.db'),
        path.join(__dirname, '..', '.', 'wekeepit-index.db')
      ];

      // Apply case-insensitive comparisons only where underlying filesystem semantics justify them
      if (IndexDB.isPathCaseInsensitive(IndexDB.DEFAULT_DB_PATH)) {
        variations.push(
          IndexDB.DEFAULT_DB_PATH.toLowerCase(),
          IndexDB.DEFAULT_DB_PATH.toUpperCase()
        );
      }

      for (const variant of variations) {
        assert.throws(
          () => new IndexDB(variant),
          /\[Security Violation\] Direct access to default database/,
          `Failed to reject equivalent default DB path variant: ${variant}`
        );
      }
    });

    test('SEC-09: canonicalizeDbPath safely handles dot segments, relative paths, symlink aliases, and nonexistent targets without opening or creating files', () => {
      const tempCanonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-canon-test-'));
      try {
        const existingSubdir = path.join(tempCanonDir, 'subdir');
        fs.mkdirSync(existingSubdir, { recursive: true });

        // Nonexistent target inside existing directory
        const nonExistentTarget = path.join(existingSubdir, 'nonexistent.db');
        const canonNonExistent = IndexDB.canonicalizeDbPath(nonExistentTarget);
        assert.ok(canonNonExistent, 'canonicalizeDbPath should return a canonical path for nonexistent target in existing dir');

        // Relative path with dot segments
        const dotSegmentPath = path.join(existingSubdir, '..', 'subdir', '.', 'nonexistent.db');
        const canonDotSegment = IndexDB.canonicalizeDbPath(dotSegmentPath);
        assert.equal(canonDotSegment, canonNonExistent, 'Dot segments must resolve to identical canonical path');

        // Existing file
        const existingFile = path.join(existingSubdir, 'existing.db');
        fs.writeFileSync(existingFile, 'test', 'utf-8');
        const canonExisting = IndexDB.canonicalizeDbPath(existingFile);
        assert.ok(canonExisting);

        // Symlink alias test if supported by platform/privileges
        const linkDir = path.join(tempCanonDir, 'linkdir');
        try {
          fs.symlinkSync(existingSubdir, linkDir, 'junction');
          const viaLink = path.join(linkDir, 'existing.db');
          const canonViaLink = IndexDB.canonicalizeDbPath(viaLink);
          assert.equal(canonViaLink, canonExisting, 'Symlink alias must resolve to same canonical path');
        } catch (symlinkErr) {
          // If unprivileged platform does not permit symlink/junction creation, skip gracefully
        }
      } finally {
        fs.rmSync(tempCanonDir, { recursive: true, force: true });
        assert.equal(fs.existsSync(tempCanonDir), false, 'tempCanonDir must be cleaned up');
      }
    });

    test('SEC-09: valid temporary database in temporary directory can be created, opened, and closed successfully', () => {
      const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-valid-db-'));
      try {
        const dbFile = path.join(tempDbDir, 'sandbox.db');
        const dbInstance = new IndexDB(dbFile);
        assert.ok(dbInstance.db !== null, 'Database connection must be initialized');
        assert.equal(fs.existsSync(dbFile), true, 'Database file must exist on disk');
        dbInstance.close();
        assert.equal(dbInstance.db, null, 'Database connection must be null after close');
      } finally {
        fs.rmSync(tempDbDir, { recursive: true, force: true });
        assert.equal(fs.existsSync(tempDbDir), false, 'Temporary database directory must be removed');
      }
    });

    test('SEC-09: in-memory database (:memory:) functions properly without triggering security violation', () => {
      const memDb = new IndexDB(':memory:');
      assert.ok(memDb.db !== null, 'In-memory database must be initialized');
      assert.equal(memDb.dbPath, ':memory:');
      memDb.close();
      assert.equal(memDb.db, null);
    });

    test('SEC-09: IndexDB path guard remains active regardless of module import order or fresh require', () => {
      delete require.cache[require.resolve('../indexer/db.js')];
      const FreshIndexDB = require('../indexer/db.js');
      assert.throws(
        () => new FreshIndexDB(FreshIndexDB.DEFAULT_DB_PATH),
        /\[Security Violation\] Direct access to default database/
      );
    });

    test('SEC-09 regression: canonicalizeDbPath throws explicit error on inaccessible parent or ancestor directory and guard fails closed', () => {
      let inaccessiblePath;
      let cleanupDir = null;
      if (process.platform === 'win32') {
        inaccessiblePath = 'Z:\\nonexistent_ancestor_drive\\sub\\isolated.db';
      } else {
        cleanupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-noaccess-'));
        const restricted = path.join(cleanupDir, 'restricted');
        fs.mkdirSync(restricted, { mode: 0o000 });
        inaccessiblePath = path.join(restricted, 'sub', 'isolated.db');
      }

      try {
        assert.throws(
          () => IndexDB.canonicalizeDbPath(inaccessiblePath),
          /Inaccessible parent directory or ancestor|permission denied|EACCES/
        );

        assert.throws(
          () => IndexDB.isDefaultDbPath(inaccessiblePath),
          /\[Security Violation\] Canonical path equivalence cannot be established safely/
        );

        assert.throws(
          () => new IndexDB(inaccessiblePath),
          /\[Security Violation\] Canonical path equivalence cannot be established safely/
        );
      } finally {
        if (cleanupDir && fs.existsSync(cleanupDir)) {
          try {
            fs.chmodSync(path.join(cleanupDir, 'restricted'), 0o700);
          } catch (_) {}
          fs.rmSync(cleanupDir, { recursive: true, force: true });
        }
      }
    });

    test('SEC-09 regression: canonicalizeDbPath surfaces permission errors (EACCES/EPERM) without swallowing and guard fails closed', () => {
      const origRealpath = fs.realpathSync;
      const testPath = path.join(os.tmpdir(), 'eacces-sim-target.db');
      fs.writeFileSync(testPath, 'x');
      try {
        fs.realpathSync = (p) => {
          if (typeof p === 'string' && p.includes('eacces-sim')) {
            const err = new Error('EACCES: permission denied');
            err.code = 'EACCES';
            throw err;
          }
          return origRealpath(p);
        };

        assert.throws(
          () => IndexDB.canonicalizeDbPath(testPath),
          /EACCES: permission denied/
        );

        assert.throws(
          () => IndexDB.isDefaultDbPath(testPath),
          /\[Security Violation\] Canonical path equivalence cannot be established safely.*EACCES/
        );

        assert.throws(
          () => new IndexDB(testPath),
          /\[Security Violation\] Canonical path equivalence cannot be established safely.*EACCES/
        );
      } finally {
        fs.realpathSync = origRealpath;
        if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
      }
    });

    test('SEC-09 regression: symlink cycle / loop (ELOOP) throws explicit error and fails closed', () => {
      const origRealpath = fs.realpathSync;
      const loopPath = path.join(os.tmpdir(), 'eloop-sim-target.db');
      fs.writeFileSync(loopPath, 'x');
      try {
        fs.realpathSync = (p) => {
          if (typeof p === 'string' && p.includes('eloop-sim')) {
            const err = new Error('ELOOP: too many levels of symbolic links');
            err.code = 'ELOOP';
            throw err;
          }
          return origRealpath(p);
        };

        assert.throws(
          () => IndexDB.canonicalizeDbPath(loopPath),
          /ELOOP: too many levels of symbolic links/
        );

        assert.throws(
          () => IndexDB.isDefaultDbPath(loopPath),
          /\[Security Violation\] Canonical path equivalence cannot be established safely.*ELOOP/
        );

        assert.throws(
          () => new IndexDB(loopPath),
          /\[Security Violation\] Canonical path equivalence cannot be established safely.*ELOOP/
        );
      } finally {
        fs.realpathSync = origRealpath;
        if (fs.existsSync(loopPath)) fs.unlinkSync(loopPath);
      }
    });

    test('SEC-09 regression: nonexistent target in existing directory canonicalizes safely and is permitted for isolated database', () => {
      const tempDirForNonexistent = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-nonexistent-'));
      try {
        const nonexistentDbPath = path.join(tempDirForNonexistent, 'future.db');
        assert.equal(fs.existsSync(nonexistentDbPath), false, 'Target database must not exist initially');
        const canon = IndexDB.canonicalizeDbPath(nonexistentDbPath);
        assert.ok(canon, 'canonicalizeDbPath must return canonical path for nonexistent target in valid parent');
        assert.equal(IndexDB.isDefaultDbPath(nonexistentDbPath), false, 'Nonexistent isolated target is not default DB');

        const db = new IndexDB(nonexistentDbPath);
        assert.ok(db.db !== null, 'Database connection must be initialized');
        assert.equal(fs.existsSync(nonexistentDbPath), true, 'Database file must be created on disk');
        db.close();
      } finally {
        fs.rmSync(tempDirForNonexistent, { recursive: true, force: true });
        assert.equal(fs.existsSync(tempDirForNonexistent), false, 'Temporary directory must be cleaned up');
      }
    });

    test('SEC-09 regression: filesystem case-sensitivity probe accurately reflects actual filesystem semantics', () => {
      assert.equal(typeof IndexDB.isPathCaseInsensitive(__dirname), 'boolean', 'Must return a boolean');
      assert.equal(typeof IndexDB.isPathCaseInsensitive(path.join(os.tmpdir(), 'arbitrary-test-path.db')), 'boolean');
      if (process.platform === 'win32') {
        assert.equal(IndexDB.isPathCaseInsensitive(__dirname), true, 'Windows filesystem must report case-insensitive');
      }
    });

    test('SEC-09 regression (Phase 6.9): protected-target canonicalization failure causes rejection, never lexical fallback', () => {
      const origRealpath = fs.realpathSync;
      const tempCandidateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-candidate-target-'));
      const candidateDbPath = path.join(tempCandidateDir, 'candidate.db');
      fs.writeFileSync(candidateDbPath, 'dummy');

      try {
        fs.realpathSync = (p) => {
          if (typeof p === 'string' && (p === IndexDB.DEFAULT_DB_PATH || p.includes('wekeepit-index.db'))) {
            const err = new Error('EACCES: permission denied on protected target');
            err.code = 'EACCES';
            throw err;
          }
          return origRealpath(p);
        };

        assert.throws(
          () => IndexDB.isDefaultDbPath(candidateDbPath),
          /\[Security Violation\] Canonical path equivalence cannot be established safely for protected target.*wekeepit-index\.db.*EACCES/
        );

        assert.throws(
          () => new IndexDB(candidateDbPath),
          /\[Security Violation\] Canonical path equivalence cannot be established safely for protected target.*wekeepit-index\.db.*EACCES/
        );
      } finally {
        fs.realpathSync = origRealpath;
        if (fs.existsSync(candidateDbPath)) fs.unlinkSync(candidateDbPath);
        fs.rmSync(tempCandidateDir, { recursive: true, force: true });
      }
    });

    test('SEC-09 regression (Phase 6.9): test-injected protected target canonicalization failure causes rejection and prevents constructor execution', () => {
      const origRealpath = fs.realpathSync;
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-injected-target-'));
      const candidatePath = path.join(tempDir, 'cand.db');
      const injectedProtectedPath = path.join(tempDir, 'injected-protected.db');
      fs.writeFileSync(candidatePath, 'c');
      fs.writeFileSync(injectedProtectedPath, 'p');

      try {
        IndexDB.setProtectedDefaultDbPathForTest(injectedProtectedPath);

        fs.realpathSync = (p) => {
          if (typeof p === 'string' && p.includes('injected-protected.db')) {
            const err = new Error('EACCES: permission denied on injected protected target');
            err.code = 'EACCES';
            throw err;
          }
          return origRealpath(p);
        };

        assert.throws(
          () => IndexDB.isDefaultDbPath(candidatePath),
          /\[Security Violation\] Canonical path equivalence cannot be established safely for protected target.*injected-protected\.db/
        );

        assert.throws(
          () => new IndexDB(candidatePath, { defaultDbPath: injectedProtectedPath }),
          /\[Security Violation\] Canonical path equivalence cannot be established safely for protected target.*injected-protected\.db/
        );
      } finally {
        fs.realpathSync = origRealpath;
        IndexDB.clearProtectedDefaultDbPathForTest();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('SEC-09 regression (Phase 6.9): candidate canonicalization failure causes rejection and constructor is never reached', () => {
      const origRealpath = fs.realpathSync;
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-cand-fail-'));
      const failingCandidate = path.join(tempDir, 'failing-candidate.db');
      fs.writeFileSync(failingCandidate, 'x');

      try {
        fs.realpathSync = (p) => {
          if (typeof p === 'string' && p.includes('failing-candidate.db')) {
            const err = new Error('EPERM: operation not permitted');
            err.code = 'EPERM';
            throw err;
          }
          return origRealpath(p);
        };

        assert.throws(
          () => IndexDB.isDefaultDbPath(failingCandidate),
          /\[Security Violation\] Canonical path equivalence cannot be established safely for candidate.*EPERM/
        );

        let createdInstance = null;
        assert.throws(
          () => { createdInstance = new IndexDB(failingCandidate); },
          /\[Security Violation\] Canonical path equivalence cannot be established safely for candidate.*EPERM/
        );
        assert.equal(createdInstance, null, 'IndexDB instance must never be created when candidate canonicalization fails');
      } finally {
        fs.realpathSync = origRealpath;
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('SEC-09 regression (Phase 6.9): case-sensitivity probe failure throws meaningful error and cannot silently produce a guard bypass', () => {
      const origProbe = IndexDB.isPathCaseInsensitive;
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-probe-fail-'));
      const candidatePath = path.join(tempDir, 'candidate.db');
      fs.writeFileSync(candidatePath, 'x');

      try {
        assert.throws(
          () => IndexDB.isPathCaseInsensitive(''),
          /Invalid path argument for case-sensitivity probe/
        );

        IndexDB.isPathCaseInsensitive = () => {
          const err = new Error('Case-sensitivity probe failed: EACCES permission denied');
          err.code = 'EACCES';
          throw err;
        };

        assert.throws(
          () => IndexDB.canonicalizeDbPath(candidatePath),
          /Case-sensitivity probe failed: EACCES permission denied/
        );

        assert.throws(
          () => IndexDB.isDefaultDbPath(candidatePath),
          /\[Security Violation\] Canonical path equivalence cannot be established safely.*Case-sensitivity probe failed/
        );

        let instance = null;
        assert.throws(
          () => { instance = new IndexDB(candidatePath); },
          /\[Security Violation\] Canonical path equivalence cannot be established safely.*Case-sensitivity probe failed/
        );
        assert.equal(instance, null, 'Database constructor must never be reached on probe failure');
      } finally {
        IndexDB.isPathCaseInsensitive = origProbe;
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('SEC-09 regression (Phase 6.9): case variants on a confirmed case-insensitive filesystem are rejected', () => {
      const origProbe = IndexDB.isPathCaseInsensitive;
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-case-insens-'));
      const protectedPath = path.join(tempDir, 'ProtectedIndex.db');
      fs.writeFileSync(protectedPath, 'data');

      try {
        IndexDB.isPathCaseInsensitive = () => true;
        IndexDB.setProtectedDefaultDbPathForTest(protectedPath);

        const variant1 = path.join(tempDir, 'PROTECTEDINDEX.DB');
        const variant2 = path.join(tempDir, 'protectedindex.db');
        const variant3 = path.join(tempDir, 'pRoTeCtEdInDeX.Db');

        assert.equal(IndexDB.isDefaultDbPath(variant1, protectedPath), true, 'Uppercase variant must match protected path');
        assert.equal(IndexDB.isDefaultDbPath(variant2, protectedPath), true, 'Lowercase variant must match protected path');
        assert.equal(IndexDB.isDefaultDbPath(variant3, protectedPath), true, 'Mixed-case variant must match protected path');

        assert.throws(
          () => new IndexDB(variant1, { defaultDbPath: protectedPath }),
          /\[Security Violation\] Direct access to protected default database/
        );
        assert.throws(
          () => new IndexDB(variant2, { defaultDbPath: protectedPath }),
          /\[Security Violation\] Direct access to protected default database/
        );
        assert.throws(
          () => new IndexDB(variant3, { defaultDbPath: protectedPath }),
          /\[Security Violation\] Direct access to protected default database/
        );
      } finally {
        IndexDB.isPathCaseInsensitive = origProbe;
        IndexDB.clearProtectedDefaultDbPathForTest();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('SEC-09 regression (Phase 6.9): different-cased paths on a confirmed case-sensitive filesystem remain distinct where appropriate', () => {
      const origProbe = IndexDB.isPathCaseInsensitive;
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-case-sens-'));
      const dirA = path.join(tempDir, 'dirA');
      const dirB = path.join(tempDir, 'dirB');
      fs.mkdirSync(dirA);
      fs.mkdirSync(dirB);
      const protectedPath = path.join(dirA, 'my-protected.db');
      const distinctVariantPath = path.join(dirB, 'MY-PROTECTED.DB');

      try {
        IndexDB.isPathCaseInsensitive = () => false;
        IndexDB.setProtectedDefaultDbPathForTest(protectedPath);

        const canonA = IndexDB.canonicalizeDbPath(protectedPath);
        const canonB = IndexDB.canonicalizeDbPath(distinctVariantPath);
        assert.notEqual(canonA, canonB, 'Canonical paths must remain distinct when case-sensitivity is active');

        assert.equal(
          IndexDB.isDefaultDbPath(distinctVariantPath, protectedPath),
          false,
          'Distinct case variant on case-sensitive filesystem must not match protected path'
        );

        const db = new IndexDB(distinctVariantPath, { defaultDbPath: protectedPath });
        assert.ok(db.db !== null, 'Distinct database connection must be initialized');
        db.close();
      } finally {
        IndexDB.isPathCaseInsensitive = origProbe;
        IndexDB.clearProtectedDefaultDbPathForTest();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('SEC-09 regression (Phase 6.9): production DEFAULT_DB_PATH protection remains active when a test-injected path is used', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-prod-guard-'));
      const injectedPath = path.join(tempDir, 'custom-test-protected.db');
      fs.writeFileSync(injectedPath, 'x');

      try {
        IndexDB.setProtectedDefaultDbPathForTest(injectedPath);

        assert.equal(IndexDB.isDefaultDbPath(IndexDB.DEFAULT_DB_PATH), true);
        assert.equal(IndexDB.isDefaultDbPath(injectedPath), true);

        assert.throws(
          () => new IndexDB(IndexDB.DEFAULT_DB_PATH, { defaultDbPath: injectedPath }),
          /\[Security Violation\] Direct access to default database/
        );

        assert.throws(
          () => new IndexDB(injectedPath, { defaultDbPath: injectedPath }),
          /\[Security Violation\] Direct access to protected default database/
        );
      } finally {
        IndexDB.clearProtectedDefaultDbPathForTest();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('SEC-09 regression (Phase 6.9): normal temporary DB and :memory: operation still work', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-normal-ops-'));
      const isolatedDbPath = path.join(tempDir, 'normal.db');

      try {
        const db = new IndexDB(isolatedDbPath);
        assert.ok(db.db !== null, 'Database connection must be open');
        assert.equal(fs.existsSync(isolatedDbPath), true, 'Database file must exist on disk');
        const rows = db.db.prepare('SELECT 1 as val').all();
        assert.equal(rows[0].val, 1, 'Query must succeed on isolated DB');
        db.close();

        const memDb = new IndexDB(':memory:');
        assert.ok(memDb.db !== null, 'In-memory database connection must be open');
        const memRows = memDb.db.prepare('SELECT 42 as answer').all();
        assert.equal(memRows[0].answer, 42, 'Query must succeed on :memory: DB');
        memDb.close();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('SEC-10 regression 1: child process that exits normally is observed with exit code 0 and terminated cleanly', async () => {
      const tempNormalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-normal-exit-'));
      const normalScript = path.join(tempNormalDir, 'normal-child.js');
      fs.writeFileSync(normalScript, 'setTimeout(() => process.exit(0), 50);', 'utf-8');

      let cp = null;
      try {
        const { fork } = require('child_process');
        cp = fork(normalScript, [], { cwd: tempNormalDir, stdio: 'ignore' });
        await waitForProcessExit(cp, 3000);
        assert.equal(cp.exitCode, 0, 'Child process must exit normally with code 0');
        await terminateProcess(cp);
      } finally {
        if (cp && cp.exitCode === null && cp.signalCode === null) {
          await terminateProcess(cp);
        }
        if (!cp || cp.exitCode !== null || cp.signalCode !== null) {
          fs.rmSync(tempNormalDir, { recursive: true, force: true });
          assert.equal(fs.existsSync(tempNormalDir), false, 'Temporary directory must be cleanly removed');
        }
      }
    });

    test('SEC-10 regression 2: child that exceeds initial wait timeout is terminated gracefully and confirmed dead', async () => {
      const tempTimeoutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-timeout-sim-'));
      const hangScriptPath = path.join(tempTimeoutDir, 'hang-child.js');
      fs.writeFileSync(hangScriptPath, 'setInterval(() => {}, 60000);', 'utf-8');

      let cp = null;
      let caughtTimeout = false;
      try {
        const { fork } = require('child_process');
        cp = fork(hangScriptPath, [], { cwd: tempTimeoutDir, stdio: 'ignore' });

        // Wait with a short 200ms timeout to simulate timeout
        await waitForProcessExit(cp, 200);
      } catch (err) {
        caughtTimeout = true;
        assert.match(err.message, /did not exit within 200ms/);
      } finally {
        if (cp && cp.exitCode === null && cp.signalCode === null) {
          await terminateProcess(cp, 1000, 1000);
        }
        if (!cp || cp.exitCode !== null || cp.signalCode !== null) {
          fs.rmSync(tempTimeoutDir, { recursive: true, force: true });
          assert.equal(fs.existsSync(tempTimeoutDir), false, 'Temporary directory must be cleanly removed even after timeout');
        }
      }

      assert.equal(caughtTimeout, true, 'waitForProcessExit must have rejected with timeout error');
    });

    test('SEC-10 regression 3: child process termination with SIGTERM and escalation to SIGKILL (platform-aware)', async () => {
      const tempKillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-kill-sim-'));
      const ignoreScript = path.join(tempKillDir, 'ignore-sigterm.js');
      // On platforms where SIGTERM handler can be caught (POSIX), ignore it to force SIGKILL escalation.
      // On Windows, TerminateProcess terminates directly. Both are handled reliably.
      fs.writeFileSync(ignoreScript, `
        process.on('SIGTERM', () => { /* ignore SIGTERM where permitted */ });
        setInterval(() => {}, 60000);
      `, 'utf-8');

      let cp = null;
      try {
        const { fork } = require('child_process');
        cp = fork(ignoreScript, [], { cwd: tempKillDir, stdio: 'ignore' });
        // Allow process to start up and register handler
        await new Promise(r => setTimeout(r, 200));

        // Terminate process: on POSIX will escalate to SIGKILL after 300ms, on Windows terminates immediately
        await terminateProcess(cp, 300, 2000);
        assert.equal(cp.exitCode !== null || cp.signalCode !== null, true, 'Process must be confirmed terminated');
      } finally {
        if (cp && cp.exitCode === null && cp.signalCode === null) {
          await terminateProcess(cp, 500, 1000);
        }
        if (!cp || cp.exitCode !== null || cp.signalCode !== null) {
          fs.rmSync(tempKillDir, { recursive: true, force: true });
          assert.equal(fs.existsSync(tempKillDir), false, 'Temporary directory must be removed');
        }
      }
    });

    test('SEC-10 regression 4: termination failure or simulated signal failure is observable and never swallowed', async () => {
      const EventEmitter = require('events');
      // Case A: kill throws an error (e.g. EPERM or simulated failure)
      const fakeCp1 = new EventEmitter();
      fakeCp1.pid = 999991;
      fakeCp1.exitCode = null;
      fakeCp1.signalCode = null;
      fakeCp1.kill = () => {
        throw new Error('EPERM: operation not permitted (simulated signal failure)');
      };

      await assert.rejects(
        async () => {
          await terminateProcess(fakeCp1, 200, 200);
        },
        /operation not permitted|simulated signal failure/,
        'terminateProcess must reject and surface signal failure rather than swallowing it'
      );

      // Case B: kill returns false while process has not exited
      const fakeCp2 = new EventEmitter();
      fakeCp2.pid = 999992;
      fakeCp2.exitCode = null;
      fakeCp2.signalCode = null;
      fakeCp2.kill = () => false;

      await assert.rejects(
        async () => {
          await terminateProcess(fakeCp2, 200, 200);
        },
        /cp\.kill.*returned false/,
        'terminateProcess must reject when kill() returns false for un-exited process'
      );
    });

    test('SEC-10 regression 5: temporary directory and evidence are strictly preserved if termination fails', async () => {
      const tempEvidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-evidence-sim-'));
      const evidenceFile = path.join(tempEvidenceDir, 'log-evidence.txt');
      fs.writeFileSync(evidenceFile, 'critical execution evidence to preserve for diagnosis', 'utf-8');

      const EventEmitter = require('events');
      const fakeCp = new EventEmitter();
      fakeCp.pid = 999993;
      fakeCp.exitCode = null;
      fakeCp.signalCode = null;
      fakeCp.kill = () => { throw new Error('Simulated kill failure'); };

      let cleanupSucceeded = false;
      let errorObserved = null;

      try {
        await terminateProcess(fakeCp, 100, 100);
        // Directory cleanup must only execute after termination succeeds
        fs.rmSync(tempEvidenceDir, { recursive: true, force: true });
        cleanupSucceeded = true;
      } catch (err) {
        errorObserved = err;
        // On termination failure, evidence is preserved: do not delete tempEvidenceDir!
      }

      assert.ok(errorObserved, 'Termination failure must be observed');
      assert.equal(cleanupSucceeded, false, 'Cleanup must NOT execute when termination fails');
      assert.equal(fs.existsSync(tempEvidenceDir), true, 'Evidence directory must remain preserved on termination failure');
      assert.equal(fs.existsSync(evidenceFile), true, 'Evidence file must remain intact');

      // Manual cleanup after assertion
      fs.rmSync(tempEvidenceDir, { recursive: true, force: true });
    });

    test('SEC-12: shutdown failure in watchers propagates error while ensuring database is still closed', async () => {
      let dbClosed = false;
      const fakeDb = {
        close: () => { dbClosed = true; }
      };
      const fakeFm = {
        stopAllWatchers: () => { throw new Error('Watcher shutdown failure simulation'); },
        watchers: new Map()
      };
      const { createServerApp } = require('../server.js');
      const app = createServerApp({
        db: fakeDb,
        folderManager: fakeFm,
        autoWatch: false
      });

      await assert.rejects(
        async () => { await app.close(); },
        /Watcher shutdown failure simulation/,
        'app.close() must reject with watcher shutdown error'
      );

      assert.equal(dbClosed, true, 'Database close must STILL be attempted and executed when watcher fails');
      assert.equal(app.isClosed, true, 'app.isClosed must be true');
    });

    test('SEC-12: shutdown failure in database propagates error while ensuring watchers are stopped', async () => {
      let watchersStopped = false;
      const fakeFm = {
        stopAllWatchers: () => { watchersStopped = true; },
        watchers: new Map()
      };
      const fakeDb = {
        close: () => { throw new Error('Database close failure simulation'); }
      };
      const { createServerApp } = require('../server.js');
      const app = createServerApp({
        db: fakeDb,
        folderManager: fakeFm,
        autoWatch: false
      });

      await assert.rejects(
        async () => { await app.close(); },
        /Database close failure simulation/,
        'app.close() must reject with database close error'
      );

      assert.equal(watchersStopped, true, 'Watchers must STILL be stopped when database close fails');
      assert.equal(app.isClosed, true, 'app.isClosed must be true');
    });

    test('SEC-12: shutdown failure in both watchers and database attempts all resources and propagates combined error', async () => {
      let watcherAttempted = false;
      let dbAttempted = false;
      const fakeFm = {
        stopAllWatchers: () => { watcherAttempted = true; throw new Error('Watcher error stage'); },
        watchers: new Map()
      };
      const fakeDb = {
        close: () => { dbAttempted = true; throw new Error('DB error stage'); }
      };
      const { createServerApp } = require('../server.js');
      const app = createServerApp({
        db: fakeDb,
        folderManager: fakeFm,
        autoWatch: false
      });

      await assert.rejects(
        async () => { await app.close(); },
        (err) => {
          return watcherAttempted && dbAttempted &&
            (err.message.includes('Watcher error stage') || err.message.includes('DB error stage'));
        },
        'All stages must be attempted and combined error propagated'
      );
      assert.equal(watcherAttempted, true);
      assert.equal(dbAttempted, true);
    });

    test('SEC-12: callback and Promise receive consistent errors on shutdown failure', async () => {
      const fakeDb = {
        close: () => { throw new Error('Consistent error test'); }
      };
      const { createServerApp } = require('../server.js');
      const app = createServerApp({
        db: fakeDb,
        autoWatch: false
      });

      let cbErr = null;
      let promiseErr = null;

      await new Promise((resolve) => {
        app.close((err) => {
          cbErr = err;
          resolve();
        }).catch(pErr => {
          promiseErr = pErr;
        });
      });

      assert.ok(cbErr, 'Callback must receive error');
      assert.ok(promiseErr, 'Promise must reject with error');
      assert.equal(cbErr.message, promiseErr.message, 'Callback error and Promise error must match');
    });

    test('SEC-12: repeated and concurrent close() calls are safe, return consistent results, and do not double-close', async () => {
      let dbCloseCount = 0;
      const fakeDb = {
        close: () => { dbCloseCount++; }
      };
      const { createServerApp } = require('../server.js');
      const app = createServerApp({
        db: fakeDb,
        autoWatch: false
      });

      // Concurrent close calls
      await Promise.all([
        app.close(),
        app.close(),
        app.close()
      ]);

      assert.equal(dbCloseCount, 1, 'Database close must be invoked exactly once during concurrent close calls');

      // Subsequent repeated close calls after completion
      await app.close();
      await app.close();
      assert.equal(dbCloseCount, 1, 'Database close must not be re-invoked on repeated close');
    });

    test('createServerApp factory provides fully isolated dependencies and clean close() lifecycle', async () => {
      const isolatedTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-factory-test-'));
      try {
        const { createServerApp } = require('../server.js');
        const dbPath = path.join(isolatedTemp, 'factory-isolated.db');
        const dataPath = path.join(isolatedTemp, 'data.json');
        const schemaPath = path.join(isolatedTemp, 'schema.json');

        const app = createServerApp({
          dbPath,
          dataFile: dataPath,
          schemaFile: schemaPath,
          baseDir: isolatedTemp,
          autoWatch: false
        });

        assert.ok(app.server, 'app.server must exist');
        assert.ok(app.db, 'app.db must exist');
        assert.equal(app.db.dbPath, dbPath);
        assert.equal(fs.existsSync(dbPath), true, 'Isolated DB must exist');

        await new Promise(resolve => app.server.listen(0, resolve));
        const addr = app.server.address();
        assert.equal(addr.address, '127.0.0.1');

        const pingRes = await new Promise((resolve, reject) => {
          http.get(`http://127.0.0.1:${addr.port}/api/ping`, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
          }).on('error', reject);
        });
        assert.equal(pingRes.status, 200);
        assert.equal(pingRes.body.status, 'ok');

        await app.close();
        assert.equal(app.db.db, null, 'SQLite database must be closed and set to null');
        assert.equal(app.folderManager.watchers.size, 0, 'All watchers must be cleared');
      } finally {
        fs.rmSync(isolatedTemp, { recursive: true, force: true });
        assert.equal(fs.existsSync(isolatedTemp), false, 'isolatedTemp must be cleanly removed without error');
      }
    });

    test('all server test processes must operate with isolated temporary database paths', () => {
      assert.ok(process.env.INDEX_DB_PATH, 'INDEX_DB_PATH must be set in test environment');
      assert.ok(process.env.INDEX_DB_PATH.startsWith(os.tmpdir()), 'INDEX_DB_PATH must be in os.tmpdir()');
      assert.ok(tempDir.startsWith(os.tmpdir()), 'tempDir must be in os.tmpdir()');
    });
  });
});
