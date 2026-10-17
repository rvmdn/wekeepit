const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUPPORTED_EXTENSIONS = new Set(['.md', '.pdf', '.docx', '.xlsx']);
const DEFAULT_EXCLUSIONS = ['.git', 'node_modules', 'bin', 'obj', '.vs', '.gemini', 'AppData', '$RECYCLE.BIN', 'temp', 'tmp'];

class FolderManager {
  constructor(db) {
    this.db = db;
    this.watchers = new Map(); // folderId -> FSWatcher
    this.appRoot = path.resolve(__dirname, '..');
  }

  isSystemOrAppDirectory(targetPath) {
    const resolved = path.resolve(targetPath);
    // Disallow indexing app root directly
    if (resolved.toLowerCase() === this.appRoot.toLowerCase()) {
      return true;
    }
    // Disallow drive roots like C:\ or E:\
    const parsed = path.parse(resolved);
    if (parsed.root.toLowerCase() === resolved.toLowerCase()) {
      return true;
    }
    // Disallow Windows system directories
    const winDir = process.env.WINDIR || 'C:\\Windows';
    if (resolved.toLowerCase().startsWith(winDir.toLowerCase())) {
      return true;
    }
    return false;
  }

  addFolder(folderPath, options = {}) {
    if (!folderPath || typeof folderPath !== 'string') {
      throw new Error('Path folder wajib diisi');
    }

    const resolved = path.resolve(folderPath.trim());

    if (!fs.existsSync(resolved)) {
      throw new Error(`Folder tidak ditemukan: ${resolved}`);
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`Path bukan merupakan direktori: ${resolved}`);
    }

    if (this.isSystemOrAppDirectory(resolved)) {
      throw new Error(`Tidak diperbolehkan mengindeks direktori sistem atau aplikasi: ${resolved}`);
    }

    const existing = this.db.getFolderByPath(resolved);
    if (existing) {
      return existing;
    }

    const id = 'fld-' + crypto.randomUUID();
    const folderRecord = {
      id,
      path: resolved,
      recursive: options.recursive !== false,
      enabled: options.enabled !== false,
      excluded_patterns: Array.isArray(options.excluded_patterns)
        ? options.excluded_patterns
        : DEFAULT_EXCLUSIONS,
      created_at: new Date().toISOString()
    };

