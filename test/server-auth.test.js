const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { createServerApp } = require('../server.js');
const { AuthManager, ROLES } = require('../auth.js');

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Host': '127.0.0.1',
        ...(options.headers || {})
      }
    };

    if (body) {
      if (typeof body === 'object') {
        body = JSON.stringify(body);
        reqOptions.headers['Content-Type'] = 'application/json; charset=utf-8';
      }
      reqOptions.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = http.request(reqOptions, (res) => {
      let rawData = '';
      res.on('data', chunk => { rawData += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(rawData);
        } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: rawData,
          json
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

test('Server Adaptive Auth & RBAC Integration Tests', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-server-auth-'));
  const testDataFile = path.join(tmpDir, 'cards.json');
  const testSchemaFile = path.join(tmpDir, 'schema.json');
  const testUsersFile = path.join(tmpDir, 'users.json');

  fs.writeFileSync(testDataFile, JSON.stringify([{ id: 'card-1', title: 'Test Card' }]));
  fs.writeFileSync(testSchemaFile, JSON.stringify({ fields: [] }));

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('Desktop Mode (authEnabled = false): zero-friction local access', async () => {
    const app = createServerApp({
      dataFile: testDataFile,
      schemaFile: testSchemaFile,
      usersFile: testUsersFile,
      authEnabled: false,
      autoWatch: false,
      dbPath: ':memory:'
    });

    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));

    try {
      // 1. Config check
      const configRes = await makeRequest(app.server, { path: '/api/auth/config' });
      assert.strictEqual(configRes.statusCode, 200);
      assert.strictEqual(configRes.json.authEnabled, false);

      // 2. Auth me returns synthetic local admin
      const meRes = await makeRequest(app.server, { path: '/api/auth/me' });
      assert.strictEqual(meRes.statusCode, 200);
      assert.strictEqual(meRes.json.authenticated, true);
      assert.strictEqual(meRes.json.user.role, ROLES.ADMIN);

      // 3. Read cards without auth
      const cardsRes = await makeRequest(app.server, { path: '/api/cards' });
      assert.strictEqual(cardsRes.statusCode, 200);
      assert.strictEqual(cardsRes.json.length, 1);

      // 4. Write cards without auth
      const postCardRes = await makeRequest(app.server, {
        path: '/api/cards',
        method: 'POST'
      }, [{ id: 'card-2', title: 'Card Two' }]);
      assert.strictEqual(postCardRes.statusCode, 200);
      assert.strictEqual(postCardRes.json.success, true);
    } finally {
      await app.close();
    }
  });

  await t.test('Server Mode (authEnabled = true): Authentication, Tokens, and RBAC', async () => {
    const app = createServerApp({
      dataFile: testDataFile,
      schemaFile: testSchemaFile,
      usersFile: testUsersFile,
      authEnabled: true,
      autoWatch: false,
      dbPath: ':memory:'
    });

    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));

    try {
      // 1. Unauthenticated request to /api/cards returns 401
      const unauthCards = await makeRequest(app.server, { path: '/api/cards' });
      assert.strictEqual(unauthCards.statusCode, 401);
      assert.strictEqual(unauthCards.json.authRequired, true);

      // 2. Login with wrong password returns 401
      const wrongLogin = await makeRequest(app.server, {
        path: '/api/auth/login',
        method: 'POST'
      }, { username: 'admin', password: 'badpassword' });
      assert.strictEqual(wrongLogin.statusCode, 401);

      // 3. Login as Master Admin
      const adminLogin = await makeRequest(app.server, {
        path: '/api/auth/login',
        method: 'POST'
      }, { username: 'admin', password: 'admin123' });
      assert.strictEqual(adminLogin.statusCode, 200);
      assert.strictEqual(adminLogin.json.success, true);
      const adminToken = adminLogin.json.token;
      assert.ok(adminToken);

      // 4. Admin creates Editor and Viewer accounts
      const createEditorRes = await makeRequest(app.server, {
        path: '/api/auth/users',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      }, { username: 'editor', password: 'editor123', role: 'editor', displayName: 'Tim Editor' });
      assert.strictEqual(createEditorRes.statusCode, 201);

      const createViewerRes = await makeRequest(app.server, {
        path: '/api/auth/users',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      }, { username: 'viewer', password: 'viewer123', role: 'viewer', displayName: 'Tamu Pembaca' });
      assert.strictEqual(createViewerRes.statusCode, 201);

      // 5. Login as Viewer
      const viewerLogin = await makeRequest(app.server, {
        path: '/api/auth/login',
        method: 'POST'
      }, { username: 'viewer', password: 'viewer123' });
      assert.strictEqual(viewerLogin.statusCode, 200);
      assert.strictEqual(viewerLogin.json.success, true);
      const viewerToken = viewerLogin.json.token;
      assert.ok(viewerToken);

      // 6. Viewer can read cards
      const viewerGetCards = await makeRequest(app.server, {
        path: '/api/cards',
        headers: { 'Authorization': `Bearer ${viewerToken}` }
      });
      assert.strictEqual(viewerGetCards.statusCode, 200);

      // 7. Viewer CANNOT write cards (403 Forbidden)
      const viewerPostCards = await makeRequest(app.server, {
        path: '/api/cards',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${viewerToken}` }
      }, [{ id: 'hacker-card', title: 'Should fail' }]);
      assert.strictEqual(viewerPostCards.statusCode, 403);
      assert.ok(viewerPostCards.json.error.includes('Viewer'));

      // 8. Login as Editor
      const editorLogin = await makeRequest(app.server, {
        path: '/api/auth/login',
        method: 'POST'
      }, { username: 'editor', password: 'editor123' });
      assert.strictEqual(editorLogin.statusCode, 200);
      const editorToken = editorLogin.json.token;

      // 9. Editor CAN write cards
      const editorPostCards = await makeRequest(app.server, {
        path: '/api/cards',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${editorToken}` }
      }, [{ id: 'editor-card', title: 'Allowed' }]);
      assert.strictEqual(editorPostCards.statusCode, 200);
      assert.strictEqual(editorPostCards.json.success, true);

      // 8. Editor CANNOT modify schema (403 Forbidden)
      const editorPostSchema = await makeRequest(app.server, {
        path: '/api/schema',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${editorToken}` }
      }, { fields: [{ key: 'forbidden', label: 'No' }] });
      assert.strictEqual(editorPostSchema.statusCode, 403);

      // 10. Admin CAN modify schema
      const adminPostSchema = await makeRequest(app.server, {
        path: '/api/schema',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      }, { fields: [{ key: 'approved', label: 'Yes' }] });
      assert.strictEqual(adminPostSchema.statusCode, 200);

      // 11. Admin can list and create users
      const adminListUsers = await makeRequest(app.server, {
        path: '/api/auth/users',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(adminListUsers.statusCode, 200);
      assert.ok(Array.isArray(adminListUsers.json));

      // 12. Non-admin cannot list users
      const editorListUsers = await makeRequest(app.server, {
        path: '/api/auth/users',
        headers: { 'Authorization': `Bearer ${editorToken}` }
      });
      assert.strictEqual(editorListUsers.statusCode, 403);

      // 13. Logout
      const logoutRes = await makeRequest(app.server, {
        path: '/api/auth/logout',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(logoutRes.statusCode, 200);

      // Admin token is now invalid
      const meAfterLogout = await makeRequest(app.server, {
        path: '/api/auth/me',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(meAfterLogout.statusCode, 200);
      assert.strictEqual(meAfterLogout.json.authenticated, false);
    } finally {
      await app.close();
    }
  });
});
