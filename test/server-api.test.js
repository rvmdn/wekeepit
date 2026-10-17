const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Server V2 API Integration Tests', () => {
  // We can launch server.js in a separate child process on dynamic port with isolated temp database
  let serverProcess;
  let testPort = 0;
  let tempDir;
  let tempDbPath;

  const request = (reqPath, method = 'GET', body = null) => {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port: testPort,
        path: reqPath,
        method,
        headers: {
          'Content-Type': 'application/json'
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

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-server-api-'));
    tempDbPath = path.join(tempDir, 'server-api-test.db');

    const { fork } = require('child_process');
    serverProcess = fork(path.join(__dirname, '..', 'server.js'), [], {
      env: {
        ...process.env,
        PORT: 0,
        HOST: '127.0.0.1',
        NODE_ENV: 'test',
        INDEX_DB_PATH: tempDbPath
      }
    });

    try {
      testPort = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for serverProcess to start'));
        }, 7000);

        serverProcess.on('message', (msg) => {
          if (msg && msg.event === 'listening') {
            clearTimeout(timeout);
            resolve(msg.port);
          }
        });
        serverProcess.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    } catch (err) {
      if (serverProcess) {
        await terminateProcess(serverProcess);
        serverProcess = null;
      }
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      throw err;
    }
  });

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

      const onExit = () => {
        if (exited) return;
        exited = true;
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

      const onExit = () => {
        if (exited) return;
        exited = true;
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

  after(async () => {
    if (serverProcess) {
      await terminateProcess(serverProcess);
      serverProcess = null;
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      assert.equal(fs.existsSync(tempDir), false, 'Temporary directory must be deleted cleanly without error');
    }
  });

  test('server child process must be isolated and use temporary database in os.tmpdir()', () => {
    assert.ok(tempDbPath.startsWith(os.tmpdir()), 'Database path must be inside os.tmpdir()');
    assert.equal(fs.existsSync(tempDbPath), true, 'Temporary database file must exist');
  });

  test('GET /api/ping should return status ok and database stats', async () => {
    const res = await request('/api/ping');
    assert.equal(res.status, 200);
    assert.equal(res.data.status, 'ok');
    assert.equal(res.data.version, '2.0.0');
    assert.ok(res.data.stats);
  });

  test('GET /api/cards should return array of cards', async () => {
    const res = await request('/api/cards');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data));
  });

  test('GET /api/folders should return list of indexed folders', async () => {
    const res = await request('/api/folders');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data));
  });

  test('GET /api/indexer/status should return current status', async () => {
    const res = await request('/api/indexer/status');
    assert.equal(res.status, 200);
    assert.equal(typeof res.data.isIndexing, 'boolean');
    assert.ok(res.data.stats);
  });

  test('GET /api/search should return results partitioned by scope', async () => {
    const res = await request('/api/search?q=tech&scope=all');
    assert.equal(res.status, 200);
    assert.equal(res.data.query, 'tech');
    assert.ok(res.data.board);
    assert.ok(res.data.documents);
    assert.ok(Array.isArray(res.data.board.cards));
    assert.ok(Array.isArray(res.data.documents.results));
  });

  test('POST /api/open-file should reject non-existent paths safely', async () => {
    const res = await request('/api/open-file', 'POST', { path: 'Z:\\NonExistentPath\\file.md' });
    assert.equal(res.status, 400);
    assert.ok(res.data.error.includes('tidak ditemukan'));
  });

});
