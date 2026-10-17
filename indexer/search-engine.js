const fs = require('fs');
const path = require('path');

function levenshtein(a, b) {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix = [];
  for (let i = 0; i <= bn; i++) matrix[i] = [i];
  for (let j = 0; j <= an; j++) matrix[0][j] = j;

  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[bn][an];
}

class SearchEngine {
  constructor(db, options = {}) {
    this.db = db;
    this.synonymMap = options.synonymMap || {
      'info': ['information', 'informasi'],
      'pic': ['penanggung jawab', 'contact']
    };
  }

  normalizeText(str) {
    if (!str) return '';
    return str
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'’“”]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  parseSearchQuery(queryStr, forcedMode = null) {
    const raw = (queryStr || '').trim();
    if (!raw) {
      return { raw: '', isEmpty: true, mode: 'all_terms', terms: [], phrase: '' };
    }

    const isQuoted = (raw.startsWith('"') && raw.endsWith('"') && raw.length > 2) ||
                     (raw.startsWith("'") && raw.endsWith("'") && raw.length > 2);

    if (isQuoted || forcedMode === 'exact') {
      const phrase = raw.replace(/^["']|["']$/g, '').trim();
      const terms = phrase.split(/\s+/).filter(Boolean);
      return {
        raw,
        isEmpty: false,
        mode: 'exact',
        phrase,
        phraseNorm: this.normalizeText(phrase),
        terms,
        termsNorm: terms.map(t => this.normalizeText(t)).filter(Boolean)
      };
    }

    const terms = raw
      .replace(/[+,#]/g, ' ')
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t.length > 0);

    return {
      raw,
      isEmpty: false,
      mode: forcedMode || 'all_terms',
      phrase: raw,
      phraseNorm: this.normalizeText(raw),
      terms,
      termsNorm: terms.map(t => this.normalizeText(t)).filter(Boolean)
    };
  }

  searchDocuments(queryString, options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(options.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const parsed = this.parseSearchQuery(queryString, options.mode);
    if (parsed.isEmpty) {
      return { results: [], total: 0, page, limit, totalPages: 0, query: queryString };
    }

    let candidateRows = [];

    if (this.db.hasFTS5) {
      try {
        candidateRows = this.queryViaFts(parsed);
      } catch (ftsErr) {
        candidateRows = [];
      }
    }

    // If FTS returned few or zero rows (e.g. slight typo like "weekeepit" vs "wekeepit"),
    // perform table candidate scan with OR matching across terms to discover candidates
    if (candidateRows.length === 0) {
      candidateRows = this.queryViaTable(parsed);
    }

    // Evaluate candidates strictly:
    // ALL terms must match inside the single chunk (exact or typo distance <= 1)
    const scoredMatches = [];
    const seenChunkIds = new Set();

    for (const row of candidateRows) {
      if (seenChunkIds.has(row.id)) continue;
      seenChunkIds.add(row.id);

      const matchEval = this.evaluateChunkMatch(row, parsed, options.enableSynonyms);
      if (matchEval.matched) {
        scoredMatches.push({
          chunk: row,
          score: matchEval.score,
          matchedTerms: matchEval.matchedTerms
        });
      }
    }

    // Sort by relevance score descending
    scoredMatches.sort((a, b) => b.score - a.score);

    const total = scoredMatches.length;
    const paginated = scoredMatches.slice(offset, offset + limit);

    const results = paginated.map(({ chunk, score, matchedTerms }) => {
      const snippetData = this.generateSnippet(chunk.content, matchedTerms);
      return {
        id: chunk.id,
        documentId: chunk.document_id,
        filename: chunk.filename,
        extension: chunk.extension,
        filePath: chunk.path,
        locationType: chunk.location_type,
        locationLabel: chunk.location_label,
        snippet: snippetData.snippet,
        highlightedHtml: snippetData.highlightedHtml,
        score
      };
    });

    return {
      results,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      query: queryString,
      mode: parsed.mode
    };
  }

  queryViaFts(parsed) {
    if (parsed.mode === 'exact') {
      const cleanPhrase = parsed.phrase.replace(/["*]/g, '').trim();
      return this.db.db.prepare(`
        SELECT c.*, d.filename, d.extension, d.path, d.folder_id
        FROM document_chunks_fts f
        JOIN document_chunks c ON c.rowid = f.rowid
        JOIN documents d ON d.id = c.document_id
        WHERE document_chunks_fts MATCH ?
        LIMIT 500
      `).all(`"${cleanPhrase}"`);
    }

    const ftsTerms = parsed.termsNorm.map(t => `"${t.replace(/["*]/g, '')}"`).filter(Boolean);
    if (ftsTerms.length === 0) return [];

    const ftsQuery = ftsTerms.join(' AND ');
    return this.db.db.prepare(`
      SELECT c.*, d.filename, d.extension, d.path, d.folder_id
      FROM document_chunks_fts f
      JOIN document_chunks c ON c.rowid = f.rowid
      JOIN documents d ON d.id = c.document_id
      WHERE document_chunks_fts MATCH ?
      LIMIT 500
    `).all(ftsQuery);
  }

  queryViaTable(parsed) {
    if (parsed.termsNorm.length === 0) return [];
    
    // Select chunks that match at least one term as initial candidate pool
    const conditions = parsed.termsNorm.map(() => 'c.clean_content LIKE ?').join(' OR ');
    const params = parsed.termsNorm.map(t => `%${t}%`);

    // Also include all chunks if candidate set is small (up to 500 rows)
    const sql = `
      SELECT c.*, d.filename, d.extension, d.path, d.folder_id
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE ${conditions}
      LIMIT 500
    `;

    try {
      const rows = this.db.db.prepare(sql).all(...params);
      if (rows.length > 0) return rows;
    } catch (e) {}

    // Fallback if typo means LIKE '%weekeepit%' returned nothing: scan all chunks up to 500
    return this.db.db.prepare(`
      SELECT c.*, d.filename, d.extension, d.path, d.folder_id
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      LIMIT 500
    `).all();
  }

  evaluateChunkMatch(row, parsed, enableSynonyms = false) {
    const rawContent = row.content || '';
    const cleanContent = this.normalizeText(rawContent);
    const chunkWords = cleanContent.split(/\s+/).filter(Boolean);

    let score = 0;
    const matchedTermsInDoc = new Set();

    if (parsed.mode === 'exact') {
      const target = parsed.phraseNorm;
      if (cleanContent.includes(target)) {
        score += 100;
        matchedTermsInDoc.add(parsed.phrase);
        return { matched: true, score, matchedTerms: Array.from(matchedTermsInDoc) };
      }
      return { matched: false, score: 0, matchedTerms: [] };
    }

    // Mode B: All terms, unordered
    // EVERY term must find a match within THIS chunk
    for (const term of parsed.termsNorm) {
      let termMatched = false;
      let matchedWord = null;

      // 1. Exact whole-word match (or exact phrase match if term contains spaces)
      if (term.includes(' ')) {
        if (cleanContent.includes(term)) {
          termMatched = true;
          matchedWord = term;
        }
      } else {
        const foundWord = chunkWords.find(w => w === term);
        if (foundWord) {
          termMatched = true;
          matchedWord = foundWord;
        }
      }

      // 2. Optional synonym check (only when explicitly enabled)
      if (!termMatched && enableSynonyms && this.synonymMap[term]) {
        for (const syn of this.synonymMap[term]) {
          const normSyn = this.normalizeText(syn);
          if (normSyn.includes(' ')) {
            if (cleanContent.includes(normSyn)) {
              termMatched = true;
              matchedWord = normSyn;
              break;
            }
          } else {
            const foundSyn = chunkWords.find(w => w === normSyn);
            if (foundSyn) {
              termMatched = true;
              matchedWord = foundSyn;
              break;
            }
          }
        }
      }

      // 3. Typo / Levenshtein distance check (distance <= 1 for non-numeric terms of length >= 5)
      // Excludes pure numeric tokens to prevent false-positive ID/year/port substitutions
      const isNumeric = /^\d+$/.test(term);
      if (!termMatched && !isNumeric && term.length >= 5) {
        for (const w of chunkWords) {
          if (!/^\d+$/.test(w) && w.length >= 4 && Math.abs(w.length - term.length) <= 1) {
            const dist = levenshtein(term, w);
            if (dist <= 1) {
              termMatched = true;
              matchedWord = w;
              break;
            }
          }
        }
      }

      if (!termMatched) {
        // A term is completely missing from this chunk -> REJECT chunk!
        return { matched: false, score: 0, matchedTerms: [] };
      }

      score += 15;
      if (matchedWord) {
        matchedTermsInDoc.add(matchedWord);
      }
    }

    // Bonus for phrase match
    if (cleanContent.includes(parsed.phraseNorm)) {
      score += 50;
    }

    return {
      matched: true,
      score,
      matchedTerms: Array.from(matchedTermsInDoc)
    };
  }

  generateSnippet(corpus, keywords, maxSentences = 3) {
    if (!corpus || !corpus.trim()) {
      return { snippet: 'Isi teks kosong.', highlightedHtml: 'Isi teks kosong.' };
    }

    const text = corpus.trim();
    const lower = text.toLowerCase();
    const validKeywords = (keywords || []).filter(k => k && k.length >= 2);

    if (validKeywords.length === 0) {
      const slice = text.slice(0, 200).trim();
      const safe = this.escapeHtml(slice) + (text.length > 200 ? '...' : '');
      return { snippet: slice, highlightedHtml: safe };
    }

    // Expand keywords to include actual corpus words matching via case-insensitivity or Levenshtein <= 1
    const corpusWords = text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'’“”]/g, ' ').split(/\s+/).filter(Boolean);
    const resolvedKeywords = new Set();
    for (const kw of validKeywords) {
      resolvedKeywords.add(kw);
      for (const cw of corpusWords) {
        const kwLower = kw.toLowerCase();
        const cwLower = cw.toLowerCase();
        if (cwLower === kwLower ||
           (kw.length >= 5 && cw.length >= 4 && Math.abs(cw.length - kw.length) <= 1 && levenshtein(kwLower, cwLower) <= 1)) {
          resolvedKeywords.add(cw);
        }
      }
    }
    const finalKeywords = Array.from(resolvedKeywords);

    // Find first and last occurrences of any matched keyword
    let firstPos = -1;
    let lastPos = -1;

    for (const kw of finalKeywords) {
      const pos = lower.indexOf(kw.toLowerCase());
      if (pos !== -1) {
        if (firstPos === -1 || pos < firstPos) firstPos = pos;
        if (pos + kw.length > lastPos) lastPos = pos + kw.length;
      }
    }

    if (firstPos === -1) {
      const slice = text.slice(0, 200).trim();
      const safe = this.escapeHtml(slice) + (text.length > 200 ? '...' : '');
      return { snippet: slice, highlightedHtml: safe };
    }

    const start = Math.max(0, firstPos - 80);
    const end = Math.min(text.length, Math.max(lastPos + 120, start + 240));

    let snippet = text.slice(start, end).trim();

    if (start > 0) {
      const spaceIdx = snippet.indexOf(' ');
      if (spaceIdx > 0 && spaceIdx < 30) {
        snippet = snippet.slice(spaceIdx + 1);
      }
      snippet = '...' + snippet;
    }

    if (end < text.length) {
      const lastSpace = snippet.lastIndexOf(' ');
      if (lastSpace > 0 && lastSpace > snippet.length - 30) {
        snippet = snippet.slice(0, lastSpace);
      }
      snippet = snippet + '...';
    }

    // Highlight matched words
    const safeSnippet = this.escapeHtml(snippet);
    const escapedKws = finalKeywords.map(k => this.escapeRegex(this.escapeHtml(k)));
    const pattern = new RegExp(`(${escapedKws.join('|')})`, 'gi');
    const highlightedHtml = safeSnippet.replace(pattern, '<mark class="search-highlight">$1</mark>');

    return {
      snippet,
      highlightedHtml
    };
  }

  searchBoardCards(cards, query, metaEngine) {
    if (!query || !query.trim()) return cards;
    const parsedQuery = metaEngine.parseQuery(query);
    return cards.filter(card => metaEngine.matches(card, parsedQuery));
  }
}

module.exports = SearchEngine;
