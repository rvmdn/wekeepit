const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const IndexDB = require('../indexer/db.js');
const SearchEngine = require('../indexer/search-engine.js');
const MetadataEngine = require('../metadata-engine.js');

describe('Search Engine Test Suite', () => {
  let db;
  let searchEngine;

  before(() => {
    db = new IndexDB(':memory:');
    searchEngine = new SearchEngine(db);

    // Seed dummy folder and document
    db.insertFolder({
      id: 'fld-1',
      path: 'E:\\Documents\\Work',
      recursive: true,
      enabled: true
    });

    db.upsertDocument({
      id: 'doc-target',
      folder_id: 'fld-1',
      path: 'E:\\Documents\\Work\\panduan.md',
      filename: 'panduan.md',
      extension: '.md',
      size: 1024,
      mtime: Date.now(),
      status: 'ready'
    });

    db.upsertDocument({
      id: 'doc-scattered',
      folder_id: 'fld-1',
      path: 'E:\\Documents\\Work\\scattered.md',
      filename: 'scattered.md',
      extension: '.md',
      size: 2048,
      mtime: Date.now(),
      status: 'ready'
    });

    // Chunks for doc-target
    db.saveDocumentChunks('doc-target', [
      {
        location_type: 'heading_para',
        location_label: 'Heading: Pengenalan > Paragraf 1',
        content: 'WeKeepIt adalah aplikasi notepad modern.'
      },
      {
        location_type: 'heading_para',
        location_label: 'Heading: Fitur Utama > Paragraf 2',
        content: 'WeKeepIt lebih cocok sebagai personal work information board.'
      }
    ]);

    // Chunks for doc-scattered: words are intentionally in SEPARATE chunks, not in the same sentence/paragraph
    db.saveDocumentChunks('doc-scattered', [
      {
        location_type: 'heading_para',
        location_label: 'Heading: Bab 1 > Paragraf 1',
        content: 'Aplikasi WeKeepIt sangat fleksibel digunakan sehari-hari.'
      },
      {
        location_type: 'heading_para',
        location_label: 'Heading: Bab 20 > Paragraf 5',
        content: 'Format tabel ini sangat cocok untuk perhitungan biaya bulanan.'
      }
    ]);
  });

  after(() => {
    db.close();
  });

  describe('Mode A — Exact Phrase Search', () => {
    test('should match exact phrase in quotes "personal work board"', () => {
      const res = searchEngine.searchDocuments('"personal work information board"');
      assert.equal(res.total, 1);
      assert.equal(res.results[0].filename, 'panduan.md');
      assert.ok(res.results[0].locationLabel.includes('Fitur Utama'));
      assert.ok(res.results[0].highlightedHtml.includes('<mark class="search-highlight">'));
    });

    test('should not match exact phrase if words are out of order', () => {
      const res = searchEngine.searchDocuments('"board personal work"');
      assert.equal(res.total, 0);
    });
  });

  describe('Mode B — All Terms, Unordered Search', () => {
    test('should match query "weekeepit cocok" when both terms appear in the SAME chunk in different order', () => {
      const res = searchEngine.searchDocuments('weekeepit cocok');
      assert.ok(res.total >= 1);
      const match = res.results.find(r => r.filename === 'panduan.md');
      assert.ok(match, 'panduan.md must be matched');
      assert.ok(match.snippet.includes('cocok sebagai personal work'));
      assert.ok(match.highlightedHtml.includes('<mark class="search-highlight">'));
    });

    test('CRITICAL: should NOT match document when search terms are scattered across different chunks/paragraphs', () => {
      // In doc-scattered, "WeKeepIt" is in Bab 1 and "cocok" is in Bab 20.
      // Search for "WeKeepIt cocok" MUST NOT match doc-scattered!
      const res = searchEngine.searchDocuments('WeKeepIt cocok');
      const scatteredMatch = res.results.find(r => r.filename === 'scattered.md');
      assert.equal(scatteredMatch, undefined, 'Scattered terms in different paragraphs must NOT produce a match');
    });

    test('should handle case insensitivity and punctuation in search query', () => {
      const res = searchEngine.searchDocuments('   WEEKEEPIT,   COCOK!  ');
      assert.ok(res.total >= 1);
      assert.equal(res.results[0].filename, 'panduan.md');
    });
  });

  describe('Snippet & Highlight Generator', () => {
    test('should highlight matched terms with HTML mark tags safely', () => {
      const corpus = 'Dokumen rahasia ini menyebutkan bahwa WeKeepIt lebih cocok untuk tim pengembang.';
      const snippet = searchEngine.generateSnippet(corpus, ['weekeepit', 'cocok']);

      assert.ok(snippet.snippet.includes('WeKeepIt lebih cocok'));
      assert.ok(snippet.highlightedHtml.includes('<mark class="search-highlight">WeKeepIt</mark>'));
      assert.ok(snippet.highlightedHtml.includes('<mark class="search-highlight">cocok</mark>'));
    });

    test('should escape dangerous HTML characters to prevent XSS', () => {
      const corpus = '<script>alert("xss")</script> WeKeepIt cocok.';
      const snippet = searchEngine.generateSnippet(corpus, ['cocok']);
      assert.ok(!snippet.highlightedHtml.includes('<script>'));
      assert.ok(snippet.highlightedHtml.includes('&lt;script&gt;'));
    });
  });

  describe('Board Cards Search Integration (Scope Board)', () => {
    const metaEngine = new MetadataEngine();
    const cards = [
      { id: '1', title: 'Tech Refresh', content: 'Info server', tags: ['link', 'role'] },
      { id: '2', title: 'Panduan', content: 'WeKeepIt cocok sebagai board', tags: ['doc'] }
    ];

    test('should filter board cards using MetadataEngine', () => {
      const results = searchEngine.searchBoardCards(cards, 'link+role', metaEngine);
      assert.equal(results.length, 1);
      assert.equal(results[0].id, '1');

      const textResults = searchEngine.searchBoardCards(cards, 'cocok', metaEngine);
      assert.equal(textResults.length, 1);
      assert.equal(textResults[0].id, '2');
    });
  });

  describe('Pagination', () => {
    test('should paginate results correctly', () => {
      const res = searchEngine.searchDocuments('WeKeepIt', { page: 1, limit: 1 });
      assert.equal(res.page, 1);
      assert.equal(res.limit, 1);
      assert.ok(res.total >= 1);
      assert.equal(res.results.length, 1);
    });
  });

});
