const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getParser } = require('./parsers/index.js');

class DocumentIndexer {
  constructor(db, folderManager) {
    this.db = db;
    this.folderManager = folderManager;
    this.isIndexing = false;
    this.shouldCancel = false;
    this.currentJob = null;
    this.listeners = new Set();
  }

  onProgress(callback) {
    if (typeof callback === 'function') {
      this.listeners.add(callback);
    }
  }

  emitProgress(event) {
    for (const cb of this.listeners) {
      try { cb(event); } catch (e) {}
    }
  }

  calculateHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Index a single document record from disk
   */
  async indexSingleFile(docRecord) {
    const filePath = docRecord.path;

    if (!fs.existsSync(filePath)) {
      this.db.upsertDocument({
        ...docRecord,
        status: 'failed',
        error_message: 'Berkas tidak ditemukan pada disk'
      });
      return false;
    }

    const parser = getParser(docRecord.extension || path.extname(filePath));
    if (!parser) {
      this.db.upsertDocument({
        ...docRecord,
        status: 'failed',
        error_message: `Format ekstensi ${docRecord.extension} tidak didukung`
      });
      return false;
    }

    try {
      this.db.upsertDocument({
        ...docRecord,
        status: 'indexing',
        error_message: null
      });

      const buffer = fs.readFileSync(filePath);
      const hash = this.calculateHash(buffer);

      const parseResult = await parser.parse(filePath, buffer);
      const chunks = parseResult.chunks || [];

      // Save document metadata
      this.db.upsertDocument({
        ...docRecord,
        hash,
        size: buffer.length,
        total_chunks: chunks.length,
        status: parseResult.metadata?.isScanned ? 'scanned_notice' : 'ready',
        error_message: parseResult.metadata?.ocrNotice || null,
        indexed_at: new Date().toISOString()
      });

      // Save chunks to SQLite FTS
      this.db.saveDocumentChunks(docRecord.id, chunks);
      return true;
    } catch (err) {
      console.warn(`Gagal mengindeks ${filePath}:`, err.message);
      this.db.upsertDocument({
        ...docRecord,
        status: 'failed',
        error_message: err.message || 'Gagal mengekstrak teks dokumen',
        indexed_at: new Date().toISOString()
      });
      return false;
    }
  }

  /**
   * Reconcile and incrementally index a specific folder
   */
  async reindexFolder(folderId, progressCb) {
    if (this.isIndexing) {
      throw new Error('Proses indexing sedang berjalan. Harap tunggu hingga selesai.');
    }

    this.isIndexing = true;
    this.shouldCancel = false;

    try {
      const reconcileReport = this.folderManager.scanAndReconcile(folderId);

      // 1. Remove deleted files from DB
      for (const delDoc of reconcileReport.deleted) {
        this.db.deleteDocumentByPath(delDoc.path);
      }

      // 2. Queue added and modified files
      const toIndex = [...reconcileReport.added, ...reconcileReport.modified];
      const total = toIndex.length;
      let completed = 0;
      let failed = 0;

      this.emitProgress({
        type: 'STARTED',
        folderId,
        total,
        unchanged: reconcileReport.unchanged.length,
        deleted: reconcileReport.deleted.length
      });

      for (let i = 0; i < total; i++) {
        if (this.shouldCancel) {
          this.emitProgress({ type: 'CANCELLED', folderId, completed, total });
          break;
        }

        const doc = toIndex[i];
        this.currentJob = { filename: doc.filename, index: i + 1, total };

        this.emitProgress({
          type: 'PROGRESS',
          folderId,
          current: i + 1,
          total,
          filename: doc.filename
        });

        if (typeof progressCb === 'function') {
          progressCb({ current: i + 1, total, filename: doc.filename });
        }

        const success = await this.indexSingleFile(doc);
        if (success) {
          completed++;
        } else {
          failed++;
        }

        // Allow event loop breathing room so search/UI queries are not blocked
        await new Promise(resolve => setImmediate(resolve));
      }

      this.emitProgress({
        type: 'COMPLETED',
        folderId,
        completed,
        failed,
        total,
        unchanged: reconcileReport.unchanged.length
      });

      return {
        completed,
        failed,
        total,
        unchanged: reconcileReport.unchanged.length,
        deleted: reconcileReport.deleted.length
      };
    } finally {
      this.isIndexing = false;
      this.currentJob = null;
    }
  }

  /**
   * Reindex all enabled folders
   */
  async reindexAll(progressCb) {
    const folders = this.folderManager.listFolders().filter(f => f.enabled);
    const results = [];

    for (const folder of folders) {
      if (this.shouldCancel) break;
      const res = await this.reindexFolder(folder.id, progressCb);
      results.push({ folderId: folder.id, path: folder.path, ...res });
    }

    return results;
  }

  cancel() {
    if (this.isIndexing) {
      this.shouldCancel = true;
      return true;
    }
    return false;
  }

  getStatus() {
    return {
      isIndexing: this.isIndexing,
      currentJob: this.currentJob,
      stats: this.db.getStats()
    };
  }
}

module.exports = DocumentIndexer;