    this.db.insertFolder(folderRecord);
    return folderRecord;
  }

  removeFolder(folderId) {
    this.stopWatcher(folderId);
    return this.db.deleteFolder(folderId);
  }

  toggleFolder(folderId, enabled) {
    if (!enabled) {
      this.stopWatcher(folderId);
    }
    return this.db.updateFolderStatus(folderId, enabled);
  }

  updateFolderExclusions(folderId, excludedPatterns) {
    return this.db.updateFolderExclusions(folderId, excludedPatterns);
  }

  listFolders() {
    return this.db.getAllFolders();
  }

  isExcluded(itemPath, basePath, exclusions) {
    const rel = basePath ? path.relative(basePath, itemPath) : itemPath;
    if (!rel || rel === '.') return false;
    const norm = rel.toLowerCase().replace(/\\/g, '/');
    const parts = norm.split('/');

    for (const pat of exclusions) {
      const cleanPat = pat.toLowerCase().trim().replace(/\\/g, '/');
      if (!cleanPat) continue;

      // Direct segment match inside the indexed folder
      if (parts.includes(cleanPat)) return true;
      // Wildcard extension match (e.g. *.tmp)
      if (cleanPat.startsWith('*.')) {
        const ext = cleanPat.slice(1);
        if (norm.endsWith(ext)) return true;
      } else if (norm.includes('/' + cleanPat + '/') || norm.endsWith('/' + cleanPat) || norm === cleanPat) {
        return true;
      }
    }
    return false;
  }

  /**
   * Scans a folder on disk and reconciles against existing documents in the database.
   * Returns: { folder, added: [], modified: [], deleted: [], unchanged: [] }
   */
  scanAndReconcile(folderId) {
    const folder = this.db.getFolderById(folderId);
    if (!folder) {
      throw new Error(`Folder dengan ID ${folderId} tidak ditemukan`);
    }

    if (!fs.existsSync(folder.path)) {
      // Mark all existing documents as stale / failed if folder missing
      const existingDocs = this.db.getDocumentsByFolder(folderId);
      for (const d of existingDocs) {
        this.db.upsertDocument({
          ...d,
          status: 'stale',
          error_message: 'Folder induk tidak ditemukan pada disk'
        });
      }
      return { folder, added: [], modified: [], deleted: existingDocs, unchanged: [] };
    }

    const currentDocsMap = new Map();
    const existingList = this.db.getDocumentsByFolder(folderId);
    for (const doc of existingList) {
      currentDocsMap.set(doc.path.toLowerCase(), doc);
    }

    const diskFiles = [];
    const visitedDirs = new Set();
    let folderReal = folder.path;
    try {
      folderReal = fs.realpathSync(folder.path).toLowerCase();
    } catch (e) {
      folderReal = path.resolve(folder.path).toLowerCase();
    }
    visitedDirs.add(folderReal);

    const walk = (dirPath, depth = 0) => {
      if (depth > 25) return; // Prevent excessive directory nesting
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);

          if (this.isExcluded(fullPath, folder.path, folder.excluded_patterns)) {
            continue;
          }

          let isDir = entry.isDirectory();
          let isFile = entry.isFile();

          if (entry.isSymbolicLink()) {
            try {
              const real = fs.realpathSync(fullPath);
              const realLower = real.toLowerCase();
              // Prevent escaping the folder root via symlink
              if (!realLower.startsWith(folderReal + path.sep) && realLower !== folderReal) {
                continue;
              }
              const st = fs.statSync(fullPath);
              isDir = st.isDirectory();
              isFile = st.isFile();
            } catch {
              continue;
            }
          }

          if (isDir) {
            if (folder.recursive) {
              try {
                const realDir = fs.realpathSync(fullPath).toLowerCase();
                if (visitedDirs.has(realDir)) continue;
                visitedDirs.add(realDir);
                walk(fullPath, depth + 1);
              } catch {
                // Skip unresolvable directory
              }
            }
          } else if (isFile) {
            const ext = path.extname(entry.name).toLowerCase();
            if (SUPPORTED_EXTENSIONS.has(ext)) {
              try {
                const stat = fs.statSync(fullPath);
                diskFiles.push({
                  path: fullPath,
                  filename: entry.name,
                  extension: ext,
                  size: stat.size,
                  mtime: Math.floor(stat.mtimeMs)
                });
              } catch (e) {
                // file may have been locked or deleted during walk
              }
            }
          }
        }
      } catch (err) {
        console.warn(`Gagal membaca direktori ${dirPath}:`, err.message);
      }
    };

    walk(folder.path);

    const added = [];
    const modified = [];
    const unchanged = [];
    const seenPaths = new Set();

    for (const file of diskFiles) {
      const lower = file.path.toLowerCase();
      seenPaths.add(lower);
      const existing = currentDocsMap.get(lower);

      if (!existing) {
        const id = 'doc-' + crypto.randomUUID();
        added.push({
          id,
          folder_id: folder.id,
          path: file.path,
          filename: file.filename,
          extension: file.extension,
          size: file.size,
          mtime: file.mtime,
          status: 'pending'
        });
      } else if (existing.size !== file.size || existing.mtime !== file.mtime || existing.status === 'failed') {
        modified.push({
          ...existing,
          size: file.size,
          mtime: file.mtime,
          status: 'pending'
        });
      } else {
        unchanged.push(existing);
      }
    }

    const deleted = [];
    for (const [lowerPath, doc] of currentDocsMap.entries()) {
      if (!seenPaths.has(lowerPath)) {
        deleted.push(doc);
      }
    }

    this.db.updateFolderLastScanned(folderId);

    return {
      folder,
      added,
      modified,
      deleted,
      unchanged
    };
  }

  /**
   * Start a debounced filesystem watcher for a folder
   */
  startWatcher(folderId, onChangeCallback) {
    if (this.watchers.has(folderId)) return;

    const folder = this.db.getFolderById(folderId);
    if (!folder || !folder.enabled || !fs.existsSync(folder.path)) return;

    let debounceTimer = null;
    try {
      const watcher = fs.watch(folder.path, { recursive: folder.recursive }, (eventType, filename) => {
        if (!filename) return;
        const ext = path.extname(filename).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (typeof onChangeCallback === 'function') {
            onChangeCallback(folderId, eventType, filename);
          }
        }, 800);
      });

      watcher.on('error', (err) => {
        console.warn(`Watcher error for folder ${folderId}:`, err.message);
        this.stopWatcher(folderId);
      });

      this.watchers.set(folderId, watcher);
    } catch (err) {
      console.warn(`Filesystem watcher unsupported or failed for ${folder.path}:`, err.message);
    }
  }

  stopWatcher(folderId) {
    const watcher = this.watchers.get(folderId);
    if (watcher) {
      try { watcher.close(); } catch (e) {}
      this.watchers.delete(folderId);
    }
  }

  stopAllWatchers() {
    for (const [id, watcher] of this.watchers.entries()) {
      try { watcher.close(); } catch (e) {}
    }
    this.watchers.clear();
  }
}

module.exports = {
  FolderManager,
  SUPPORTED_EXTENSIONS,
  DEFAULT_EXCLUSIONS
};
