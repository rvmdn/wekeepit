const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

describe('Server V2 API Integration Tests', () => {
  // We can launch server.js in a separate child process on port 4329 to avoid port conflicts
  let serverProcess;
  const TEST_PORT = 4329;

  const request = (path, method = 'GET', body = null) => {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: TEST_PORT,
        path,
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
    const { fork } = require('child_process');
    serverProcess = fork(require('path').join(__dirname, '..', 'server.js'), [], {
      env: { ...process.env, PORT: TEST_PORT }
    });

    // Wait 1.5s for server to start
    await new Promise(resolve => setTimeout(resolve, 1500));
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
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
