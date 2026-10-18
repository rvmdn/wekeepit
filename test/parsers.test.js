const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const markdownParser = require('../indexer/parsers/markdown-parser.js');
const pdfParser = require('../indexer/parsers/pdf-parser.js');
const docxParser = require('../indexer/parsers/docx-parser.js');
const xlsxParser = require('../indexer/parsers/xlsx-parser.js');
const { getParser, SUPPORTED_EXTENSIONS } = require('../indexer/parsers/index.js');
const XLSX = require('../lib/xlsx.mini.min.js');

describe('Document Parsers Test Suite', () => {

  describe('Markdown Parser', () => {
    const mdContent = `
# Arsitektur WeKeepIt
Dokumen ini menjelaskan rancangan V2.

## Modul Pencarian
WeKeepIt lebih cocok sebagai personal work information board.
Pencarian harus cepat dan lokal.

### Subtopik Detail
Paragraf ketiga dalam subtopik.
`;

    test('should extract headings, paragraphs and breadcrumbs accurately', async () => {
      const res = await markdownParser.parse('doc.md', Buffer.from(mdContent, 'utf-8'));
      assert.ok(Array.isArray(res.chunks));
      assert.ok(res.chunks.length >= 4);

      // Check headings
      const headings = res.chunks.filter(c => c.locationLabel.includes('Heading'));
      assert.ok(headings.length >= 3);

      // Verify exact phrase chunk exists
      const targetChunk = res.chunks.find(c => c.content.includes('WeKeepIt lebih cocok sebagai personal work information board.'));
      assert.ok(targetChunk, 'Target phrase must exist in extracted chunks');
      assert.ok(targetChunk.locationLabel.includes('Modul Pencarian'));
      assert.equal(targetChunk.locationType, 'heading_para');

      // Check metadata
      assert.ok(res.metadata.wordCount > 15);
      assert.ok(res.metadata.charCount > 100);
      assert.equal(res.metadata.isScanned, false);
    });
  });

  describe('PDF Parser', () => {
    const minimalPdf = Buffer.from(
`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
5 0 obj << /Length 73 >> stream
BT /F1 12 Tf 72 712 Td (WeKeepIt lebih cocok sebagai personal work information board.) Tj ET
endstream endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000333 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
456
%%EOF
`
    );

    test('should extract page number and text accurately', async () => {
      const res = await pdfParser.parse('sample.pdf', minimalPdf);
      assert.equal(res.metadata.pageCount, 1);
      assert.equal(res.metadata.isScanned, false);
      assert.equal(res.metadata.ocrNotice, null);

      assert.ok(res.chunks.length > 0);
      assert.equal(res.chunks[0].locationType, 'page');
      assert.equal(res.chunks[0].locationLabel, 'Hal 1');
      assert.equal(res.chunks[0].content, 'WeKeepIt lebih cocok sebagai personal work information board.');
    });

    test('should gracefully reject corrupted PDF buffer without unhandled crash', async () => {
      const corruptedPdf = Buffer.from('%PDF-1.4 corrupt data invalid trailer');
      await assert.rejects(async () => {
        await pdfParser.parse('corrupt.pdf', corruptedPdf);
      }, /Gagal membuka berkas PDF/);
    });
  });

  describe('DOCX Parser', () => {
    // Minimal DOCX zip generator
    function createMinimalZip(files) {
      function crc32(buf) {
        let crc = 0 ^ (-1);
        for (let i = 0; i < buf.length; i++) {
          crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
        }
        return (crc ^ (-1)) >>> 0;
      }
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c;
      }

      const fileEntries = [];
      let offset = 0;
      for (const file of files) {
        const nameBuffer = Buffer.from(file.name, 'utf-8');
        const contentBuffer = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf-8');
        const crc = crc32(contentBuffer);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(contentBuffer.length, 18);
        localHeader.writeUInt32LE(contentBuffer.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localHeader.writeUInt16LE(0, 28);

        fileEntries.push({ nameBuffer, contentBuffer, localHeader, crc, offset });
        offset += localHeader.length + nameBuffer.length + contentBuffer.length;
      }

      const cdBuffers = [];
      let cdOffset = offset, cdSize = 0;
      for (const entry of fileEntries) {
        const cdHeader = Buffer.alloc(46);
        cdHeader.writeUInt32LE(0x02014b50, 0);
        cdHeader.writeUInt16LE(20, 4);
        cdHeader.writeUInt16LE(20, 6);
        cdHeader.writeUInt32LE(entry.crc, 16);
        cdHeader.writeUInt32LE(entry.contentBuffer.length, 20);
        cdHeader.writeUInt32LE(entry.contentBuffer.length, 24);
        cdHeader.writeUInt16LE(entry.nameBuffer.length, 28);
        cdHeader.writeUInt32LE(entry.offset, 42);

        cdBuffers.push(cdHeader, entry.nameBuffer);
        cdSize += cdHeader.length + entry.nameBuffer.length;
      }

      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(fileEntries.length, 8);
      eocd.writeUInt16LE(fileEntries.length, 10);
      eocd.writeUInt32LE(cdSize, 12);
      eocd.writeUInt32LE(cdOffset, 16);

      const all = [];
      for (const entry of fileEntries) all.push(entry.localHeader, entry.nameBuffer, entry.contentBuffer);
      all.push(...cdBuffers, eocd);
      return Buffer.concat(all);
    }

    const docxBuffer = createMinimalZip([
      {
        name: '[Content_Types].xml',
        content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      },
      {
        name: '_rels/.rels',
        content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
      },
      {
        name: 'word/document.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Panduan WeKeepIt</w:t></w:r></w:p><w:p><w:r><w:t>WeKeepIt lebih cocok sebagai personal work information board.</w:t></w:r></w:p></w:body></w:document>`
      }
    ]);

    test('should extract headings and paragraphs with heading breadcrumb', async () => {
      const res = await docxParser.parse('sample.docx', docxBuffer);
      assert.ok(res.chunks.length >= 2);

      const headingChunk = res.chunks.find(c => c.content === 'Panduan WeKeepIt');
      assert.ok(headingChunk);
      assert.ok(headingChunk.locationLabel.includes('Heading'));

      const paraChunk = res.chunks.find(c => c.content.includes('WeKeepIt lebih cocok sebagai personal work information board.'));
      assert.ok(paraChunk);
      assert.ok(paraChunk.locationLabel.includes('Panduan WeKeepIt'));
      assert.ok(paraChunk.locationLabel.includes('Paragraf'));
    });

    test('should reject corrupt docx buffer safely', async () => {
      await assert.rejects(async () => {
        await docxParser.parse('corrupt.docx', Buffer.from('not a zip file'));
      }, /Gagal membaca berkas Word DOCX/);
    });
  });

  describe('XLSX Parser', () => {
    test('should extract sheet names, cell coordinates, and handle multiple sheets', async () => {
      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.aoa_to_sheet([
        ['ID', 'Deskripsi'],
        ['101', 'WeKeepIt lebih cocok sebagai personal work information board.']
      ]);
      const ws2 = XLSX.utils.aoa_to_sheet([
        ['Parameter', 'Nilai'],
        ['MaxFileSize', '50MB']
      ]);

      XLSX.utils.book_append_sheet(wb, ws1, 'Ringkasan');
      XLSX.utils.book_append_sheet(wb, ws2, 'Konfigurasi');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const res = await xlsxParser.parse('sample.xlsx', buffer);

      assert.equal(res.metadata.sheetCount, 2);
      assert.ok(res.chunks.length >= 4);

      // Verify specific cell
      const cellChunk = res.chunks.find(c => c.locationLabel === 'Sheet: Ringkasan, Sel: B2');
      assert.ok(cellChunk, 'Must find exact cell coordinate Sheet: Ringkasan, Sel: B2');
      assert.equal(cellChunk.content, 'WeKeepIt lebih cocok sebagai personal work information board.');

      // Verify row group chunk
      const rowChunk = res.chunks.find(c => c.locationLabel.includes('Sheet: Ringkasan, Baris 2'));
      assert.ok(rowChunk);
      assert.ok(rowChunk.content.includes('101'));
      assert.ok(rowChunk.content.includes('WeKeepIt lebih cocok'));
    });

    test('should reject corrupt xlsx buffer safely', async () => {
      await assert.rejects(async () => {
        await xlsxParser.parse('corrupt.xlsx', Buffer.from('invalid xlsx bytes'));
      }, /Gagal membaca berkas Excel/);
    });
  });

  describe('Parser Registry', () => {
    test('should return correct adapter for supported extensions', () => {
      assert.equal(getParser('notes.md'), markdownParser);
      assert.equal(getParser('.pdf'), pdfParser);
      assert.equal(getParser('document.docx'), docxParser);
      assert.equal(getParser('data.xlsx'), xlsxParser);
      assert.equal(getParser('program.exe'), null);
      assert.equal(getParser('plain.txt'), null);
    });
  });

});
