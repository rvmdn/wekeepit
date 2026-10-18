const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DEFAULT_DB_PATH = path.resolve(__dirname, '..', 'wekeepit-index.db');

function isTestEnvironment() {
  return process.env.NODE_ENV === 'test' ||
    process.env.TEST_MODE === '1' ||
    process.argv.some(arg => typeof arg === 'string' && (arg.includes('test') || arg === '--test'));
}

function auditPathComponents(resolved) {
  // Build ancestor chain from filesystem root to resolved path
  const chain = [];
  let curr = resolved;
  while (true) {
    chain.unshift(curr);
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  let lastExistingCanonical = null;
  let firstMissingIndex = -1;

  for (let i = 0; i < chain.length; i++) {
    const comp = chain[i];
    let lst;
    try {
      lst = fs.lstatSync(comp, { throwIfNoEntry: false });
    } catch (err) {
      const wrapErr = new Error(`Inaccessible path component '${comp}': ${err.message}`);
      wrapErr.code = err.code || 'EACCES';
      throw wrapErr;
    }

    if (lst) {
      if (firstMissingIndex !== -1) {
        const stateErr = new Error(`Discontinuous path component '${comp}' after missing parent`);
        stateErr.code = 'ENOENT';
        throw stateErr;
      }

      if (lst.isSymbolicLink()) {
        try {
          const real = fs.realpathSync(comp);
          lastExistingCanonical = real;
        } catch (symErr) {
          if (symErr.code === 'ENOENT') {
            const brokenErr = new Error(`Broken or unresolvable symbolic link for path: '${comp}'`);
            brokenErr.code = 'ELOOP';
            throw brokenErr;
          }
          throw symErr;
        }
      } else {
        lastExistingCanonical = fs.realpathSync(comp);
      }
    } else {
      if (firstMissingIndex === -1) {
        firstMissingIndex = i;
      }
    }
  }

  if (!lastExistingCanonical) {
    const ancestorErr = new Error(`Inaccessible parent directory or ancestor for path: '${resolved}'`);
    ancestorErr.code = 'ENOENT';
    throw ancestorErr;
  }

  const remainingSegments = firstMissingIndex === -1 ? [] : chain.slice(firstMissingIndex).map(c => path.basename(c));
  const canonicalPath = remainingSegments.length === 0 ? lastExistingCanonical : path.join(lastExistingCanonical, ...remainingSegments);
  return {
    canonicalParent: lastExistingCanonical,
    remainingSegments,
    canonicalPath
  };
}

function findExistingAncestor(targetPath) {
  const audited = auditPathComponents(targetPath);
  return {
    existingAncestor: audited.canonicalParent,
    remainingSegments: audited.remainingSegments
  };
}

function isPathCaseInsensitive(p) {
  if (!p || typeof p !== 'string') {
    throw new TypeError('Invalid path argument for case-sensitivity probe: path must be a non-empty string');
  }
  const resolved = path.resolve(p);
  const { existingAncestor } = findExistingAncestor(resolved);
  if (!existingAncestor) {
    throw new Error(`Case-sensitivity probe failed: no accessible ancestor directory found for '${resolved}'`);
  }

  let dir = existingAncestor;
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) dir = path.dirname(dir);
  } catch (err) {
    throw new Error(`Case-sensitivity probe failed to stat ancestor directory '${dir}': ${err.message}`);
  }

  let curr = dir;
  while (curr) {
    const parent = path.dirname(curr);
    const base = path.basename(curr);
    if (base && /[a-zA-Z]/.test(base) && parent !== curr) {
      let s1;
      try {
        s1 = fs.statSync(curr);
      } catch (err) {
        throw new Error(`Case-sensitivity probe failed to stat directory '${curr}': ${err.message}`);
      }
      const toggled = base === base.toLowerCase() ? base.toUpperCase() : base.toLowerCase();
      const testPath = path.join(parent, toggled);
      let s2;
      try {
        s2 = fs.statSync(testPath);
      } catch (err) {
        if (err.code === 'ENOENT') {
          return false;
        }
        throw new Error(`Case-sensitivity probe failed to stat test path '${testPath}': ${err.message}`);
      }
      if (s1.dev === s2.dev && s1.ino === s2.ino) {
        return true;
      } else {
        return false;
      }
    }
    if (parent === curr) break;
    curr = parent;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    throw new Error(`Case-sensitivity probe failed to read directory entries in '${dir}': ${err.message}`);
  }
  for (const entry of entries) {
    if (/[a-zA-Z]/.test(entry)) {
      const entryPath = path.join(dir, entry);
      let s1;
      try {
        s1 = fs.statSync(entryPath);
      } catch (err) {
        throw new Error(`Case-sensitivity probe failed to stat entry '${entryPath}': ${err.message}`);
      }
      const toggled = entry === entry.toLowerCase() ? entry.toUpperCase() : entry.toLowerCase();
      const testPath = path.join(dir, toggled);
      let s2;
      try {
        s2 = fs.statSync(testPath);
      } catch (err) {
        if (err.code === 'ENOENT') return false;
        throw new Error(`Case-sensitivity probe failed to stat test entry '${testPath}': ${err.message}`);
      }
      if (s1.dev === s2.dev && s1.ino === s2.ino) {
        return true;
      } else {
        return false;
      }
    }
  }

  throw new Error(`Unable to determine filesystem case sensitivity: no alphabetical path segment or entry found for '${resolved}'`);
}

