/**
 * MetadataEngine - Handles dynamic metadata, tag taxonomies,
 * and advanced multi-tag query parsing (e.g. "link+role").
 */
class MetadataEngine {
  constructor() {
    this.schema = {
      fields: [],
      tagPalette: {}
    };
  }

  setSchema(schema) {
    if (schema && typeof schema === 'object') {
      this.schema = {
        fields: Array.isArray(schema.fields) ? schema.fields : [],
        tagPalette: schema.tagPalette || {}
      };
    }
  }

  getSchema() {
    return this.schema;
  }

  getFieldDefinition(key) {
    return this.schema.fields.find(f => f.key.toLowerCase() === key.toLowerCase()) || null;
  }

  getTagColor(tag) {
    const cleanTag = tag.toLowerCase().trim();
    if (this.schema.tagPalette && this.schema.tagPalette[cleanTag]) {
      return this.schema.tagPalette[cleanTag];
    }
    // Deterministic pleasant color generation for unknown tags
    const palette = [
      '#6366f1', '#06b6d4', '#10b981', '#f59e0b',
      '#ec4899', '#8b5cf6', '#3b82f6', '#14b8a6', '#f97316'
    ];
    let hash = 0;
    for (let i = 0; i < cleanTag.length; i++) {
      hash = cleanTag.charCodeAt(i) + ((hash << 5) - hash);
    }
    return palette[Math.abs(hash) % palette.length];
  }

  /**
   * Parse user search query into tag requirements and text terms.
   * Supports:
   *   - "link+role" (AND: requires both 'link' AND 'role' tag)
   *   - "link+role+vpn"
   *   - "link, role" (OR: requires either)
   *   - "tag:link + tag:role"
   *   - free text terms combined with tags
   */
  parseQuery(queryString) {
    if (!queryString || !queryString.trim()) {
      return { isEmpty: true, tagGroups: [], terms: [] };
    }

    const raw = queryString.trim();

    // Check if user is using '+' syntax (e.g. link+role or link + role)
    if (raw.includes('+')) {
      const parts = raw.split('+').map(p => p.trim()).filter(Boolean);
      const requiredTags = [];
      const textTerms = [];

      for (const part of parts) {
        let clean = part.replace(/^tag:/i, '').replace(/^#/, '').toLowerCase().trim();
        if (clean) {
          requiredTags.push(clean);
        }
      }

      return {
        isEmpty: false,
        mode: 'AND_TAGS',
        requiredTags,
        textTerms
      };
    }

    // Check if user is using comma syntax (e.g. link, role -> OR)
    if (raw.includes(',')) {
      const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
      const orTags = [];
      for (const part of parts) {
        let clean = part.replace(/^tag:/i, '').replace(/^#/, '').toLowerCase().trim();
        if (clean) {
          orTags.push(clean);
        }
      }
      return {
        isEmpty: false,
        mode: 'OR_TAGS',
        orTags,
        textTerms: []
      };
    }

    // Standard space-separated query
    const tokens = raw.split(/\s+/).map(t => t.trim()).filter(Boolean);
    const requiredTags = [];
    const textTerms = [];

    for (const token of tokens) {
      if (token.startsWith('#')) {
        requiredTags.push(token.slice(1).toLowerCase());
      } else if (token.toLowerCase().startsWith('tag:')) {
        requiredTags.push(token.slice(4).toLowerCase());
      } else {
        textTerms.push(token.toLowerCase());
      }
    }

    return {
      isEmpty: false,
      mode: 'MIXED',
      requiredTags,
      textTerms
    };
  }

  /**
   * Evaluates if a card matches the parsed query
   */
  matches(card, parsedQuery) {
    if (parsedQuery.isEmpty) return true;

    const cardTags = (card.tags || []).map(t => t.toLowerCase().trim());
    const cardTitle = (card.title || '').toLowerCase();
    const cardContent = (card.content || '').toLowerCase();
    
    // Metadata search corpus
    let metadataCorpus = '';
    if (card.metadata && typeof card.metadata === 'object') {
      for (const [k, v] of Object.entries(card.metadata)) {
        metadataCorpus += ` ${k} ${String(v)}`.toLowerCase();
      }
    }

    // Checklist text corpus
    let checklistCorpus = '';
    if (Array.isArray(card.checklist)) {
      checklistCorpus = card.checklist.map(c => c.text || '').join(' ').toLowerCase();
    }

    const fullCorpus = `${cardTitle} ${cardContent} ${metadataCorpus} ${checklistCorpus} ${cardTags.join(' ')}`;

    // Mode: AND_TAGS (e.g. link+role)
    if (parsedQuery.mode === 'AND_TAGS') {
      // Must contain all required tags OR terms
      return parsedQuery.requiredTags.every(req => {
        // First check exact or partial tag match
        const matchesTag = cardTags.some(t => t.includes(req) || req.includes(t));
        if (matchesTag) return true;
        // Or check if the requirement exists anywhere in corpus
        return fullCorpus.includes(req);
      });
    }

    // Mode: OR_TAGS (e.g. link, role)
    if (parsedQuery.mode === 'OR_TAGS') {
      return parsedQuery.orTags.some(req => {
        const matchesTag = cardTags.some(t => t.includes(req) || req.includes(t));
        return matchesTag || fullCorpus.includes(req);
      });
    }

    // Mode: MIXED
    // 1. Check all required tags
    const tagsMatch = parsedQuery.requiredTags.every(req => {
      return cardTags.some(t => t.includes(req));
    });
    if (!tagsMatch) return false;

    // 2. Check all free text terms
    const termsMatch = parsedQuery.textTerms.every(term => {
      // term could match a tag or text or metadata
      return cardTags.some(t => t.includes(term)) || fullCorpus.includes(term);
    });

    return termsMatch;
  }

  /**
   * Collect all unique tags and their frequencies from cards
   */
  extractAllTags(cards) {
    const counts = {};
    for (const card of cards) {
      if (Array.isArray(card.tags)) {
        for (const t of card.tags) {
          const clean = t.toLowerCase().trim();
          if (clean) {
            counts[clean] = (counts[clean] || 0) + 1;
          }
        }
      }
    }
    return Object.entries(counts)
      .map(([tag, count]) => ({ tag, count, color: this.getTagColor(tag) }))
      .sort((a, b) => b.count - a.count);
  }
}

// Export for browser & node
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MetadataEngine;
} else {
  window.MetadataEngine = MetadataEngine;
}
