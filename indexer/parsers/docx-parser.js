const fs = require('fs');
const path = require('path');

let mammothLib = null;

function getMammoth() {
  if (!mammothLib) {
    const mammothPath = path.join(__dirname, '..', '..', 'lib', 'mammoth.browser.min.js');
    mammothLib = require(mammothPath);
  }
  return mammothLib;
}

/**
 * DOCX Parser Adapter
 * Extracts paragraphs, headings, and tables from Word documents using Mammoth.
 * Accurately tracks heading breadcrumbs and paragraph indices.
 * Does not invent page numbers.
 */
class DocxParser {
  async parse(filePath, buffer) {
    const mammoth = getMammoth();
    const dataBuffer = buffer || fs.readFileSync(filePath);
    const arrayBuffer = dataBuffer.buffer.slice(
      dataBuffer.byteOffset,
      dataBuffer.byteOffset + dataBuffer.byteLength
    );

    let htmlResult;
    try {
      htmlResult = await mammoth.convertToHtml({ arrayBuffer });
    } catch (err) {
      throw new Error(`Gagal membaca berkas Word DOCX: ${err.message || 'Format tidak valid atau korup'}`);
    }

    const html = htmlResult.value || '';
    const chunks = [];
    let currentHeading = '';
    let paraIndex = 0;
    let totalWords = 0;
    let totalChars = 0;

    // Match tags: <h1>...</h1>, <h2>...</h2>, <h3>...</h3>, <p>...</p>, <tr>...</tr>
    const blockRegex = /<(h[1-6]|p|tr)(?:\s+[^>]*)?>([\s\S]*?)<\/\1>/gi;
    let match;

    while ((match = blockRegex.exec(html)) !== null) {
      const tag = match[1].toLowerCase();
      const rawContent = match[2];

      // Strip inner HTML tags (e.g. <strong>, <em>, <a>, <td>)
      const text = rawContent
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

      if (!text) continue;

      const words = text.split(/\s+/).filter(Boolean);
      totalWords += words.length;
      totalChars += text.length;

      if (tag.startsWith('h')) {
        currentHeading = text;
        chunks.push({
          chunkIndex: chunks.length,
          locationType: 'heading_para',
          locationLabel: `Heading (${tag.toUpperCase()}): ${text}`,
          content: text
        });
        paraIndex = 0;
      } else if (tag === 'tr') {
        chunks.push({
          chunkIndex: chunks.length,
          locationType: 'heading_para',
          locationLabel: currentHeading
            ? `Heading: ${currentHeading} > Tabel Baris`
            : `Tabel Baris`,
          content: text
        });
      } else {
        // <p> paragraph
        paraIndex++;
        const locationPrefix = currentHeading ? `Heading: ${currentHeading} > ` : '';
        const locationLabel = `${locationPrefix}Paragraf ${paraIndex}`;

        // Break long paragraph into sentences for exact sentence matching
        const sentences = text.split(/(?<=[.?!])\s+/).filter(Boolean);
        if (sentences.length > 1) {
          sentences.forEach((sentence, sIdx) => {
            const clean = sentence.trim();
            if (clean) {
              chunks.push({
                chunkIndex: chunks.length,
                locationType: 'heading_para',
                locationLabel: `${locationLabel} - Kalimat ${sIdx + 1}`,
                content: clean
              });
            }
          });
        } else {
          chunks.push({
            chunkIndex: chunks.length,
            locationType: 'heading_para',
            locationLabel,
            content: text
          });
        }
      }
    }

    // Fallback if no HTML blocks were matched (e.g. plain text or abnormal XML)
    if (chunks.length === 0) {
      try {
        const rawRes = await mammoth.extractRawText({ arrayBuffer });
        const raw = (rawRes.value || '').trim();
        if (raw) {
          const sentences = raw.split(/(?<=[.?!])\s+/).filter(Boolean);
          sentences.forEach((s, idx) => {
            const c = s.trim();
            if (c) {
              chunks.push({
                chunkIndex: chunks.length,
                locationType: 'heading_para',
                locationLabel: `Paragraf 1 - Kalimat ${idx + 1}`,
                content: c
              });
            }
          });
          totalWords = raw.split(/\s+/).filter(Boolean).length;
          totalChars = raw.length;
        }
      } catch (e) {}
    }

    return {
      chunks,
      metadata: {
        wordCount: totalWords,
        charCount: totalChars,
        isScanned: false
      }
    };
  }
}

module.exports = new DocxParser();