function canonicalizeDbPath(p) {
  if (!p || p === ':memory:') return null;
  const resolved = path.resolve(p);

  let canonical;
  try {
    canonical = fs.realpathSync(resolved);
  } catch (err) {
    if (err.code === 'ENOENT') {
      const audited = auditPathComponents(resolved);
      canonical = audited.canonicalPath;
    } else {
      throw err;
    }
  }

  canonical = path.normalize(canonical);
  const probeFn = (typeof IndexDB !== 'undefined' && typeof IndexDB.isPathCaseInsensitive === 'function')
    ? IndexDB.isPathCaseInsensitive
    : isPathCaseInsensitive;
  if (probeFn(canonical)) {
    canonical = canonical.toLowerCase();
  }
  return canonical;
}

let injectedProtectedDefaultDbPath = null;

function setProtectedDefaultDbPathForTest(p) {
  if (!isTestEnvironment()) {
    throw new Error('Injecting protected default db path is only permitted in test environment');
  }
  injectedProtectedDefaultDbPath = p ? path.resolve(p) : null;
}

function clearProtectedDefaultDbPathForTest() {
  injectedProtectedDefaultDbPath = null;
}

function isDefaultDbPath(candidatePath, customDefault = null) {
  if (!candidatePath || candidatePath === ':memory:') {
    return false;
  }
  let cand;
  try {
    cand = canonicalizeDbPath(candidatePath);
  } catch (err) {
    // When canonical equivalence cannot be established safely (e.g. permission error,
    // symlink failure, or inaccessible parent directory), FAIL CLOSED:
    // the guard must not permit a potentially protected path to be opened.
    throw new Error(`[Security Violation] Canonical path equivalence cannot be established safely for candidate '${candidatePath}': ${err.message}`);
  }

  const targets = [DEFAULT_DB_PATH];
  if (customDefault) {
    targets.push(customDefault);
  } else if (injectedProtectedDefaultDbPath) {
    targets.push(injectedProtectedDefaultDbPath);
  }

  for (const target of targets) {
    let def;
    try {
      def = canonicalizeDbPath(target);
    } catch (err) {
      // Finding 1: Remove unsafe lexical fallback!
      // If canonicalization of a protected target cannot be established reliably,
      // reject the database open with an explicit Security Violation. Do not allow a failed target canonicalization
      // to become a non-match.
      throw new Error(`[Security Violation] Canonical path equivalence cannot be established safely for protected target '${target}': ${err.message}`);
    }
    if (cand !== null && def !== null && cand === def) {
      return true;
    }
  }
  return false;
}

