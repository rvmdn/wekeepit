/**
 * DocumentEngine - Handles client-side text extraction, indexing,
 * and smart search snippet generation for DOCX, XLSX, PDF, and TXT files.
 */
class DocumentEngine {
  constructor() {
    this.workerConfigured = false;
  }

  /**
   * Configure PDF.js worker path if running in browser
   */
  ensurePdfWorker() {
    if (this.workerConfigured) return;
    if (typeof window !== 'undefined' && window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
      this.workerConfigured = true;
    }
  }

  /**
   * Determine file category / extension
   */
  getFileType(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (['docx', 'doc'].includes(ext)) return 'docx';
    if (['xlsx', 'xls', 'csv'].includes(ext)) return 'xlsx';
    if (['txt', 'md', 'json', 'log', 'xml'].includes(ext)) return 'text';
    return 'other';
  }

  /**
   * Get decorative emoji and styling for file types
   */
  getFileMeta(filename) {
    const type = this.getFileType(filename);
    switch (type) {
      case 'pdf':
        return { icon: '📕', label: 'PDF', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)' };
      case 'docx':
        return { icon: '📘', label: 'Word', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)' };
      case 'xlsx':
        return { icon: '📗', label: 'Excel', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' };
      case 'text':
        return { icon: '📄', label: 'Teks', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.12)' };
      default:
        return { icon: '📎', label: 'Berkas', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.12)' };
    }
  }

  /**
   * Format file size to human readable string (KB / MB)
   */
  formatSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  /**
   * Extract plain text corpus from File object (PDF, DOCX, XLSX, TXT)
   * Returns: { textCorpus, pageOrSheetCount, charCount, wordCount }
   */
  async extractText(file) {
    const ext = this.getFileType(file.name);
    let rawText = '';
    let countInfo = '';

    try {
      if (ext === 'pdf') {
        const result = await this.extractPdfText(file);
        rawText = result.text;
        countInfo = `${result.pages} Halaman`;
      } else if (ext === 'docx') {
        const result = await this.extractDocxText(file);
        rawText = result.text;
        countInfo = `Dokumen Word`;
      } else if (ext === 'xlsx') {
        const result = await this.extractXlsxText(file);
        rawText = result.text;
        countInfo = `${result.sheets} Sheet`;
      } else {
        // Plain text / MD / CSV / JSON
        rawText = await file.text();
        countInfo = `Teks`;
      }
    } catch (err) {
      console.warn(`Gagal ekstrak isi dokumen ${file.name}:`, err);
      rawText = `[Gagal mengekstrak teks otomatis: ${err.message || 'Format tidak didukung'}]`;
    }

    // Clean whitespace & empty lines
    const cleanCorpus = rawText
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/[ ]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const words = cleanCorpus ? cleanCorpus.split(/\s+/).length : 0;

    return {
      textCorpus: cleanCorpus,
      countInfo,
      charCount: cleanCorpus.length,
      wordCount: words
    };
  }

  /**
   * Extract text from PDF file using PDF.js
   */
  async extractPdfText(file) {
    this.ensurePdfWorker();
    if (typeof window === 'undefined' || !window.pdfjsLib) {
      throw new Error('PDF.js library belum termuat.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ');
      if (pageText.trim()) {
        fullText += `[Hal ${pageNum}] ` + pageText + '\n\n';
      }
    }

    return {
      text: fullText,
      pages: pdf.numPages
    };
  }

  /**
   * Extract text from DOCX using Mammoth
   */
  async extractDocxText(file) {
    if (typeof window === 'undefined' || !window.mammoth) {
      throw new Error('Mammoth.js library belum termuat.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    return {
      text: result.value || ''
    };
  }

  /**
   * Extract text from XLSX / CSV using SheetJS
   */
  async extractXlsxText(file) {
    if (typeof window === 'undefined' || !window.XLSX) {
      throw new Error('SheetJS XLSX library belum termuat.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
    let combinedText = '';

    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      if (sheet) {
        // Convert sheet to text representation
        const sheetTxt = window.XLSX.utils.sheet_to_txt(sheet, { skipHidden: true }) || '';
        if (sheetTxt.trim()) {
          combinedText += `[Sheet: ${sheetName}]\n` + sheetTxt + '\n\n';
        }
      }
    });

    return {
      text: combinedText,
      sheets: workbook.SheetNames.length
    };
  }

  /**
   * Read file as Base64 Data URL so it can be downloaded/opened anytime
   */
  readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  }

  /**
   * Generate 1-4 sentences snippet.
   * If search query matches inside corpus: extracts surrounding sentences around matched keywords.
   * If no search query: extracts first 1-3 sentences of document.
   */
  getSnippet(corpus, query = '', maxSentences = 3) {
    if (!corpus || !corpus.trim()) {
      return { snippet: 'Isi dokumen kosong atau tidak terdeteksi teks.', hasMatch: false };
    }

    const cleanCorpus = corpus.trim();

    // Clean query keywords
    const keywords = (query || '')
      .replace(/[+,#]/g, ' ')
      .split(/\s+/)
      .map(k => k.replace(/^tag:/i, '').toLowerCase().trim())
      .filter(k => k.length >= 2);

    // If we have keywords, find first or best match
    if (keywords.length > 0) {
      const lower = cleanCorpus.toLowerCase();
      let bestPos = -1;
      let matchedKeyword = '';

      for (const kw of keywords) {
        const pos = lower.indexOf(kw);
        if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
          bestPos = pos;
          matchedKeyword = kw;
        }
      }

      if (bestPos !== -1) {
        // Find sentence boundaries around the match
        // Context window: ~120 chars before, ~180 chars after
        const start = Math.max(0, bestPos - 120);
        const end = Math.min(cleanCorpus.length, bestPos + 220);

        let slice = cleanCorpus.substring(start, end).trim();

        // Refine edges to nearest space or sentence break
        if (start > 0) {
          const firstSpace = slice.indexOf(' ');
          if (firstSpace !== -1 && firstSpace < 30) {
            slice = slice.substring(firstSpace + 1);
          }
          slice = '...' + slice;
        }

        if (end < cleanCorpus.length) {
          const lastSpace = slice.lastIndexOf(' ');
          if (lastSpace !== -1 && lastSpace > slice.length - 30) {
            slice = slice.substring(0, lastSpace);
          }
          slice = slice + '...';
        }

        return {
          snippet: slice,
          hasMatch: true,
          matchedKeyword
        };
      }
    }

    // Default: Grab first 1-3 sentences (or up to ~220 chars)
    const sentences = cleanCorpus
      .replace(/\[(Hal|Sheet)[^\]]+\]/g, '') // remove header marks for clean preview
      .split(/(?<=[.?!])\s+/)
      .filter(Boolean);

    let snippet = sentences.slice(0, maxSentences).join(' ');
    if (snippet.length > 250) {
      snippet = snippet.substring(0, 240).trim() + '...';
    } else if (sentences.length > maxSentences && !snippet.endsWith('.')) {
      snippet += '...';
    }

    return {
      snippet: snippet || cleanCorpus.substring(0, 180) + '...',
      hasMatch: false
    };
  }

  /**
   * Escape HTML utility
   */
  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Render snippet with safe HTML and highlighted search keywords
   */
  renderHighlightedSnippet(snippet, query = '') {
    const safe = this.escapeHtml(snippet);
    if (!query) return safe;

    const keywords = query
      .replace(/[+,#]/g, ' ')
      .split(/\s+/)
      .map(k => k.replace(/^tag:/i, '').trim())
      .filter(k => k.length >= 2);

    if (keywords.length === 0) return safe;

    // Build regex to highlight words
    try {
      const pattern = new RegExp(`(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
      return safe.replace(pattern, '<mark class="doc-match-highlight">$1</mark>');
    } catch (e) {
      return safe;
    }
  }
}

// Export for browser & node
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DocumentEngine;
} else {
  window.DocumentEngine = DocumentEngine;
}
