const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { AuthManager, ROLES, PERMISSIONS } = require('../auth.js');

test('AuthManager Unit Test Suite', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-auth-test-'));
  const testUsersFile = path.join(tmpDir, 'users.json');

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('Initializes with default master admin store', () => {
    const auth = new AuthManager({ usersFile: testUsersFile, authEnabled: true });
    assert.strictEqual(fs.existsSync(testUsersFile), true);
    const users = auth.listUsers();
    assert.strictEqual(users.length, 1);
    assert.deepStrictEqual(users.map(u => u.username), ['admin']);
  });

  await t.test('Password hashing and verification', () => {
    const auth = new AuthManager({ usersFile: testUsersFile, authEnabled: true });
    const hash = auth.hashPassword('rahasia123');
    assert.ok(hash.includes(':'), 'Hash format should be salt:hash');
    assert.strictEqual(auth.verifyPassword('rahasia123', hash), true);
    assert.strictEqual(auth.verifyPassword('salah123', hash), false);
    assert.strictEqual(auth.verifyPassword('', hash), false);
    assert.strictEqual(auth.verifyPassword(null, hash), false);
  });

  await t.test('Login with valid and invalid credentials', () => {
    const auth = new AuthManager({ usersFile: testUsersFile, authEnabled: true });

    // Invalid login
    const failRes = auth.login('admin', 'wrongpass');
    assert.strictEqual(failRes.success, false);
    assert.strictEqual(failRes.token, undefined);

    // Valid login
    const successRes = auth.login('admin', 'admin123');
    assert.strictEqual(successRes.success, true);
    assert.ok(typeof successRes.token === 'string' && successRes.token.length > 20);
    assert.strictEqual(successRes.user.username, 'admin');
    assert.strictEqual(successRes.user.role, ROLES.ADMIN);

    // Authenticate request using header
    const mockReqWithHeader = {
      headers: { authorization: `Bearer ${successRes.token}` }
    };
    const authUser = auth.authenticateRequest(mockReqWithHeader);
    assert.ok(authUser !== null);
    assert.strictEqual(authUser.username, 'admin');
    assert.strictEqual(authUser.role, ROLES.ADMIN);

    // Logout
    const loggedOut = auth.logout(successRes.token);
    assert.strictEqual(loggedOut, true);
    assert.strictEqual(auth.authenticateRequest(mockReqWithHeader), null);
  });

  await t.test('Cookie-based token authentication', () => {
    const auth = new AuthManager({ usersFile: testUsersFile, authEnabled: true });
    auth.createUser({ username: 'editor', password: 'editor123', role: ROLES.EDITOR });
    const loginRes = auth.login('editor', 'editor123');
    assert.strictEqual(loginRes.success, true);

    const mockReqWithCookie = {
      headers: { cookie: `wekeepit_token=${loginRes.token}; other=value` }
    };
    const user = auth.authenticateRequest(mockReqWithCookie);
    assert.ok(user !== null);
    assert.strictEqual(user.username, 'editor');
    assert.strictEqual(user.role, ROLES.EDITOR);
  });

  await t.test('Zero-friction bypass when authEnabled is false (Desktop mode)', () => {
    const auth = new AuthManager({ usersFile: testUsersFile, authEnabled: false });
    const mockReqEmpty = { headers: {} };
    const user = auth.authenticateRequest(mockReqEmpty);
    assert.ok(user !== null);
    assert.strictEqual(user.role, ROLES.ADMIN);
    assert.strictEqual(user.authEnabled, false);
    assert.strictEqual(auth.can(user, PERMISSIONS.WRITE_CARDS), true);
    assert.strictEqual(auth.can(user, PERMISSIONS.MANAGE_USERS), true);
  });

  await t.test('Role-based permissions enforcement', () => {
    const auth = new AuthManager({ usersFile: testUsersFile, authEnabled: true });
    const admin = { username: 'admin', role: ROLES.ADMIN };
    const editor = { username: 'editor', role: ROLES.EDITOR };
    const viewer = { username: 'viewer', role: ROLES.VIEWER };

    // Admin permissions
    assert.strictEqual(auth.can(admin, PERMISSIONS.READ), true);
    assert.strictEqual(auth.can(admin, PERMISSIONS.WRITE_CARDS), true);
    assert.strictEqual(auth.can(admin, PERMISSIONS.WRITE_SCHEMA), true);
    assert.strictEqual(auth.can(admin, PERMISSIONS.MANAGE_FOLDERS), true);
    assert.strictEqual(auth.can(admin, PERMISSIONS.MANAGE_USERS), true);

    // Editor permissions
    assert.strictEqual(auth.can(editor, PERMISSIONS.READ), true);
    assert.strictEqual(auth.can(editor, PERMISSIONS.WRITE_CARDS), true);
    assert.strictEqual(auth.can(editor, PERMISSIONS.WRITE_SCHEMA), false);
    assert.strictEqual(auth.can(editor, PERMISSIONS.MANAGE_FOLDERS), false);
    assert.strictEqual(auth.can(editor, PERMISSIONS.MANAGE_USERS), false);

    // Viewer permissions
    assert.strictEqual(auth.can(viewer, PERMISSIONS.READ), true);
    assert.strictEqual(auth.can(viewer, PERMISSIONS.WRITE_CARDS), false);
    assert.strictEqual(auth.can(viewer, PERMISSIONS.WRITE_SCHEMA), false);
    assert.strictEqual(auth.can(viewer, PERMISSIONS.MANAGE_FOLDERS), false);
  });

  await t.test('User CRUD operations', () => {
    const auth = new AuthManager({ usersFile: testUsersFile, authEnabled: true });

    // Create user
    const newUser = auth.createUser({
      username: 'budi',
      password: 'passwordBudi123',
      role: ROLES.EDITOR,
      displayName: 'Budi Santoso'
    });
    assert.strictEqual(newUser.username, 'budi');
    assert.strictEqual(newUser.role, ROLES.EDITOR);

    // Verify login with new user
    const budiLogin = auth.login('budi', 'passwordBudi123');
    assert.strictEqual(budiLogin.success, true);

    // Update user
    auth.updateUser('budi', { displayName: 'Budi S. (Senior Editor)', role: ROLES.ADMIN });
    const updated = auth.getUser('budi');
    assert.strictEqual(updated.displayName, 'Budi S. (Senior Editor)');
    assert.strictEqual(updated.role, ROLES.ADMIN);

    // Delete user
    assert.strictEqual(auth.deleteUser('budi', 'admin'), true);
    assert.strictEqual(auth.getUser('budi'), null);

    // Cannot delete own admin account
    assert.throws(() => {
      auth.deleteUser('admin', 'admin');
    }, /Tidak dapat menghapus akun admin Anda sendiri/);
  });

  await t.test('Sessions persist across AuthManager restarts', () => {
    const auth1 = new AuthManager({ usersFile: testUsersFile, authEnabled: true });
    const loginRes = auth1.login('admin', 'admin123');
    assert.strictEqual(loginRes.success, true);

    // Simulate server restart by creating a new AuthManager pointing to the same users/sessions store
    const auth2 = new AuthManager({ usersFile: testUsersFile, authEnabled: true });
    const req = { headers: { authorization: `Bearer ${loginRes.token}` } };
    const restored = auth2.authenticateRequest(req);
    assert.ok(restored);
    assert.strictEqual(restored.username, 'admin');
    assert.strictEqual(restored.role, ROLES.ADMIN);

    // Logout removes session from disk too
    assert.strictEqual(auth2.logout(loginRes.token), true);
    const auth3 = new AuthManager({ usersFile: testUsersFile, authEnabled: true });
    assert.strictEqual(auth3.authenticateRequest(req), null);
  });
});
