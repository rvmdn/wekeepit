const fs = require('fs');
const path = require('path');

let pdfjsLib = null;

function getPdfJs() {
  if (!pdfjsLib) {
    const pdfPath = path.join(__dirname, '..', '..', 'lib', 'pdf.min.js');
    pdfjsLib = require(pdfPath);
    if (pdfjsLib.GlobalWorkerOptions) {
      const workerPath = path.join(__dirname, '..', '..', 'lib', 'pdf.worker.min.js');
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
    }
  }
  return pdfjsLib;
}

/**
 * PDF Parser Adapter
 * Extracts text per page with true page numbers.
 * Detects scanned PDFs and informs OCR is not yet available.
 */
class PdfParser {
  async parse(filePath, buffer) {
    const pdfjs = getPdfJs();
    const dataBuffer = buffer || fs.readFileSync(filePath);
    const uint8Array = new Uint8Array(dataBuffer);

    let doc = null;
    try {
      const loadingTask = pdfjs.getDocument({
        data: uint8Array,
        isEvalSupported: false,
        useSystemFonts: true,
        disableFontFace: true
      });
      doc = await loadingTask.promise;
    } catch (err) {
      throw new Error(`Gagal membuka berkas PDF: ${err.message || 'Format tidak valid atau terproteksi sandi'}`);
    }

    const chunks = [];
    let totalWords = 0;
    let totalChars = 0;
    const numPages = doc.numPages || 0;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      try {
        const page = await doc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageItems = (textContent.items || [])
          .map(item => (typeof item.str === 'string' ? item.str : ''))
          .filter(Boolean);

        const pageText = pageItems.join(' ').replace(/\s+/g, ' ').trim();
        if (pageText) {
          totalChars += pageText.length;
          const words = pageText.split(/\s+/).filter(Boolean);
          totalWords += words.length;

          // Break page text into sentences/paragraphs
          const sentences = pageText.split(/(?<=[.?!])\s+/).filter(Boolean);
          if (sentences.length > 1) {
            sentences.forEach((sentence, sIdx) => {
              const cleanSentence = sentence.trim();
              if (cleanSentence) {
                chunks.push({
                  chunkIndex: chunks.length,
                  locationType: 'page',
                  locationLabel: `Hal ${pageNum} (Kalimat ${sIdx + 1})`,
                  content: cleanSentence
                });
              }
            });
          } else {
            chunks.push({
              chunkIndex: chunks.length,
              locationType: 'page',
              locationLabel: `Hal ${pageNum}`,
              content: pageText
            });
          }
        }
      } catch (pageErr) {
        console.warn(`Peringatan: Gagal membaca halaman ${pageNum} pada ${filePath}:`, pageErr.message);
      }
    }

    // Detect if PDF is scanned or image-only
    const avgCharsPerPage = numPages > 0 ? (totalChars / numPages) : 0;
    const isScanned = numPages > 0 && (totalChars < 15 || avgCharsPerPage < 10);
    const ocrNotice = isScanned
      ? 'PDF terdeteksi sebagai pindaian / gambar (OCR belum tersedia)'
      : null;

    return {
      chunks,
      metadata: {
        pageCount: numPages,
        wordCount: totalWords,
        charCount: totalChars,
        isScanned,
        ocrNotice
      }
    };
  }
}

module.exports = new PdfParser();
