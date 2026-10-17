const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const IndexDB = require('../indexer/db.js');
const SearchEngine = require('../indexer/search-engine.js');
const markdownParser = require('../indexer/parsers/markdown-parser.js');
const pdfParser = require('../indexer/parsers/pdf-parser.js');
const docxParser = require('../indexer/parsers/docx-parser.js');
const xlsxParser = require('../indexer/parsers/xlsx-parser.js');
const XLSX = require('../lib/xlsx.mini.min.js');

describe('Audit Search Engine & Parsers Quality Suite (Phase 6)', () => {
  let db;
  let searchEngine;

  before(() => {
    db = new IndexDB(':memory:');
    searchEngine = new SearchEngine(db);

    db.insertFolder({ id: 'fld-audit', path: 'C:\\AuditDocs', recursive: true, enabled: true });

    db.upsertDocument({
      id: 'doc-1',
      folder_id: 'fld-audit',
      path: 'C:\\AuditDocs\\guide.md',
      filename: 'guide.md',
      extension: '.md',
      size: 1024,
      mtime: Date.now(),
      status: 'ready'
    });

    db.upsertDocument({
      id: 'doc-2',
      folder_id: 'fld-audit',
      path: 'C:\\AuditDocs\\notes.docx',
      filename: 'notes.docx',
      extension: '.docx',
      size: 2048,
      mtime: Date.now(),
      status: 'ready'
    });

    // Chunks for doc-1:
    // Chunk 0: Sentence 1: "WeKeepIt lebih cocok sebagai personal work information board."
    // Chunk 1: Sentence 2: "Sistem ini menyimpan informasi kecil secara rahasia dengan kode 20241."
    db.saveDocumentChunks('doc-1', [
      {
        location_type: 'heading_para',
        location_label: 'Heading: Bab 1 > Paragraf 1 - Kalimat 1',
        content: 'WeKeepIt lebih cocok sebagai personal work information board.'
      },
      {
        location_type: 'heading_para',
        location_label: 'Heading: Bab 1 > Paragraf 1 - Kalimat 2',
        content: 'Sistem ini menyimpan informasi kecil secara rahasia dengan kode 20241.'
      }
    ]);

    // Chunks for doc-2:
    // Chunk 0: Page 1: "Dokumen teknis arsitektur perangkat lunak."
    // Chunk 1: Page 2: "Pengujian fungsional dan keamanan sistem."
    db.saveDocumentChunks('doc-2', [
      {
        location_type: 'page',
        location_label: 'Hal 1',
        content: 'Dokumen teknis arsitektur perangkat lunak.'
      },
      {
        location_type: 'page',
        location_label: 'Hal 2',
        content: 'Pengujian fungsional dan keamanan sistem.'
      }
    ]);
  });

  after(() => {
    db.close();
  });

  describe('Search Engine: Exact Phrase (Mode A) Boundary Verification', () => {
    test('True positive: exact verbatim phrase matching', () => {
      const res = searchEngine.searchDocuments('personal work information board', { mode: 'exact' });
      assert.equal(res.total, 1);
      assert.equal(res.results[0].filename, 'guide.md');
      assert.ok(res.results[0].snippet.includes('personal work information board'));
    });

    test('Case insensitivity & punctuation tolerance in exact phrase', () => {
      const res = searchEngine.searchDocuments('  "PERSONAL WORK, INFORMATION BOARD!" ', { mode: 'exact' });
      assert.equal(res.total, 1);
      assert.equal(res.results[0].filename, 'guide.md');
    });

    test('False positive rejection: out-of-order words must NOT match exact phrase', () => {
      const res = searchEngine.searchDocuments('"work personal board information"', { mode: 'exact' });
      assert.equal(res.total, 0, 'Out-of-order phrase must not match in exact mode');
    });

    test('False positive rejection: phrase spanning across separate chunks must NOT match', () => {
      // "board Sistem" spans from end of chunk 0 to start of chunk 1
      const res = searchEngine.searchDocuments('"board Sistem ini"', { mode: 'exact' });
      assert.equal(res.total, 0, 'Cross-chunk phrase must not match');
    });
  });

  describe('Search Engine: Unordered All-Terms (Mode B) & Sentence Boundary', () => {
    test('True positive: words in different order inside SAME sentence/chunk', () => {
      const res = searchEngine.searchDocuments('work personal board', { mode: 'all_terms' });
      assert.equal(res.total, 1);
      assert.equal(res.results[0].filename, 'guide.md');
      assert.ok(res.results[0].locationLabel.includes('Kalimat 1'));
    });

    test('CRITICAL: words scattered across sentence 1 and sentence 2 must NOT match', () => {
      // "cocok" is in sentence 1, "rahasia" is only in sentence 2
      const res = searchEngine.searchDocuments('cocok rahasia', { mode: 'all_terms' });
      assert.equal(res.total, 0, 'Terms in different sentences must NOT match');
    });

    test('CRITICAL: words scattered across Page 1 and Page 2 must NOT match', () => {
      // "arsitektur" is on Hal 1, "keamanan" is on Hal 2
      const res = searchEngine.searchDocuments('arsitektur keamanan', { mode: 'all_terms' });
      assert.equal(res.total, 0, 'Terms on different pages must NOT match');
    });

    test('Synonym mapping must be disabled by default (no unwanted assumptions)', () => {
      // "info" is not in chunk 1 (chunk 1 has "informasi").
      // With default enableSynonyms = false, searching 'info rahasia' must not match
      const resDefault = searchEngine.searchDocuments('info rahasia', { mode: 'all_terms', enableSynonyms: false });
      assert.equal(resDefault.total, 0, 'Default search should NOT treat info as information without flag');

      // With enableSynonyms = true, synonym map is applied
      const resSyn = searchEngine.searchDocuments('info rahasia', { mode: 'all_terms', enableSynonyms: true });
      assert.equal(resSyn.total, 1);
      assert.equal(resSyn.results[0].filename, 'guide.md');
    });
  });

  describe('Search Engine: Typo Tolerance & False Positive Controls', () => {
    test('Typo tolerance: 1-char edit distance for brand names (weekeepit -> wekeepit)', () => {
      const res = searchEngine.searchDocuments('weekeepit cocok', { mode: 'all_terms' });
      assert.equal(res.total, 1);
      assert.equal(res.results[0].filename, 'guide.md');
    });

    test('Short words (< 5 chars) must NOT have typo tolerance to prevent noise', () => {
      // "work" in doc-1 should not match "fork" or "word"
      const res = searchEngine.searchDocuments('fork board', { mode: 'all_terms' });
      assert.equal(res.total, 0, 'Short word fork must not match work via typo tolerance');
    });

    test('Numeric tokens must require exact match (prevent ID/year collisions)', () => {
      // "20241" is in doc-1. "20242" must NOT match!
      const res = searchEngine.searchDocuments('20242 rahasia', { mode: 'all_terms' });
      assert.equal(res.total, 0, 'Numeric strings must not match different numbers via typo tolerance');
    });
  });

  describe('Search Engine: Robustness & Security Bounds', () => {
    test('Empty and whitespace-only query returns 0 results safely', () => {
      assert.equal(searchEngine.searchDocuments('').total, 0);
      assert.equal(searchEngine.searchDocuments('   ').total, 0);
      assert.equal(searchEngine.searchDocuments('\t\n\r').total, 0);
    });

    test('Special characters & SQL/FTS operators do not crash query engine', () => {
      const edgeQueries = [
        'NOT OR AND NEAR',
        '"""""',
        '(*)^%$#@!',
        'DROP TABLE documents; --',
        '\' OR 1=1 --',
        'WeKeepIt" AND "board',
        '{column: value}',
        'a'.repeat(500) // Oversized query
      ];

      for (const q of edgeQueries) {
        assert.doesNotThrow(() => {
          const res = searchEngine.searchDocuments(q);
          assert.ok(res !== null && typeof res.total === 'number');
        }, `Query should not crash: ${q}`);
      }
    });

    test('XSS attempt in search query is safely escaped in snippet highlight', () => {
      const xssQuery = '<script>alert(1)</script>';
      const snippet = searchEngine.generateSnippet(
        'Dokumen berisi teks <script>alert(1)</script> dan WeKeepIt.',
        [xssQuery]
      );
      assert.ok(!snippet.highlightedHtml.includes('<script>alert(1)</script>'));
      assert.ok(snippet.highlightedHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    });
  });

  describe('Parsers: Deep Quality & Edge Cases', () => {
    test('Markdown: handles multi-level nested headings, lists, tables, unicode', async () => {
      const md = `
# Tingkat 1
Paragraf pembuka tingkat 1.

## Tingkat 2A
- Item daftar 1
- Item daftar 2

### Tingkat 3A
| Kolom A | Kolom B |
| --- | --- |
| Nilai 1 | Nilai 2 |

Karakter Unicode: 日本語 teks, élan, 🚀 emoji, dan tanda baca «guillemets».
`;
      const res = await markdownParser.parse('test.md', Buffer.from(md, 'utf-8'));
      assert.ok(res.chunks.length >= 4);

      // Verify breadcrumbs
      const t3Chunk = res.chunks.find(c => c.content.includes('Nilai 1') || c.locationLabel.includes('Tingkat 3A'));
      assert.ok(t3Chunk);
      assert.ok(!res.chunks.some(c => c.locationLabel.includes('Halaman')), 'Markdown must never invent page numbers');
    });

    test('XLSX: handles formula cells, hidden sheets, multiple sheets', async () => {
      const wb = XLSX.utils.book_new();
      const wsVisible = XLSX.utils.aoa_to_sheet([
        ['Barang', 'Jumlah', 'Harga', 'Total'],
        ['Buku', 5, 10000, { f: 'B2*C2', v: 50000 }]
      ]);
      const wsHidden = XLSX.utils.aoa_to_sheet([
        ['Secret', 'Password123']
      ]);

      XLSX.utils.book_append_sheet(wb, wsVisible, 'Penjualan');
      XLSX.utils.book_append_sheet(wb, wsHidden, 'Rahasia');
      wb.Workbook = {
        Sheets: [
          { name: 'Penjualan', Hidden: 0 },
          { name: 'Rahasia', Hidden: 1 }
        ]
      };

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const res = await xlsxParser.parse('test.xlsx', buf);

      // Verify visible sheet cells extracted
      const cell = res.chunks.find(c => c.locationLabel.includes('Sheet: Penjualan, Sel: D2'));
      assert.ok(cell, 'Formula cell value must be extracted');
      assert.equal(cell.content, '50000');

      // Verify hidden sheet was excluded
      const hiddenChunk = res.chunks.find(c => c.locationLabel.includes('Rahasia'));
      assert.equal(hiddenChunk, undefined, 'Hidden sheet must be skipped');
    });
  });
});