class IndexDB {
  constructor(dbPath, options = {}) {
    const isTest = isTestEnvironment();
    const customDefault = (isTest && (options.defaultDbPath || injectedProtectedDefaultDbPath))
      ? path.resolve(options.defaultDbPath || injectedProtectedDefaultDbPath)
      : null;
    const effectiveDefault = customDefault || DEFAULT_DB_PATH;

    // 1. Selesaikan resolusi path efektif terlebih dahulu
    let effectivePath;
    if (dbPath !== undefined && dbPath !== null) {
      effectivePath = dbPath;
    } else if (process.env.INDEX_DB_PATH) {
      effectivePath = process.env.INDEX_DB_PATH;
    } else if (isTest && !customDefault) {
      effectivePath = ':memory:';
    } else {
      effectivePath = effectiveDefault;
    }

    // 2. Dalam lingkungan test, tolak akses ke database default melalui seluruh jalur resolusi
    if (isTest) {
      if (isDefaultDbPath(effectivePath, DEFAULT_DB_PATH)) {
        throw new Error(`[Security Violation] Direct access to default database '${DEFAULT_DB_PATH}' is strictly prohibited during test execution.`);
      }
      if (customDefault && isDefaultDbPath(effectivePath, customDefault)) {
        throw new Error(`[Security Violation] Direct access to protected default database '${customDefault}' is strictly prohibited during test execution.`);
      }
    }

    this.dbPath = effectivePath;
    this.db = null;
    this.init();
  }

