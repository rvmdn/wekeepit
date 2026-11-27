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

      // 12. Non-admin can read team roster, but CANNOT create user (403 Forbidden)
      const editorListUsers = await makeRequest(app.server, {
        path: '/api/auth/users',
        headers: { 'Authorization': `Bearer ${editorToken}` }
      });
      assert.strictEqual(editorListUsers.statusCode, 200);

      const editorCreateUser = await makeRequest(app.server, {
        path: '/api/auth/users',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${editorToken}` }
      }, { username: 'illegal_user', password: 'password123' });
      assert.strictEqual(editorCreateUser.statusCode, 403);

      // 12b. Conflict-free per-card PUT /api/cards/:id & DELETE /api/cards/:id
      const putCardA = await makeRequest(app.server, {
        path: '/api/cards/card-a',
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      }, { id: 'card-a', title: 'Card A by Admin' });
      assert.strictEqual(putCardA.statusCode, 200);

      const putCardB = await makeRequest(app.server, {
        path: '/api/cards/card-b',
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${editorToken}` }
      }, { id: 'card-b', title: 'Card B by Editor' });
      assert.strictEqual(putCardB.statusCode, 200);

      const viewerPutCard = await makeRequest(app.server, {
        path: '/api/cards/card-c',
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${viewerToken}` }
      }, { id: 'card-c', title: 'Blocked' });
      assert.strictEqual(viewerPutCard.statusCode, 403);

      const cardsAfterPerCard = await makeRequest(app.server, {
        path: '/api/cards',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.ok(cardsAfterPerCard.json.some(c => c.id === 'card-a'));
      assert.ok(cardsAfterPerCard.json.some(c => c.id === 'card-b'));

      const delCardB = await makeRequest(app.server, {
        path: '/api/cards/card-b',
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${editorToken}` }
      });
      assert.strictEqual(delCardB.statusCode, 200);

      // 12c. Login brute-force rate limit (5 failed attempts -> 429 Too Many Requests)
      for (let i = 0; i < 4; i++) {
        const failRes = await makeRequest(app.server, {
          path: '/api/auth/login',
          method: 'POST'
        }, { username: 'editor1', password: 'wrong-password' });
        assert.strictEqual(failRes.statusCode, 401);
      }
      const lockedRes = await makeRequest(app.server, {
        path: '/api/auth/login',
        method: 'POST'
      }, { username: 'editor1', password: 'wrong-password' });
      assert.strictEqual(lockedRes.statusCode, 429);
      const blockedEvenIfCorrect = await makeRequest(app.server, {
        path: '/api/auth/login',
        method: 'POST'
      }, { username: 'editor1', password: 'password123' });
      assert.strictEqual(blockedEvenIfCorrect.statusCode, 429);

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

  await t.test('Selective Server -> Local Sync (/api/sync/preview and /api/sync/pull)', async () => {
    const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-sync-remote-'));
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-sync-local-'));

    const remoteApp = createServerApp({
      dbPath: ':memory:',
      authEnabled: true,
      usersFile: path.join(remoteDir, 'users.json'),
      dataFile: path.join(remoteDir, 'cards.json'),
      schemaFile: path.join(remoteDir, 'schema.json'),
      vaultDir: path.join(remoteDir, 'vault'),
      myBoardsDir: path.join(remoteDir, 'my-boards')
    });
    const localApp = createServerApp({
      dbPath: ':memory:',
      authEnabled: false,
      usersFile: path.join(localDir, 'users.json'),
      dataFile: path.join(localDir, 'cards.json'),
      schemaFile: path.join(localDir, 'schema.json'),
      vaultDir: path.join(localDir, 'vault'),
      myBoardsDir: path.join(localDir, 'my-boards')
    });

    try {
      await new Promise(resolve => remoteApp.server.listen(0, '127.0.0.1', resolve));
      await new Promise(resolve => localApp.server.listen(0, '127.0.0.1', resolve));
      const remoteUrl = `http://127.0.0.1:${remoteApp.server.address().port}`;

      // Login as default remote admin
      const loginRes = await makeRequest(remoteApp.server, { path: '/api/auth/login', method: 'POST' }, {
        username: 'admin',
        password: 'admin123'
      });
      assert.strictEqual(loginRes.statusCode, 200);
      const remoteToken = loginRes.json.token;

      await makeRequest(remoteApp.server, {
        path: '/api/cards',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${remoteToken}` }
      }, [
        { id: 'r-card-1', title: 'Remote Card One', content: 'Keep me' },
        { id: 'r-card-2', title: 'Remote Card Two', content: 'Skip me' }
      ]);

      await makeRequest(remoteApp.server, {
        path: '/api/my-cards',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${remoteToken}` }
      }, [
        { id: 'r-my-1', title: 'Remote Private Note', content: 'Secret' }
      ]);

      const sampleMd = Buffer.from('# Panduan Sync\nIsi dokumen untuk sinkronisasi.', 'utf8').toString('base64');
      const upRes = await makeRequest(remoteApp.server, {
        path: '/api/vault/upload',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${remoteToken}` }
      }, { fileName: 'Panduan-Sync.md', contentBase64: sampleMd });
      assert.strictEqual(upRes.statusCode, 201);

      // Seed local with an existing card that must NOT be overwritten
      await makeRequest(localApp.server, { path: '/api/cards', method: 'POST' }, [
        { id: 'local-only-1', title: 'Local Existing Card', content: 'Stay safe' }
      ]);

      // 1. Preview from local server
      const previewRes = await makeRequest(localApp.server, { path: '/api/sync/preview', method: 'POST' }, {
        serverUrl: remoteUrl,
        username: 'admin',
        password: 'admin123',
        allowSelfSigned: false
      });
      assert.strictEqual(previewRes.statusCode, 200);
      assert.strictEqual(previewRes.json.cards.length, 2);
      assert.strictEqual(previewRes.json.myCards.length, 1);
      assert.strictEqual(previewRes.json.vaultFiles.length, 1);
      assert.ok(previewRes.json.vaultFiles[0].size > 0);
      assert.ok(previewRes.json.vaultFiles[0].id);

      // 2. Pull only r-card-1, r-my-1, and the vault file
      const pullRes = await makeRequest(localApp.server, { path: '/api/sync/pull', method: 'POST' }, {
        serverUrl: remoteUrl,
        username: 'admin',
        password: 'admin123',
        allowSelfSigned: false,
        selectedCardIds: ['r-card-1'],
        selectedMyCardIds: ['r-my-1'],
        selectedVaultFiles: [{
          id: previewRes.json.vaultFiles[0].id,
          fileName: previewRes.json.vaultFiles[0].fileName,
          subPath: previewRes.json.vaultFiles[0].subPath
        }]
      });
      assert.strictEqual(pullRes.statusCode, 200);
      assert.strictEqual(pullRes.json.syncedCards, 1);
      assert.strictEqual(pullRes.json.syncedMyCards, 1);
      assert.strictEqual(pullRes.json.syncedVaultFiles, 1);

      // Verify local cards merged cleanly
      const localCardsAfter = await makeRequest(localApp.server, { path: '/api/cards' });
      assert.strictEqual(localCardsAfter.json.length, 2);
      assert.ok(localCardsAfter.json.some(c => c.id === 'local-only-1'));
      assert.ok(localCardsAfter.json.some(c => c.id === 'r-card-1'));
      assert.ok(!localCardsAfter.json.some(c => c.id === 'r-card-2'));

      // Verify vault file exists on local disk
      assert.ok(fs.existsSync(path.join(localDir, 'vault', 'Panduan-Sync.md')));
    } finally {
      await remoteApp.close();
      await localApp.close();
      fs.rmSync(remoteDir, { recursive: true, force: true });
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });
});
