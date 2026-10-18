const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const IndexDB = require('../indexer/db.js');
const { FolderManager } = require('../indexer/folder-manager.js');

describe('Database & Folder Manager Test Suite', () => {
  let db;
  let folderManager;
  let tempTestDir;

  before(() => {
    // In-memory database for clean, isolated tests
    db = new IndexDB(':memory:');
    folderManager = new FolderManager(db);

    // Create a temporary directory structure for testing
    tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekeepit-test-'));
    fs.writeFileSync(path.join(tempTestDir, 'test1.md'), '# Title\n\nWeKeepIt is a great tool.');
    fs.writeFileSync(path.join(tempTestDir, 'ignored.txt'), 'This format is not indexed.');
    
    const subDir = path.join(tempTestDir, 'subfolder');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'doc2.docx'), 'dummy docx content');

    const nodeModules = path.join(tempTestDir, 'node_modules');
    fs.mkdirSync(nodeModules);
    fs.writeFileSync(path.join(nodeModules, 'skip.md'), 'should be skipped');
  });

  after(() => {
    folderManager.stopAllWatchers();
    db.close();
    try {
      fs.rmSync(tempTestDir, { recursive: true, force: true });
    } catch (e) {}
  });

  test('Database should apply schema migrations and create tables', () => {
    const stats = db.getStats();
    assert.equal(stats.totalFolders, 0);
    assert.equal(stats.totalDocs, 0);
    assert.equal(stats.totalChunks, 0);
  });

  test('FolderManager should disallow system root or app directory', () => {
    assert.throws(() => {
      folderManager.addFolder(path.resolve(__dirname, '..'));
    }, /Tidak diperbolehkan mengindeks direktori sistem atau aplikasi/);
  });

  test('FolderManager should add folder with default settings', () => {
    const fld = folderManager.addFolder(tempTestDir, { recursive: true });
    assert.ok(fld.id);
    assert.equal(fld.path, path.resolve(tempTestDir));
    assert.equal(fld.recursive, true);
    assert.equal(fld.enabled, true);

    const list = folderManager.listFolders();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, fld.id);
  });

  test('FolderManager should scan and reconcile files on disk', () => {
    const fld = folderManager.listFolders()[0];
    const report = folderManager.scanAndReconcile(fld.id);

    // test1.md in root, doc2.docx in subfolder should be added
    // ignored.txt and node_modules/skip.md should be skipped
    assert.equal(report.added.length, 2);
    assert.equal(report.modified.length, 0);
    assert.equal(report.deleted.length, 0);
    assert.equal(report.unchanged.length, 0);

    const filenames = report.added.map(f => f.filename);
    assert.ok(filenames.includes('test1.md'));
    assert.ok(filenames.includes('doc2.docx'));
    assert.ok(!filenames.includes('skip.md'));
    assert.ok(!filenames.includes('ignored.txt'));
  });

  test('Reconciliation should detect modified and unchanged files', () => {
    const fld = folderManager.listFolders()[0];
    const report1 = folderManager.scanAndReconcile(fld.id);

    // Save added files into DB as indexed
    for (const doc of report1.added) {
      db.upsertDocument({ ...doc, status: 'ready' });
    }

    // Immediately scan again: all should be unchanged
    const report2 = folderManager.scanAndReconcile(fld.id);
    assert.equal(report2.added.length, 0);
    assert.equal(report2.modified.length, 0);
    assert.equal(report2.deleted.length, 0);
    assert.equal(report2.unchanged.length, 2);

    // Modify test1.md
    const test1Path = path.join(tempTestDir, 'test1.md');
    fs.appendFileSync(test1Path, '\n\nExtra line added for modification.');

    const report3 = folderManager.scanAndReconcile(fld.id);
    assert.equal(report3.modified.length, 1);
    assert.equal(report3.modified[0].filename, 'test1.md');
    assert.equal(report3.unchanged.length, 1);
    assert.equal(report3.unchanged[0].filename, 'doc2.docx');
  });

  test('Reconciliation should detect deleted files', () => {
    const fld = folderManager.listFolders()[0];
    const subDocPath = path.join(tempTestDir, 'subfolder', 'doc2.docx');
    fs.unlinkSync(subDocPath);

    const report = folderManager.scanAndReconcile(fld.id);
    assert.equal(report.deleted.length, 1);
    assert.equal(report.deleted[0].filename, 'doc2.docx');
  });

  test('FolderManager should remove folder and cascade delete documents', () => {
    const fld = folderManager.listFolders()[0];
    folderManager.removeFolder(fld.id);

    const list = folderManager.listFolders();
    assert.equal(list.length, 0);
    assert.equal(db.getAllDocuments().length, 0);
  });
});