  init() {
    // If not in-memory, ensure parent directory exists
    if (this.dbPath !== ':memory:') {
      const dir = path.dirname(path.resolve(this.dbPath));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(this.dbPath);
    // Enable WAL mode for high concurrency & performance
    if (this.dbPath !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('foreign_keys = ON');

    this.applyMigrations();
  }

  applyMigrations() {
    // Schema version table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const row = this.db.prepare('SELECT MAX(version) as max_version FROM schema_migrations').get();
    const currentVersion = (row && row.max_version) || 0;

    if (currentVersion < 1) {
      this.migrateToV1();
    }
  }

  migrateToV1() {
    const tx = this.db.transaction(() => {
      // 1. Folders table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS indexed_folders (
          id TEXT PRIMARY KEY,
          path TEXT UNIQUE NOT NULL,
          recursive INTEGER NOT NULL DEFAULT 1,
          enabled INTEGER NOT NULL DEFAULT 1,
          excluded_patterns TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          last_scanned_at TEXT
        );
      `);

      // 2. Documents table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          folder_id TEXT NOT NULL,
          path TEXT UNIQUE NOT NULL,
          filename TEXT NOT NULL,
          extension TEXT NOT NULL,
          size INTEGER NOT NULL,
          mtime INTEGER NOT NULL,
          hash TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          error_message TEXT,
          indexed_at TEXT,
          total_chunks INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (folder_id) REFERENCES indexed_folders(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_docs_folder_id ON documents(folder_id);
        CREATE INDEX IF NOT EXISTS idx_docs_status ON documents(status);
        CREATE INDEX IF NOT EXISTS idx_docs_ext ON documents(extension);
      `);

      // 3. Document chunks table (fine-grained sentence/paragraph/page/cell unit)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS document_chunks (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          location_type TEXT NOT NULL,
          location_label TEXT NOT NULL,
          content TEXT NOT NULL,
          clean_content TEXT NOT NULL,
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON document_chunks(document_id);
      `);

      // 4. FTS5 Virtual Table for chunks
      try {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
            content,
            location_label,
            clean_content,
            tokenize = 'unicode61 remove_diacritics 2'
          );
        `);
        this.hasFTS5 = true;
      } catch (ftsErr) {
        console.warn('FTS5 table creation warning:', ftsErr.message);
        this.hasFTS5 = false;
      }

      this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(1, new Date().toISOString());
    });

    tx();
  }

  // --- Folder Queries ---
  insertFolder(folder) {
    const stmt = this.db.prepare(`
      INSERT INTO indexed_folders (id, path, recursive, enabled, excluded_patterns, created_at, last_scanned_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      folder.id,
      folder.path,
      folder.recursive ? 1 : 0,
      folder.enabled ? 1 : 0,
      JSON.stringify(folder.excluded_patterns || []),
      folder.created_at || new Date().toISOString(),
      folder.last_scanned_at || null
    );
  }

  getAllFolders() {
    const rows = this.db.prepare('SELECT * FROM indexed_folders ORDER BY created_at DESC').all();
    return rows.map(r => ({
      ...r,
      recursive: Boolean(r.recursive),
      enabled: Boolean(r.enabled),
      excluded_patterns: JSON.parse(r.excluded_patterns || '[]')
    }));
  }

  getFolderById(id) {
    const r = this.db.prepare('SELECT * FROM indexed_folders WHERE id = ?').get(id);
    if (!r) return null;
    return {
      ...r,
      recursive: Boolean(r.recursive),
      enabled: Boolean(r.enabled),
      excluded_patterns: JSON.parse(r.excluded_patterns || '[]')
    };
  }

  getFolderByPath(folderPath) {
    const r = this.db.prepare('SELECT * FROM indexed_folders WHERE path = ?').get(folderPath);
    if (!r) return null;
    return {
      ...r,
      recursive: Boolean(r.recursive),
      enabled: Boolean(r.enabled),
      excluded_patterns: JSON.parse(r.excluded_patterns || '[]')
    };
  }

  updateFolderStatus(id, enabled) {
    return this.db.prepare('UPDATE indexed_folders SET enabled = ? WHERE id = ?')
      .run(enabled ? 1 : 0, id);
  }

  updateFolderExclusions(id, excludedPatterns) {
    return this.db.prepare('UPDATE indexed_folders SET excluded_patterns = ? WHERE id = ?')
      .run(JSON.stringify(excludedPatterns || []), id);
  }

  updateFolderLastScanned(id) {
    return this.db.prepare('UPDATE indexed_folders SET last_scanned_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  deleteFolder(id) {
    const tx = this.db.transaction(() => {
      // Find all chunk rowids associated with documents in this folder
      const chunks = this.db.prepare(`
        SELECT c.rowid FROM document_chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE d.folder_id = ?
      `).all(id);

      if (this.hasFTS5 && chunks.length > 0) {
        const delFts = this.db.prepare('DELETE FROM document_chunks_fts WHERE rowid = ?');
        for (const chk of chunks) {
          delFts.run(chk.rowid);
        }
      }

      this.db.prepare(`
        DELETE FROM document_chunks WHERE document_id IN (
          SELECT id FROM documents WHERE folder_id = ?
        )
      `).run(id);
      this.db.prepare('DELETE FROM documents WHERE folder_id = ?').run(id);
      this.db.prepare('DELETE FROM indexed_folders WHERE id = ?').run(id);
    });
    return tx();
  }

  // --- Document Queries ---
  upsertDocument(doc) {
    const stmt = this.db.prepare(`
      INSERT INTO documents (
        id, folder_id, path, filename, extension, size, mtime, hash, status, error_message, indexed_at, total_chunks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        folder_id = excluded.folder_id,
        filename = excluded.filename,
        extension = excluded.extension,
        size = excluded.size,
        mtime = excluded.mtime,
        hash = excluded.hash,
        status = excluded.status,
        error_message = excluded.error_message,
        indexed_at = excluded.indexed_at,
        total_chunks = excluded.total_chunks
    `);

    return stmt.run(
      doc.id,
      doc.folder_id,
      doc.path,
      doc.filename,
      doc.extension,
      doc.size,
      doc.mtime,
      doc.hash || null,
      doc.status || 'pending',
      doc.error_message || null,
      doc.indexed_at || null,
      doc.total_chunks || 0
    );
  }

  getDocumentByPath(docPath) {
    return this.db.prepare('SELECT * FROM documents WHERE path = ?').get(docPath) || null;
  }

  getDocumentsByFolder(folderId) {
    return this.db.prepare('SELECT * FROM documents WHERE folder_id = ?').all(folderId);
  }

  getAllDocuments() {
    return this.db.prepare('SELECT * FROM documents ORDER BY indexed_at DESC').all();
  }

  deleteDocumentByPath(docPath) {
    const doc = this.getDocumentByPath(docPath);
    if (!doc) return false;

    const tx = this.db.transaction(() => {
      if (this.hasFTS5) {
        const oldChunks = this.db.prepare('SELECT rowid FROM document_chunks WHERE document_id = ?').all(doc.id);
        const delFts = this.db.prepare('DELETE FROM document_chunks_fts WHERE rowid = ?');
        for (const oc of oldChunks) {
          delFts.run(oc.rowid);
        }
      }

      this.db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(doc.id);
      this.db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
    });
    tx();
    return true;
  }

  checkIntegrity() {
    const pragmaCheck = this.db.pragma('integrity_check');
    const isOk = Array.isArray(pragmaCheck) && pragmaCheck.length === 1 && pragmaCheck[0].integrity_check === 'ok';
    
    let ftsCount = 0;
    if (this.hasFTS5) {
      try {
        const row = this.db.prepare('SELECT COUNT(*) as cnt FROM document_chunks_fts').get();
        ftsCount = row ? row.cnt : 0;
      } catch (e) {
        ftsCount = -1;
      }
    }
    const chunkCount = this.db.prepare('SELECT COUNT(*) as cnt FROM document_chunks').get().cnt;

    return {
      sqliteIntegrity: isOk ? 'ok' : JSON.stringify(pragmaCheck),
      chunkCount,
      ftsCount,
      isFtsInSync: !this.hasFTS5 || ftsCount === chunkCount
    };
  }

  rebuildFts() {
    if (!this.hasFTS5) return false;
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM document_chunks_fts').run();
      this.db.prepare(`
        INSERT INTO document_chunks_fts (rowid, content, location_label, clean_content)
        SELECT rowid, content, location_label, clean_content FROM document_chunks
      `).run();
    });
    tx();
    return true;
  }

  // --- Document Chunks & FTS ---
  saveDocumentChunks(documentId, chunks) {
    const deleteOldChunks = this.db.prepare('DELETE FROM document_chunks WHERE document_id = ?');
    const insertChunk = this.db.prepare(`
      INSERT INTO document_chunks (
        id, document_id, chunk_index, location_type, location_label, content, clean_content
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const hasFts = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='document_chunks_fts'").get();
    let insertFts = null;
    if (hasFts) {
      insertFts = this.db.prepare(`
        INSERT INTO document_chunks_fts (rowid, content, location_label, clean_content)
        VALUES (?, ?, ?, ?)
      `);
    }

    const tx = this.db.transaction(() => {
      // If FTS exists, remove old chunk rowids
      if (hasFts) {
        const oldChunks = this.db.prepare('SELECT rowid FROM document_chunks WHERE document_id = ?').all(documentId);
        const delFts = this.db.prepare('DELETE FROM document_chunks_fts WHERE rowid = ?');
        for (const oc of oldChunks) {
          delFts.run(oc.rowid);
        }
      }

      deleteOldChunks.run(documentId);

      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const chunkId = `chk-${documentId}-${i}`;
        const clean = (c.content || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const locType = c.location_type || c.locationType || 'para';
        const locLabel = c.location_label || c.locationLabel || '';
        const res = insertChunk.run(
          chunkId,
          documentId,
          i,
          locType,
          locLabel,
          c.content || '',
          clean
        );

        if (hasFts && insertFts) {
          insertFts.run(res.lastInsertRowid, c.content || '', locLabel, clean);
        }
      }

      this.db.prepare('UPDATE documents SET total_chunks = ?, status = ?, indexed_at = ? WHERE id = ?')
        .run(chunks.length, 'ready', new Date().toISOString(), documentId);
    });

    tx();
  }

  getDocumentChunks(documentId) {
    return this.db.prepare('SELECT * FROM document_chunks WHERE document_id = ? ORDER BY chunk_index ASC').all(documentId);
  }

  getStats() {
    const totalFolders = this.db.prepare('SELECT COUNT(*) as cnt FROM indexed_folders').get().cnt;
    const totalDocs = this.db.prepare('SELECT COUNT(*) as cnt FROM documents').get().cnt;
    const readyDocs = this.db.prepare("SELECT COUNT(*) as cnt FROM documents WHERE status = 'ready'").get().cnt;
    const failedDocs = this.db.prepare("SELECT COUNT(*) as cnt FROM documents WHERE status = 'failed'").get().cnt;
    const totalChunks = this.db.prepare('SELECT COUNT(*) as cnt FROM document_chunks').get().cnt;

    return {
      totalFolders,
      totalDocs,
      readyDocs,
      failedDocs,
      totalChunks
    };
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

IndexDB.DEFAULT_DB_PATH = DEFAULT_DB_PATH;
IndexDB.canonicalizeDbPath = canonicalizeDbPath;
IndexDB.isDefaultDbPath = isDefaultDbPath;
IndexDB.isTestEnvironment = isTestEnvironment;
IndexDB.isPathCaseInsensitive = isPathCaseInsensitive;
IndexDB.auditPathComponents = auditPathComponents;
IndexDB.setProtectedDefaultDbPathForTest = setProtectedDefaultDbPathForTest;
IndexDB.clearProtectedDefaultDbPathForTest = clearProtectedDefaultDbPathForTest;

module.exports = IndexDB;
