const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_USERS_FILE = path.join(__dirname, 'users.json');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const ROLES = {
  ADMIN: 'admin',
  EDITOR: 'editor',
  VIEWER: 'viewer'
};

const PERMISSIONS = {
  READ: 'read',
  WRITE_CARDS: 'write_cards',
  WRITE_SCHEMA: 'write_schema',
  MANAGE_FOLDERS: 'manage_folders',
  MANAGE_INDEXER: 'manage_indexer',
  OPEN_FILES: 'open_files',
  MANAGE_USERS: 'manage_users'
};

const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: [
    PERMISSIONS.READ,
    PERMISSIONS.WRITE_CARDS,
    PERMISSIONS.WRITE_SCHEMA,
    PERMISSIONS.MANAGE_FOLDERS,
    PERMISSIONS.MANAGE_INDEXER,
    PERMISSIONS.OPEN_FILES,
    PERMISSIONS.MANAGE_USERS
  ],
  [ROLES.EDITOR]: [
    PERMISSIONS.READ,
    PERMISSIONS.WRITE_CARDS
  ],
  [ROLES.VIEWER]: [
    PERMISSIONS.READ
  ]
};

class AuthManager {
  constructor(options = {}) {
    this.usersFile = options.usersFile || process.env.USERS_FILE_PATH || DEFAULT_USERS_FILE;
    this.authEnabled = options.authEnabled !== undefined
      ? Boolean(options.authEnabled)
      : (process.env.AUTH_ENABLED === 'true' || process.env.AUTH_ENABLED === '1');
    this.sessions = new Map(); // token -> { username, role, displayName, expiresAt }
    this.ensureUsersStore();
  }

  isAuthEnabled() {
    return this.authEnabled;
  }

  setAuthEnabled(enabled) {
    this.authEnabled = Boolean(enabled);
  }

