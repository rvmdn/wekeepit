const fs = require('fs');

/**
 * Markdown Parser Adapter
 * Extracts headings, paragraphs, and fine-grained sentences with accurate locations.
 * Never invents page numbers.
 */
class MarkdownParser {
  async parse(filePath, buffer) {
    const rawText = buffer ? buffer.toString('utf-8') : fs.readFileSync(filePath, 'utf-8');
    const lines = rawText.split(/\r?\n/);

    const chunks = [];
    let currentHeading = '';
    let headingStack = [];
    let currentParagraphLines = [];
    let paragraphIndex = 0;
    let paraStartLine = 1;
    let totalWords = 0;
    let totalChars = 0;

    const flushParagraph = () => {
      if (currentParagraphLines.length === 0) return;
      paragraphIndex++;
      const paraText = currentParagraphLines.join(' ').replace(/\s+/g, ' ').trim();
      currentParagraphLines = [];

      if (!paraText) return;

      const words = paraText.split(/\s+/).filter(Boolean);
      totalWords += words.length;
      totalChars += paraText.length;

      // Location label with heading breadcrumb and paragraph index
      const headingPrefix = currentHeading ? `Heading: ${currentHeading} > ` : '';
      const locationLabel = `${headingPrefix}Paragraf ${paragraphIndex} (Baris ${paraStartLine})`;

      // Break long paragraphs into sentences to guarantee precise sentence matching
      const sentences = paraText.split(/(?<=[.?!])\s+/).filter(Boolean);
      if (sentences.length > 1) {
        sentences.forEach((sentence, sIdx) => {
          const cleanSentence = sentence.trim();
          if (cleanSentence) {
            chunks.push({
              chunkIndex: chunks.length,
              locationType: 'heading_para',
              locationLabel: `${locationLabel} - Kalimat ${sIdx + 1}`,
              content: cleanSentence
            });
          }
        });
      } else {
        chunks.push({
          chunkIndex: chunks.length,
          locationType: 'heading_para',
          locationLabel,
          content: paraText
        });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Heading detection (# Heading 1, ## Heading 2, etc.)
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        flushParagraph();
        const level = headingMatch[1].length;
        const title = headingMatch[2].replace(/[#*`_]/g, '').trim();

        // Adjust heading stack based on level
        headingStack = headingStack.slice(0, level - 1);
        headingStack.push(title);
        currentHeading = headingStack.join(' / ');

        chunks.push({
          chunkIndex: chunks.length,
          locationType: 'heading_para',
          locationLabel: `Heading (Level ${level}, Baris ${i + 1})`,
          content: title
        });
        continue;
      }

      // Empty line signals end of paragraph
      if (!trimmed) {
        flushParagraph();
        continue;
      }

      // Collect line into current paragraph
      if (currentParagraphLines.length === 0) {
        paraStartLine = i + 1;
      }
      currentParagraphLines.push(trimmed);
    }

    // Flush last paragraph
    flushParagraph();

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

module.exports = new MarkdownParser();
