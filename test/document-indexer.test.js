const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const IndexDB = require('../indexer/db.js');
const { FolderManager } = require('../indexer/folder-manager.js');
const DocumentIndexer = require('../indexer/document-indexer.js');
const SearchEngine = require('../indexer/search-engine.js');
const XLSX = require('../lib/xlsx.mini.min.js');

describe('DocumentIndexer & Benchmark Suite', () => {
  let db;
  let folderManager;
  let indexer;
  let searchEngine;
  let tempDir;

  before(() => {
    db = new IndexDB(':memory:');
    folderManager = new FolderManager(db);
    indexer = new DocumentIndexer(db, folderManager);
    searchEngine = new SearchEngine(db);

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-indexer-test-'));

    // 1. Valid markdown file
    fs.writeFileSync(
      path.join(tempDir, 'valid1.md'),
      '# Panduan Penggunaan\n\nWeKeepIt lebih cocok sebagai personal work information board.\nPencarian lokal sangat cepat.'
    );

    // 2. Corrupted file with .docx extension
    fs.writeFileSync(
      path.join(tempDir, 'corrupt.docx'),
      Buffer.from('this is not a valid zip archive or docx file')
    );

    // 3. Empty file with .md extension (0 bytes)
    fs.writeFileSync(
      path.join(tempDir, 'empty.md'),
      ''
    );

    // 4. Valid XLSX spreadsheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Kode', 'Nama Fitur', 'Keterangan'],
      ['WK-01', 'Work Board', 'Papan kerja untuk menyimpan informasi kecil'],
      ['WK-02', 'Document Search', 'Pencarian full-text dalam dokumen lokal']
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Fitur');
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    fs.writeFileSync(path.join(tempDir, 'valid2.xlsx'), xlsxBuffer);
  });

  after(() => {
    folderManager.stopAllWatchers();
    db.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {}
  });

  test('Single file failure (corrupt file) must not stop or crash indexing of remaining files', async () => {
    const folder = folderManager.addFolder(tempDir, { recursive: false });
    const progressEvents = [];

    indexer.onProgress((ev) => {
      progressEvents.push(ev);
    });

    const result = await indexer.reindexFolder(folder.id);

    // Verify summary: 4 files scanned
    assert.equal(result.total, 4);
    assert.ok(result.completed >= 3, 'Valid files (valid1.md, empty.md, valid2.xlsx) should complete');
    assert.equal(result.failed, 1, 'Corrupted file corrupt.docx should be marked as failed');

    // Verify corrupt doc in DB
    const corruptDoc = db.getDocumentByPath(path.join(tempDir, 'corrupt.docx'));
    assert.ok(corruptDoc);
    assert.equal(corruptDoc.status, 'failed');
    assert.ok(corruptDoc.error_message);

    // Verify valid docs in DB
    const valid1Doc = db.getDocumentByPath(path.join(tempDir, 'valid1.md'));
    assert.ok(valid1Doc);
    assert.equal(valid1Doc.status, 'ready');
    assert.ok(valid1Doc.total_chunks > 0);

    const valid2Doc = db.getDocumentByPath(path.join(tempDir, 'valid2.xlsx'));
    assert.ok(valid2Doc);
    assert.equal(valid2Doc.status, 'ready');
    assert.ok(valid2Doc.total_chunks > 0);

    // Verify empty doc in DB
    const emptyDoc = db.getDocumentByPath(path.join(tempDir, 'empty.md'));
    assert.ok(emptyDoc);
    assert.equal(emptyDoc.status, 'ready');
    assert.equal(emptyDoc.total_chunks, 0);
  });

  test('Incremental indexing: unmodified files are not re-indexed on subsequent scan', async () => {
    const folder = folderManager.listFolders()[0];
    const report = folderManager.scanAndReconcile(folder.id);

    // 3 valid files should be recognized as unchanged
    assert.equal(report.unchanged.length, 3);
    const unchangedNames = report.unchanged.map(f => f.filename);
    assert.ok(unchangedNames.includes('valid1.md'));
    assert.ok(unchangedNames.includes('empty.md'));
    assert.ok(unchangedNames.includes('valid2.xlsx'));

    // Only the failed file is queued for retry in modified
    assert.equal(report.modified.length, 1);
    assert.equal(report.modified[0].filename, 'corrupt.docx');
  });

  test('Search continues to work immediately after indexing with accurate source locations', () => {
    // Mode A: exact phrase
    const resA = searchEngine.searchDocuments('personal work information board', {
      mode: 'exact'
    });
    assert.ok(resA.total >= 1);
    const target = resA.results.find(r => r.filename === 'valid1.md');
    assert.ok(target, 'Should find valid1.md in results');
    assert.ok(target.highlightedHtml.includes('<mark class="search-highlight">personal work information board</mark>'));

    // Mode B: all terms unordered across XLSX
    const resB = searchEngine.searchDocuments('pencarian full-text lokal', {
      mode: 'all_terms'
    });
    assert.ok(resB.total >= 1);
    assert.equal(resB.results[0].filename, 'valid2.xlsx');
    assert.ok(resB.results[0].locationLabel.includes('Fitur'));
  });

  test('Benchmark: Indexing throughput & Search latency on realistic documents', async () => {
    const benchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-bench-'));

    try {
      // Generate 25 realistic markdown documents (each ~2KB with multiple headings & paragraphs)
      const numFiles = 25;
      for (let i = 1; i <= numFiles; i++) {
        const content = `
# Laporan Proyek Bagian ${i}
Dokumen ini disusun untuk evaluasi performa WeKeepIt V2.

## Modul Komponen ${i}
Sistem kerja lokal harus dapat menangani ratusan berkas tanpa latensi tinggi.
Kata kunci khusus: benchmark_token_${i} dan informasi ${i}.

### Kesimpulan Operasional
Setiap baris teks dipartisi menjadi kalimat dan heading secara terstruktur.
WeKeepIt lebih cocok sebagai personal work information board dalam konteks ${i}.
`;
        fs.writeFileSync(path.join(benchDir, `doc_${i}.md`), content);
      }

      const benchFolder = folderManager.addFolder(benchDir, { recursive: false });

      // Measure Indexing Performance
      const startIndexTime = performance.now();
      const indexResult = await indexer.reindexFolder(benchFolder.id);
      const endIndexTime = performance.now();
      const indexDurationMs = endIndexTime - startIndexTime;

      assert.equal(indexResult.total, numFiles);
      assert.equal(indexResult.completed, numFiles);
      assert.equal(indexResult.failed, 0);

      const msPerDoc = indexDurationMs / numFiles;
      // Indexing should easily be fast (< 100ms per doc on Node)
      assert.ok(msPerDoc < 100, `Expected indexing time per doc < 100ms, got ${msPerDoc.toFixed(2)}ms`);

      // Measure Search Performance (Exact and All Terms)
      const startSearchExact = performance.now();
      const searchExact = searchEngine.searchDocuments('personal work information board', {
        mode: 'exact',
        limit: 50
      });
      const endSearchExact = performance.now();
      const exactDurationMs = endSearchExact - startSearchExact;

      assert.ok(searchExact.total >= numFiles);
      assert.ok(exactDurationMs < 50, `Expected exact search latency < 50ms, got ${exactDurationMs.toFixed(2)}ms`);

      const startSearchAll = performance.now();
      const searchAll = searchEngine.searchDocuments('benchmark_token_12 informasi', {
        mode: 'all_terms'
      });
      const endSearchAll = performance.now();
      const allDurationMs = endSearchAll - startSearchAll;

      assert.equal(searchAll.total, 1);
      assert.ok(allDurationMs < 50, `Expected all terms search latency < 50ms, got ${allDurationMs.toFixed(2)}ms`);

    } finally {
      try {
        fs.rmSync(benchDir, { recursive: true, force: true });
      } catch (e) {}
    }
  });
});