  hashPassword(password) {
    if (!password || typeof password !== 'string') {
      throw new Error('Password harus berupa string non-kosong.');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
  }

  verifyPassword(password, storedHash) {
    if (!password || !storedHash || typeof storedHash !== 'string') return false;
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [salt, expectedHash] = parts;
    const actualHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(actualHash, 'utf8'), Buffer.from(expectedHash, 'utf8'));
    } catch {
      return false;
    }
  }

  ensureUsersStore() {
    try {
      if (!fs.existsSync(this.usersFile)) {
        const defaultUsers = [
          {
            username: 'admin',
            passwordHash: this.hashPassword('admin123'),
            role: ROLES.ADMIN,
            displayName: 'Administrator',
            createdAt: new Date().toISOString()
          }
        ];
        this._atomicWriteUsers(defaultUsers);
      }
    } catch (err) {
      console.warn('[AuthManager] Gagal inisialisasi berkas pengguna:', err.message);
    }
  }

  loadUsers() {
    // Try primary, then .bak if primary is corrupt
    const candidates = [this.usersFile, this.usersFile + '.bak'];
    for (const candidate of candidates) {
      try {
        if (!fs.existsSync(candidate)) continue;
        const raw = fs.readFileSync(candidate, 'utf-8');
        if (!raw || !raw.trim()) continue;
        const parsed = JSON.parse(raw);
        if (candidate !== this.usersFile) {
          console.warn('[AuthManager][RECOVERY] File pengguna utama corrupt, dipulihkan dari .bak');
        }
        return parsed;
      } catch (err) {
        console.error('[AuthManager] Gagal membaca berkas pengguna:', err.message);
      }
    }
    return [];
  }

  /**
   * Atomic write for users.json — write to .tmp then rename (POSIX atomic).
   * Keeps previous file as .bak for recovery.
   */
  _atomicWriteUsers(users) {
    const resolved = path.resolve(this.usersFile);
    const dir = path.dirname(resolved);
    const tmpPath = resolved + '.tmp';
    const bakPath = resolved + '.bak';

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(tmpPath, JSON.stringify(users, null, 2), 'utf-8');

    try {
      if (fs.existsSync(resolved)) {
        fs.renameSync(resolved, bakPath);
      }
    } catch (bakErr) {
      console.warn('[AuthManager][WARN] Tidak bisa buat backup pengguna:', bakErr.message);
    }

    fs.renameSync(tmpPath, resolved);
    return true;
  }

  saveUsers(users) {
    try {
      return this._atomicWriteUsers(users);
    } catch (err) {
      console.error('[AuthManager] Gagal menyimpan berkas pengguna:', err.message);
      return false;
    }
  }

  listUsers() {
    return this.loadUsers().map(u => ({
      username: u.username,
      role: u.role,
      displayName: u.displayName || u.username,
      statusText: u.statusText || '',
      createdAt: u.createdAt
    }));
  }

  getUser(username) {
    if (!username) return null;
    const clean = String(username).trim().toLowerCase();
    const users = this.loadUsers();
    return users.find(u => u.username.toLowerCase() === clean) || null;
  }

  createUser({ username, password, role = ROLES.VIEWER, displayName }) {
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      throw new Error('Username minimal 3 karakter alfanumerik.');
    }
    const cleanUser = username.trim().toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(cleanUser)) {
      throw new Error('Username hanya boleh berisi huruf kecil, angka, tanda strip, atau garis bawah.');
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      throw new Error('Password minimal 6 karakter.');
    }
    const validRoles = [ROLES.ADMIN, ROLES.EDITOR, ROLES.VIEWER];
    if (!validRoles.includes(role)) {
      throw new Error(`Role tidak valid. Pilihan: ${validRoles.join(', ')}`);
    }

    const users = this.loadUsers();
    if (users.some(u => u.username.toLowerCase() === cleanUser)) {
      throw new Error(`Pengguna dengan username '${cleanUser}' sudah terdaftar.`);
    }

    const newUser = {
      username: cleanUser,
      passwordHash: this.hashPassword(password),
      role,
      displayName: displayName ? String(displayName).trim() : cleanUser,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    this.saveUsers(users);
    return {
      username: newUser.username,
      role: newUser.role,
      displayName: newUser.displayName,
      createdAt: newUser.createdAt
    };
  }

  updateUser(username, updates = {}) {
    const cleanUser = String(username).trim().toLowerCase();
    const users = this.loadUsers();
    const idx = users.findIndex(u => u.username.toLowerCase() === cleanUser);
    if (idx === -1) {
      throw new Error(`Pengguna '${cleanUser}' tidak ditemukan.`);
    }

    const user = users[idx];
    if (updates.password) {
      if (typeof updates.password !== 'string' || updates.password.length < 6) {
        throw new Error('Password baru minimal 6 karakter.');
      }
      user.passwordHash = this.hashPassword(updates.password);
    }

    if (updates.role) {
      const validRoles = [ROLES.ADMIN, ROLES.EDITOR, ROLES.VIEWER];
      if (!validRoles.includes(updates.role)) {
        throw new Error(`Role tidak valid. Pilihan: ${validRoles.join(', ')}`);
      }
      user.role = updates.role;
    }

    if (updates.displayName !== undefined) {
      user.displayName = String(updates.displayName).trim() || user.username;
    }

    this.saveUsers(users);
    return {
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      statusText: user.statusText || '',
      createdAt: user.createdAt
    };
  }

  updateOwnProfile(username, { displayName, statusText, currentPassword, newPassword } = {}) {
    const cleanUser = String(username || '').trim().toLowerCase();
    const users = this.loadUsers();
    const idx = users.findIndex(u => u.username.toLowerCase() === cleanUser);
    if (idx === -1) {
      throw new Error(`Pengguna '${cleanUser}' tidak ditemukan.`);
    }

    const user = users[idx];

    if (newPassword !== undefined && newPassword !== '') {
      if (!currentPassword || !this.verifyPassword(currentPassword, user.passwordHash)) {
        throw new Error('Password lama tidak sesuai.');
      }
      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        throw new Error('Password baru minimal 6 karakter.');
      }
      user.passwordHash = this.hashPassword(newPassword);
    }

    if (displayName !== undefined) {
      user.displayName = String(displayName).trim().slice(0, 60) || user.username;
    }

    if (statusText !== undefined) {
      user.statusText = String(statusText).trim().slice(0, 60);
    }

    this.saveUsers(users);

    // Sync active in-memory sessions for this user
    for (const session of this.sessions.values()) {
      if (session.username.toLowerCase() === cleanUser) {
        session.displayName = user.displayName;
        session.statusText = user.statusText || '';
      }
    }

    return {
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      statusText: user.statusText || ''
    };
  }

  deleteUser(username, currentAdminUsername) {
    const cleanUser = String(username).trim().toLowerCase();
    if (currentAdminUsername && cleanUser === String(currentAdminUsername).trim().toLowerCase()) {
      throw new Error('Tidak dapat menghapus akun admin Anda sendiri.');
    }

    const users = this.loadUsers();
    const filtered = users.filter(u => u.username.toLowerCase() !== cleanUser);
    if (filtered.length === users.length) {
      throw new Error(`Pengguna '${cleanUser}' tidak ditemukan.`);
    }

    // Pastikan setidaknya masih ada 1 akun admin
    const remainingAdmins = filtered.filter(u => u.role === ROLES.ADMIN);
    if (remainingAdmins.length === 0) {
      throw new Error('Tidak dapat menghapus admin terakhir. Sistem harus memiliki minimal 1 Administrator.');
    }

    this.saveUsers(filtered);
    return true;
  }

  login(username, password) {
    const user = this.getUser(username);
    if (!user) {
      return { success: false, error: 'Username atau password tidak sesuai.' };
    }

    if (!this.verifyPassword(password, user.passwordHash)) {
      return { success: false, error: 'Username atau password tidak sesuai.' };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const session = {
      token,
      username: user.username,
      role: user.role,
      displayName: user.displayName || user.username,
      expiresAt: Date.now() + SESSION_TTL_MS
    };

    this.sessions.set(token, session);

    return {
      success: true,
      token,
      user: {
        username: user.username,
        role: user.role,
        displayName: user.displayName || user.username
      }
    };
  }

  logout(token) {
    if (token && this.sessions.has(token)) {
      this.sessions.delete(token);
      return true;
    }
    return false;
  }

  extractToken(req) {
    // 1. Authorization header: "Bearer <token>"
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }

    // 2. Cookie header: "token=<token>"
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)wekeepit_token=([^;]+)/);
      if (match) {
        return decodeURIComponent(match[1].trim());
      }
      const legacyMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
      if (legacyMatch) {
        return decodeURIComponent(legacyMatch[1].trim());
      }
    }

    return null;
  }

  authenticateRequest(req) {
    // Desktop / Local Mode: bypass authentication if auth is disabled
    if (!this.authEnabled) {
      return {
        username: 'local-owner',
        role: ROLES.ADMIN,
        displayName: 'Local Owner',
        authEnabled: false
      };
    }

    const token = this.extractToken(req);
    if (!token) return null;

    const session = this.sessions.get(token);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }

    return {
      username: session.username,
      role: session.role,
      displayName: session.displayName,
      authEnabled: true
    };
  }

  hasPermission(role, permission) {
    const permissions = ROLE_PERMISSIONS[role] || [];
    return permissions.includes(permission);
  }

  can(user, permission) {
    if (!this.authEnabled) return true; // Full access on desktop
    if (!user || !user.role) return false;
    return this.hasPermission(user.role, permission);
  }
}

module.exports = {
  AuthManager,
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS
};
