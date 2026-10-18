const fs = require('fs');
const path = require('path');

let xlsxLib = null;

function getXLSX() {
  if (!xlsxLib) {
    const xlsxPath = path.join(__dirname, '..', '..', 'lib', 'xlsx.mini.min.js');
    xlsxLib = require(xlsxPath);
  }
  return xlsxLib;
}

/**
 * XLSX Parser Adapter
 * Extracts text values from worksheets with sheet name and cell coordinates.
 * Safely handles hidden sheets, empty cells, and ignores macros.
 */
class XlsxParser {
  async parse(filePath, buffer) {
    const XLSX = getXLSX();
    const dataBuffer = buffer || fs.readFileSync(filePath);

    // .xlsx is an OpenXML ZIP package and must start with PK (0x50, 0x4B)
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.xlsx' && (dataBuffer.length < 4 || dataBuffer[0] !== 0x50 || dataBuffer[1] !== 0x4B)) {
      throw new Error('Gagal membaca berkas Excel: berkas .xlsx tidak valid (bukan arsip OpenXML yang valid atau korup)');
    }

    let workbook;
    try {
      workbook = XLSX.read(dataBuffer, {
        type: 'buffer',
        cellDates: true,
        cellText: true,
        sheetStubs: false
      });
    } catch (err) {
      throw new Error(`Gagal membaca berkas Excel: ${err.message || 'Format tidak valid atau korup'}`);
    }

    const chunks = [];
    let totalWords = 0;
    let totalChars = 0;

    // Detect hidden sheets
    const sheetMetaList = (workbook.Workbook && workbook.Workbook.Sheets) || [];
    const hiddenSheetNames = new Set();
    for (const s of sheetMetaList) {
      if (s.Hidden && s.Hidden > 0 && s.name) {
        hiddenSheetNames.add(s.name.toLowerCase());
      }
    }

    for (const sheetName of workbook.SheetNames) {
      if (hiddenSheetNames.has(sheetName.toLowerCase())) {
        // Skip hidden worksheets
        continue;
      }

      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      // Group cells by row for combined row-level context
      const rowMap = new Map(); // rowIndex -> Array<{ col, addr, val }>

      for (const [addr, cell] of Object.entries(sheet)) {
        if (addr.startsWith('!')) continue; // Skip sheet metadata (!ref, !cols, etc.)
        if (!cell || cell.v === undefined || cell.v === null) continue;

        const val = String(cell.w !== undefined ? cell.w : cell.v).trim();
        if (!val) continue;

        const words = val.split(/\s+/).filter(Boolean);
        totalWords += words.length;
        totalChars += val.length;

        // Individual cell chunk
        chunks.push({
          chunkIndex: chunks.length,
          locationType: 'sheet_cell',
          locationLabel: `Sheet: ${sheetName}, Sel: ${addr}`,
          content: val
        });

        // Parse row number for row grouping
        const rowMatch = addr.match(/\d+$/);
        if (rowMatch) {
          const rowNum = rowMatch[0];
          if (!rowMap.has(rowNum)) {
            rowMap.set(rowNum, []);
          }
          rowMap.get(rowNum).push({ addr, val });
        }
      }

      // Add multi-column row context chunks (for matching records across columns in the same row)
      for (const [rowNum, cells] of rowMap.entries()) {
        if (cells.length >= 2) {
          const combinedRow = cells.map(c => `${c.addr}: ${c.val}`).join(' | ');
          chunks.push({
            chunkIndex: chunks.length,
            locationType: 'sheet_cell',
            locationLabel: `Sheet: ${sheetName}, Baris ${rowNum} (${cells.map(c => c.addr).join(', ')})`,
            content: combinedRow
          });
        }
      }
    }

    return {
      chunks,
      metadata: {
        sheetCount: workbook.SheetNames.length,
        wordCount: totalWords,
        charCount: totalChars,
        isScanned: false
      }
    };
  }
}

module.exports = new XlsxParser();
