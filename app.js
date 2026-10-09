/**
 * WeKeepIt - Main Application Controller
 */

(function () {
  'use strict';

  // State
  let cards = [];
  let currentTab = 'all'; // 'all', 'pinned', 'reminders', 'checklist'
  let currentDensity = 'normal'; // 'normal', 'compact'
  let searchQuery = '';
  let isServerAvailable = false;
  let activeAlertCard = null;

  // Instances
  const metaEngine = new MetadataEngine();
  const reminderService = new ReminderService(
    handleReminderTriggered,
    handleCardUpdated
  );

  // DOM Elements
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const tagChipsContainer = document.getElementById('tagChipsContainer');
  const cardsGrid = document.getElementById('cardsGrid');
  const pinnedGrid = document.getElementById('pinnedGrid');
  const pinnedSection = document.getElementById('pinnedSection');
  const cardsSection = document.getElementById('cardsSection');
  const cardsSectionTitle = document.getElementById('cardsSectionTitle');
  const filterNotice = document.getElementById('filterNotice');
  const filterQueryDisplay = document.getElementById('filterQueryDisplay');
  const resetFilterBtn = document.getElementById('resetFilterBtn');
  const emptyState = document.getElementById('emptyState');
  const emptyDesc = document.getElementById('emptyDesc');
  const syncStatus = document.getElementById('syncStatus');

  // Tab counts
  const countAll = document.getElementById('countAll');
  const countPinned = document.getElementById('countPinned');
  const countReminders = document.getElementById('countReminders');
  const countChecklist = document.getElementById('countChecklist');
  const pinnedBadge = document.getElementById('pinnedBadge');
  const cardsBadge = document.getElementById('cardsBadge');

  // Modals
  const cardModal = document.getElementById('cardModal');
  const cardModalTitle = document.getElementById('cardModalTitle');
  const cardForm = document.getElementById('cardForm');
  const editCardId = document.getElementById('editCardId');
  const formTitle = document.getElementById('formTitle');
  const formPinned = document.getElementById('formPinned');
  const formContent = document.getElementById('formContent');
  const formTags = document.getElementById('formTags');
  const tagSuggestions = document.getElementById('tagSuggestions');
  const colorPickerPalette = document.getElementById('colorPickerPalette');
  const metadataFieldsContainer = document.getElementById('metadataFieldsContainer');
  const checklistItemsList = document.getElementById('checklistItemsList');
  const newChecklistText = document.getElementById('newChecklistText');
  const addChecklistBtn = document.getElementById('addChecklistBtn');
  const checklistCountPreview = document.getElementById('checklistCountPreview');
  const reminderDateTime = document.getElementById('reminderDateTime');
  const reminderRepeat = document.getElementById('reminderRepeat');

  const schemaModal = document.getElementById('schemaModal');
  const schemaFieldsList = document.getElementById('schemaFieldsList');
  const dataModal = document.getElementById('dataModal');
  const reminderToast = document.getElementById('reminderToast');

  // Form State
  let editingChecklist = [];
  let selectedColor = '#6366f1';

  // --- INITIALIZATION ---
  async function init() {
    setupNativeBridge();
    setupEventListeners();
    await checkServer();
    await loadSchema();
    await loadCards();
    reminderService.init();
    renderAll();
  }

  async function checkServer() {
    try {
      const res = await fetch('/api/ping', { cache: 'no-store' });
      if (res.ok) {
        isServerAvailable = true;
        updateSyncStatus(true, 'Tersinkron ke Disk (wekeepit-data.json)');
        return;
      }
    } catch (e) {
      // Offline / standalone
    }
    isServerAvailable = false;
    updateSyncStatus(false, 'Mode Lokal (Browser Storage)');
  }

  function updateSyncStatus(online, text) {
    if (!syncStatus) return;
    const dot = syncStatus.querySelector('.status-dot');
    const label = syncStatus.querySelector('.status-text');
    if (dot) {
      dot.className = online ? 'status-dot online' : 'status-dot offline';
    }
    if (label) {
      label.textContent = text;
    }
  }

  // --- DATA SYNC & NATIVE BRIDGE ---
  function setupNativeBridge() {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.addEventListener('message', (event) => {
        try {
          const msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (msg && msg.type === 'INIT_DATA_RESPONSE') {
            if (msg.cardsJson) {
              const loadedCards = JSON.parse(msg.cardsJson);
              if (Array.isArray(loadedCards) && loadedCards.length > 0) {
                cards = loadedCards;
                localStorage.setItem('wekeepit_cards_backup', JSON.stringify(cards));
                reminderService.setCards(cards);
                renderAll();
              }
            }
            if (msg.schemaJson) {
              const loadedSchema = JSON.parse(msg.schemaJson);
              if (loadedSchema && loadedSchema.fields) {
                metaEngine.setSchema(loadedSchema);
                localStorage.setItem('wekeepit_schema_backup', JSON.stringify(loadedSchema));
              }
            }
          }
        } catch (err) {
          console.warn('Native message handling error:', err);
        }
      });

      // Request latest data immediately
      try {
        window.chrome.webview.postMessage(JSON.stringify({ type: 'REQUEST_INIT_DATA' }));
      } catch (e) {}
    }
  }

  async function loadCards() {
    // 1. Try local server API if running via server.js
    if (isServerAvailable) {
      try {
        const res = await fetch('/api/cards?_t=' + Date.now());
        if (res.ok) {
          const loaded = await res.json();
          if (Array.isArray(loaded) && loaded.length > 0) {
            cards = loaded;
            localStorage.setItem('wekeepit_cards_backup', JSON.stringify(cards));
            reminderService.setCards(cards);
            return;
          }
        }
      } catch (err) {}
    }

    // 2. Try direct local JSON file with cache buster (works in WebView2 desktop app mode!)
    try {
      const res = await fetch('wekeepit-data.json?_t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const loaded = await res.json();
        if (Array.isArray(loaded) && loaded.length > 0) {
          cards = loaded;
          localStorage.setItem('wekeepit_cards_backup', JSON.stringify(cards));
          reminderService.setCards(cards);
          return;
        }
      }
    } catch (err) {}

    // 3. Fallback to localStorage backup
    const local = localStorage.getItem('wekeepit_cards_backup');
    if (local) {
      try {
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed) && parsed.length > 0) {
          cards = parsed;
          reminderService.setCards(cards);
          return;
        }
      } catch (e) {}
    }

    // Fallback: request from native host
    if (window.chrome && window.chrome.webview) {
      try {
        window.chrome.webview.postMessage(JSON.stringify({ type: 'REQUEST_INIT_DATA' }));
      } catch (e) {}
    }

    if (!cards || !Array.isArray(cards)) cards = [];
    reminderService.setCards(cards);
  }

  async function saveCards() {
    localStorage.setItem('wekeepit_cards_backup', JSON.stringify(cards));
    reminderService.setCards(cards);

    // Native Desktop App Bridge (C# WebView2)
    if (window.chrome && window.chrome.webview) {
      try {
        window.chrome.webview.postMessage(JSON.stringify({
          type: 'SAVE_CARDS',
          data: cards
        }));
      } catch (e) {
        console.warn('Native desktop bridge error:', e);
      }
    }

    // Node Server API
    if (isServerAvailable) {
      try {
        await fetch('/api/cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cards)
        });
      } catch (err) {
        console.warn('Gagal sinkron ke server:', err);
      }
    }
  }

  async function loadSchema() {
    if (isServerAvailable) {
      try {
        const res = await fetch('/api/schema?_t=' + Date.now());
        if (res.ok) {
          const schema = await res.json();
          metaEngine.setSchema(schema);
          localStorage.setItem('wekeepit_schema_backup', JSON.stringify(schema));
          return;
        }
      } catch (err) {}
    }

    // Direct local schema fetch with cache buster
    try {
      const res = await fetch('metadata-schema.json?_t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const schema = await res.json();
        metaEngine.setSchema(schema);
        localStorage.setItem('wekeepit_schema_backup', JSON.stringify(schema));
        return;
      }
    } catch (err) {}

    const local = localStorage.getItem('wekeepit_schema_backup');
    if (local) {
      try {
        metaEngine.setSchema(JSON.parse(local));
        return;
      } catch (e) {}
    }

    // Default schema
    metaEngine.setSchema({
      fields: [
        { key: 'url', label: 'Link / URL', type: 'url', icon: '🔗' },
        { key: 'role', label: 'Role / Akses', type: 'badge', icon: '👤' },
        { key: 'environment', label: 'Environment', type: 'select', icon: '🌐', options: ['Development', 'Staging', 'Production', 'UAT', 'Local'] },
        { key: 'priority', label: 'Prioritas', type: 'select', icon: '🔥', options: ['Low', 'Medium', 'High', 'Critical'] },
        { key: 'pic', label: 'PIC', type: 'text', icon: '🏷️' }
      ],
      tagPalette: {
        link: '#3b82f6',
        role: '#8b5cf6',
        harian: '#10b981',
        reminder: '#f59e0b',
        pengumuman: '#ef4444'
      }
    });
  }

  async function saveSchema() {
    const schema = metaEngine.getSchema();
    localStorage.setItem('wekeepit_schema_backup', JSON.stringify(schema));

    // Native Desktop App Bridge
    if (window.chrome && window.chrome.webview) {
      try {
        window.chrome.webview.postMessage(JSON.stringify({
          type: 'SAVE_SCHEMA',
          data: schema
        }));
      } catch (e) {}
    }

    if (isServerAvailable) {
      try {
        await fetch('/api/schema', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(schema)
        });
      } catch (err) {}
    }
  }

  // --- EVENT LISTENERS ---
  function setupEventListeners() {
    // Search input
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      clearSearchBtn.style.display = searchQuery ? 'inline-block' : 'none';
      renderAll();
    });

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      clearSearchBtn.style.display = 'none';
      renderAll();
      searchInput.focus();
    });

    resetFilterBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      clearSearchBtn.style.display = 'none';
      renderAll();
    });

    // Navigation tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.getAttribute('data-tab');
        renderAll();
      });
    });

    // Density toggle
    document.querySelectorAll('.density-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.density-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentDensity = btn.getAttribute('data-density');
        if (currentDensity === 'compact') {
          cardsGrid.classList.add('compact');
          pinnedGrid.classList.add('compact');
        } else {
          cardsGrid.classList.remove('compact');
          pinnedGrid.classList.remove('compact');
        }
      });
    });

    // Theme toggle (Dark Solid vs Dark Transparan Acrylic)
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const themeLabel = document.getElementById('themeLabel');

    function applyTheme(isAcrylic) {
      document.body.classList.toggle('theme-acrylic', isAcrylic);
      if (themeLabel) {
        themeLabel.textContent = isAcrylic ? 'Transparan' : 'Solid';
      }
      localStorage.setItem('wekeepit_theme', isAcrylic ? 'acrylic' : 'solid');
      if (window.chrome && window.chrome.webview) {
        try {
          window.chrome.webview.postMessage(JSON.stringify({ type: 'SET_THEME', transparent: isAcrylic }));
        } catch (e) {}
      }
    }

    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const isCurrentAcrylic = document.body.classList.contains('theme-acrylic');
        applyTheme(!isCurrentAcrylic);
      });
    }

    // Default to acrylic (transparent) as requested
    const savedTheme = localStorage.getItem('wekeepit_theme') || 'acrylic';
    applyTheme(savedTheme === 'acrylic');

    // Widget mode toggle
    const widgetModeBtn = document.getElementById('widgetModeBtn');
    widgetModeBtn.addEventListener('click', () => {
      document.body.classList.toggle('widget-mode');
      const isWidget = document.body.classList.contains('widget-mode');
      widgetModeBtn.querySelector('.btn-label').textContent = isWidget ? 'Mode Penuh' : 'Mode Widget';
    });

    // Modals open/close
    document.getElementById('newCardBtn').addEventListener('click', () => openCardModal());
    document.getElementById('emptyActionBtn').addEventListener('click', () => openCardModal());
    document.getElementById('closeCardModal').addEventListener('click', closeCardModal);
    document.getElementById('cancelCardModal').addEventListener('click', closeCardModal);
    cardModal.addEventListener('click', (e) => {
      if (e.target === cardModal) closeCardModal();
    });

    // Manage Schema modal
    document.getElementById('manageSchemaBtn').addEventListener('click', openSchemaModal);
    document.getElementById('closeSchemaModal').addEventListener('click', () => schemaModal.style.display = 'none');
    document.getElementById('cancelSchemaModal').addEventListener('click', () => schemaModal.style.display = 'none');
    schemaModal.addEventListener('click', (e) => {
      if (e.target === schemaModal) schemaModal.style.display = 'none';
    });

    // Data Export / Import modal
    document.getElementById('exportImportBtn').addEventListener('click', () => dataModal.style.display = 'flex');
    document.getElementById('closeDataModal').addEventListener('click', () => dataModal.style.display = 'none');
    document.getElementById('closeDataModalBtn').addEventListener('click', () => dataModal.style.display = 'none');
    dataModal.addEventListener('click', (e) => {
      if (e.target === dataModal) dataModal.style.display = 'none';
    });

    document.getElementById('downloadJsonBtn').addEventListener('click', exportDataJson);
    document.getElementById('triggerImportBtn').addEventListener('click', () => {
      document.getElementById('importFileInput').click();
    });
    document.getElementById('importFileInput').addEventListener('change', importDataJson);

    // Collapsibles in card editor
    setupCollapsible('toggleMetadataFields');
    setupCollapsible('toggleChecklist');
    setupCollapsible('toggleReminder');

    // Color swatches selection
    colorPickerPalette.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        colorPickerPalette.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        selectedColor = swatch.getAttribute('data-color');
      });
    });

    // Checklist add button
    addChecklistBtn.addEventListener('click', addChecklistItem);
    newChecklistText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addChecklistItem();
      }
    });

    // Reminder presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        applyReminderPreset(btn.getAttribute('data-preset'));
      });
    });

    // Card Form Submit
    cardForm.addEventListener('submit', handleCardFormSubmit);

    // Tag autocomplete in modal
    formTags.addEventListener('input', updateTagSuggestions);

    // Schema Add Field
    const newFieldType = document.getElementById('newFieldType');
    const newFieldOptionsGroup = document.getElementById('newFieldOptionsGroup');
    newFieldType.addEventListener('change', () => {
      newFieldOptionsGroup.style.display = newFieldType.value === 'select' ? 'flex' : 'none';
    });
    document.getElementById('addFieldBtn').addEventListener('click', handleAddNewSchemaField);
    document.getElementById('saveSchemaBtn').addEventListener('click', () => {
      saveSchema();
      schemaModal.style.display = 'none';
      renderAll();
    });

    // In-app Reminder Toast
    document.getElementById('toastCloseBtn').addEventListener('click', () => {
      reminderToast.style.display = 'none';
    });
    document.getElementById('toastSnoozeBtn').addEventListener('click', () => {
      if (activeAlertCard) reminderService.snooze(activeAlertCard.id, 10);
      reminderToast.style.display = 'none';
      renderAll();
    });
    document.getElementById('toastDismissBtn').addEventListener('click', () => {
      if (activeAlertCard) reminderService.dismiss(activeAlertCard.id);
      reminderToast.style.display = 'none';
      renderAll();
    });
  }

  function setupCollapsible(headerId) {
    const header = document.getElementById(headerId);
    if (!header) return;
    const parent = header.closest('.form-group-collapsible');
    header.addEventListener('click', () => {
      parent.classList.toggle('collapsed');
    });
  }

  // --- RENDER LOGIC ---
  function renderAll() {
    renderTagChips();
    renderCards();
    updateTabCounts();
  }

  function renderTagChips() {
    const allTags = metaEngine.extractAllTags(cards);
    const tagBarSection = document.getElementById('tagBarSection');
    tagChipsContainer.innerHTML = '';

    if (allTags.length === 0) {
      if (tagBarSection) tagBarSection.style.display = 'none';
      return;
    }

    if (tagBarSection) tagBarSection.style.display = 'block';

    const parsed = metaEngine.parseQuery(searchQuery);
    const activeTags = parsed.requiredTags || parsed.orTags || [];

    allTags.forEach(({ tag, count, color }) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      const isActive = activeTags.includes(tag);
      chip.className = `tag-chip ${isActive ? 'active' : ''}`;
      chip.innerHTML = `
        <span style="color:${color}">●</span>
        <span>#${tag}</span>
        <span class="tag-chip-count">${count}</span>
      `;

      chip.addEventListener('click', () => {
        handleTagChipClick(tag);
      });

      tagChipsContainer.appendChild(chip);
    });
  }

  /**
   * Interactive multi-tag filter toggle:
   * Clicking tag combines with '+' e.g. "link" -> "link+role"
   */
  function handleTagChipClick(tag) {
    if (!searchQuery) {
      searchQuery = tag;
    } else {
      const parts = searchQuery.split('+').map(p => p.trim().toLowerCase());
      if (parts.includes(tag.toLowerCase())) {
        const remaining = parts.filter(p => p !== tag.toLowerCase());
        searchQuery = remaining.join('+');
      } else {
        searchQuery = `${searchQuery}+${tag}`;
      }
    }

    searchInput.value = searchQuery;
    clearSearchBtn.style.display = searchQuery ? 'inline-block' : 'none';
    renderAll();
  }

  function renderCards() {
    const parsedQuery = metaEngine.parseQuery(searchQuery);

    // Update filter notice
    if (!parsedQuery.isEmpty) {
      filterNotice.style.display = 'flex';
      let displayMsg = '';
      if (parsedQuery.mode === 'AND_TAGS') {
        displayMsg = `Wajib semua tag: [${parsedQuery.requiredTags.join(' + ')}]`;
      } else if (parsedQuery.mode === 'OR_TAGS') {
        displayMsg = `Salah satu tag: [${parsedQuery.orTags.join(' atau ')}]`;
      } else {
        displayMsg = `"${searchQuery}"`;
      }
      filterQueryDisplay.textContent = displayMsg;
    } else {
      filterNotice.style.display = 'none';
    }

    // Filter matching cards
    let filtered = cards.filter(card => metaEngine.matches(card, parsedQuery));

    // Tab-based filtering
    if (currentTab === 'pinned') {
      filtered = filtered.filter(c => c.pinned);
      cardsSectionTitle.textContent = '📌 Disematkan';
    } else if (currentTab === 'reminders') {
      filtered = filtered.filter(c => c.reminder && c.reminder.datetime);
      cardsSectionTitle.textContent = '⏰ Reminder';
    } else if (currentTab === 'checklist') {
      filtered = filtered.filter(c => Array.isArray(c.checklist) && c.checklist.length > 0);
      cardsSectionTitle.textContent = '✅ Checklist';
    } else {
      cardsSectionTitle.textContent = '📋 Catatan';
    }

    const cardsSectionHeader = document.getElementById('cardsSectionHeader');

    // Separate pinned cards if in 'all' tab
    if (currentTab === 'all' && parsedQuery.isEmpty) {
      const pinnedCards = filtered.filter(c => c.pinned);
      const regularCards = filtered.filter(c => !c.pinned);

      if (pinnedCards.length > 0) {
        pinnedSection.style.display = 'block';
        pinnedBadge.textContent = `${pinnedCards.length}`;
        renderCardList(pinnedGrid, pinnedCards);
      } else {
        pinnedSection.style.display = 'none';
      }

      if (cardsSectionHeader) {
        cardsSectionHeader.style.display = (pinnedCards.length > 0 && regularCards.length > 0) ? 'flex' : 'none';
      }

      cardsBadge.textContent = `${regularCards.length}`;
      renderCardList(cardsGrid, regularCards);

      if (filtered.length === 0) {
        emptyState.style.display = 'flex';
        cardsSection.style.display = 'none';
      } else {
        emptyState.style.display = 'none';
        cardsSection.style.display = 'block';
      }
    } else {
      // Flat list for specific tabs or active search
      pinnedSection.style.display = 'none';
      if (cardsSectionHeader) cardsSectionHeader.style.display = 'flex';
      cardsSection.style.display = filtered.length > 0 ? 'block' : 'none';
      cardsBadge.textContent = `${filtered.length}`;
      renderCardList(cardsGrid, filtered);

      if (filtered.length === 0) {
        emptyState.style.display = 'flex';
        emptyDesc.textContent = searchQuery
          ? `Tidak ada kartu dengan pencarian "${searchQuery}".`
          : 'Belum ada catatan pada kategori ini.';
      } else {
        emptyState.style.display = 'none';
      }
    }
  }

  function renderCardList(container, cardItems) {
    container.innerHTML = '';
    cardItems.forEach(card => {
      const cardEl = createCardElement(card);
      container.appendChild(cardEl);
    });
  }

  function createCardElement(card) {
    const cardEl = document.createElement('div');
    cardEl.className = `card ${card.pinned ? 'pinned' : ''}`;
    cardEl.style.setProperty('--card-color', card.color || '#6366f1');

    // Header
    const headerEl = document.createElement('div');
    headerEl.className = 'card-header';
    headerEl.innerHTML = `
      <div class="card-title-group">
        <h3 class="card-title">${escapeHtml(card.title || 'Tanpa Judul')}</h3>
      </div>
      <div class="card-actions">
        <button class="card-action-btn pinned-btn ${card.pinned ? 'active' : ''}" title="${card.pinned ? 'Lepas Pin' : 'Pin ke Papan'}" data-action="pin">
          📌
        </button>
        <button class="card-action-btn" title="Salin Isi Catatan" data-action="copy">
          📋
        </button>
        <button class="card-action-btn" title="Edit Catatan" data-action="edit">
          ✏️
        </button>
        <button class="card-action-btn" title="Hapus Catatan" data-action="delete">
          🗑️
        </button>
      </div>
    `;

    // Tags
    const tagsEl = document.createElement('div');
    tagsEl.className = 'card-tags';
    if (Array.isArray(card.tags) && card.tags.length > 0) {
      card.tags.forEach(t => {
        const cleanTag = t.trim();
        if (!cleanTag) return;
        const tagPill = document.createElement('span');
        tagPill.className = 'card-tag-pill';
        tagPill.style.setProperty('--tag-color', metaEngine.getTagColor(cleanTag));
        tagPill.textContent = `#${cleanTag}`;
        tagPill.title = `Klik untuk filter tag "${cleanTag}"`;
        tagPill.addEventListener('click', (e) => {
          e.stopPropagation();
          handleTagChipClick(cleanTag);
        });
        tagsEl.appendChild(tagPill);
      });
    }

    // Content body
    const contentEl = document.createElement('div');
    contentEl.className = 'card-content';
    contentEl.innerHTML = formatCardContent(card.content || '');

    // Dynamic Metadata
    const metadataBox = createMetadataBox(card.metadata);

    // Checklist
    const checklistBox = createChecklistBox(card);

    // Footer (Reminder & Date)
    const footerEl = createCardFooter(card);

    // Assemble Card
    cardEl.appendChild(headerEl);
    if (card.tags && card.tags.length > 0) cardEl.appendChild(tagsEl);
    if (card.content) cardEl.appendChild(contentEl);
    if (metadataBox) cardEl.appendChild(metadataBox);
    if (checklistBox) cardEl.appendChild(checklistBox);
    cardEl.appendChild(footerEl);

    // Card Action Events
    cardEl.querySelector('[data-action="pin"]').addEventListener('click', () => {
      card.pinned = !card.pinned;
      card.updatedAt = new Date().toISOString();
      saveCards();
      renderAll();
    });

    cardEl.querySelector('[data-action="copy"]').addEventListener('click', () => {
      const textToCopy = `${card.title}\n\n${card.content || ''}`;
      navigator.clipboard.writeText(textToCopy).then(() => {
        alertToast('Konten disalin ke clipboard!');
      });
    });

    cardEl.querySelector('[data-action="edit"]').addEventListener('click', () => {
      openCardModal(card);
    });

    cardEl.querySelector('[data-action="delete"]').addEventListener('click', () => {
      if (confirm(`Hapus catatan "${card.title}"?`)) {
        cards = cards.filter(c => c.id !== card.id);
        saveCards();
        renderAll();
      }
    });

    return cardEl;
  }

  function createMetadataBox(metadata) {
    if (!metadata || typeof metadata !== 'object' || Object.keys(metadata).length === 0) {
      return null;
    }

    const box = document.createElement('div');
    box.className = 'card-metadata-box';

    for (const [key, val] of Object.entries(metadata)) {
      if (val === undefined || val === null || val === '') continue;
      const fieldDef = metaEngine.getFieldDefinition(key);
      const icon = fieldDef ? fieldDef.icon : '🏷️';
      const label = fieldDef ? fieldDef.label : key;
      const type = fieldDef ? fieldDef.type : 'text';

      const row = document.createElement('div');
      row.className = 'metadata-row';

      const keyEl = document.createElement('span');
      keyEl.className = 'metadata-key';
      keyEl.innerHTML = `${icon} ${escapeHtml(label)}`;

      const valEl = document.createElement('span');
      valEl.className = 'metadata-val';

      if (type === 'url' || String(val).startsWith('http://') || String(val).startsWith('https://')) {
        valEl.innerHTML = `
          <a href="${escapeHtml(val)}" target="_blank" rel="noopener noreferrer" class="metadata-link-btn">
            🔗 Buka Link
          </a>
        `;
      } else if (type === 'badge' || key === 'role') {
        valEl.innerHTML = `<span class="metadata-role-badge">${escapeHtml(val)}</span>`;
      } else {
        valEl.textContent = val;
      }

      row.appendChild(keyEl);
      row.appendChild(valEl);
      box.appendChild(row);
    }

    return box.children.length > 0 ? box : null;
  }

  function createChecklistBox(card) {
    if (!Array.isArray(card.checklist) || card.checklist.length === 0) {
      return null;
    }

    const total = card.checklist.length;
    const completed = card.checklist.filter(c => c.done).length;
    const percentage = Math.round((completed / total) * 100);

    const box = document.createElement('div');
    box.className = 'card-checklist-box';

    // Progress bar
    const progressWrap = document.createElement('div');
    progressWrap.className = 'checklist-progress-bar-wrap';
    progressWrap.innerHTML = `
      <div class="checklist-progress-track">
        <div class="checklist-progress-fill" style="width: ${percentage}%"></div>
      </div>
      <span>${completed}/${total} (${percentage}%)</span>
    `;
    box.appendChild(progressWrap);

    // Items
    card.checklist.forEach(item => {
      const itemEl = document.createElement('label');
      itemEl.className = `checklist-item ${item.done ? 'done' : ''}`;
      
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = !!item.done;

      chk.addEventListener('change', () => {
        item.done = chk.checked;
        card.updatedAt = new Date().toISOString();
        saveCards();
        renderAll();
      });

      const span = document.createElement('span');
      span.textContent = item.text;

      itemEl.appendChild(chk);
      itemEl.appendChild(span);
      box.appendChild(itemEl);
    });

    return box;
  }

  function createCardFooter(card) {
    const footer = document.createElement('div');
    footer.className = 'card-footer';

    // Reminder badge
    let reminderEl = '';
    if (card.reminder && card.reminder.datetime) {
      const dueTime = new Date(card.reminder.datetime);
      const isPast = dueTime < new Date();
      const countdown = reminderService.formatCountdown(card.reminder.datetime);
      const repeatIcon = card.reminder.repeat === 'daily' ? ' 🔁' : '';
      reminderEl = `
        <span class="reminder-badge ${isPast ? 'overdue' : ''}" title="Target: ${dueTime.toLocaleString()}">
          ⏰ ${countdown}${repeatIcon}
        </span>
      `;
    }

    // Time ago
    const timeAgo = formatTimeAgo(card.updatedAt || card.createdAt);

    footer.innerHTML = `
      <div>${reminderEl}</div>
      <div class="card-time">${timeAgo}</div>
    `;

    return footer;
  }

  function updateTabCounts() {
    countAll.textContent = cards.length;
    countPinned.textContent = cards.filter(c => c.pinned).length;
    countReminders.textContent = cards.filter(c => c.reminder && c.reminder.datetime).length;
    countChecklist.textContent = cards.filter(c => Array.isArray(c.checklist) && c.checklist.length > 0).length;
  }

  // --- CARD MODAL / FORM ---
  function openCardModal(card = null) {
    cardForm.reset();
    editingChecklist = [];
    selectedColor = '#6366f1';

    // Reset palette
    colorPickerPalette.querySelectorAll('.color-swatch').forEach(s => {
      s.classList.toggle('active', s.getAttribute('data-color') === selectedColor);
    });

    // Populate schema fields into container
    renderMetadataFormFields(card ? card.metadata : {});

    if (card) {
      cardModalTitle.textContent = 'Edit Catatan';
      editCardId.value = card.id;
      formTitle.value = card.title || '';
      formPinned.checked = !!card.pinned;
      formContent.value = card.content || '';
      formTags.value = Array.isArray(card.tags) ? card.tags.join(', ') : '';

      selectedColor = card.color || '#6366f1';
      colorPickerPalette.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('active', s.getAttribute('data-color') === selectedColor);
      });

      if (Array.isArray(card.checklist)) {
        editingChecklist = JSON.parse(JSON.stringify(card.checklist));
      }

      if (card.reminder) {
        reminderDateTime.value = card.reminder.datetime ? card.reminder.datetime.slice(0, 16) : '';
        reminderRepeat.value = card.reminder.repeat || 'none';
      }
    } else {
      cardModalTitle.textContent = 'Buat Catatan Baru';
      editCardId.value = '';
    }

    renderChecklistEditor();
    cardModal.style.display = 'flex';
    formTitle.focus();
  }

  function closeCardModal() {
    cardModal.style.display = 'none';
  }

  function renderMetadataFormFields(existingData = {}) {
    metadataFieldsContainer.innerHTML = '';
    const schema = metaEngine.getSchema();

    if (!schema.fields || schema.fields.length === 0) {
      metadataFieldsContainer.innerHTML = '<span style="font-size:0.75rem; color:var(--text-dim);">Belum ada konfigurasi field metadata. Klik roda gigi ⚙️ di atas untuk menambah.</span>';
      return;
    }

    schema.fields.forEach(field => {
      const group = document.createElement('div');
      group.className = 'form-group';

      const label = document.createElement('label');
      label.className = 'form-label';
      label.innerHTML = `${field.icon || '🏷️'} ${escapeHtml(field.label || field.key)}`;
      group.appendChild(label);

      const val = existingData[field.key] || '';

      if (field.type === 'select' && Array.isArray(field.options)) {
        const select = document.createElement('select');
        select.className = 'form-select';
        select.name = `meta_${field.key}`;
        select.innerHTML = `<option value="">-- Pilih --</option>` +
          field.options.map(opt => `<option value="${escapeHtml(opt)}" ${val === opt ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('');
        group.appendChild(select);
      } else {
        const input = document.createElement('input');
        input.type = field.type === 'url' ? 'url' : 'text';
        input.className = 'form-input';
        input.name = `meta_${field.key}`;
        input.value = val;
        input.placeholder = field.placeholder || `Masukkan ${field.label || field.key}...`;
        group.appendChild(input);
      }

      metadataFieldsContainer.appendChild(group);
    });
  }

  function renderChecklistEditor() {
    checklistItemsList.innerHTML = '';
    checklistCountPreview.textContent = editingChecklist.length;

    editingChecklist.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'checklist-builder-item';
      row.innerHTML = `
        <input type="checkbox" ${item.done ? 'checked' : ''} data-index="${index}">
        <input type="text" class="form-input" value="${escapeHtml(item.text)}" data-index="${index}">
        <button type="button" class="checklist-del-btn" data-index="${index}" title="Hapus">✕</button>
      `;

      row.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
        editingChecklist[index].done = e.target.checked;
      });

      row.querySelector('input[type="text"]').addEventListener('input', (e) => {
        editingChecklist[index].text = e.target.value;
      });

      row.querySelector('.checklist-del-btn').addEventListener('click', () => {
        editingChecklist.splice(index, 1);
        renderChecklistEditor();
      });

      checklistItemsList.appendChild(row);
    });
  }

  function addChecklistItem() {
    const text = newChecklistText.value.trim();
    if (!text) return;
    editingChecklist.push({
      id: 'chk-' + Date.now() + Math.random().toString(36).slice(2, 5),
      text,
      done: false
    });
    newChecklistText.value = '';
    renderChecklistEditor();
    newChecklistText.focus();
  }

  function applyReminderPreset(preset) {
    const now = new Date();
    if (preset === '1h') {
      now.setHours(now.getHours() + 1);
      reminderDateTime.value = now.toISOString().slice(0, 16);
    } else if (preset === 'today17') {
      now.setHours(17, 0, 0, 0);
      reminderDateTime.value = now.toISOString().slice(0, 16);
    } else if (preset === 'tomorrow9') {
      now.setDate(now.getDate() + 1);
      now.setHours(9, 0, 0, 0);
      reminderDateTime.value = now.toISOString().slice(0, 16);
    } else if (preset === 'clear') {
      reminderDateTime.value = '';
    }
  }

  function updateTagSuggestions() {
    const currentInput = formTags.value;
    const tokens = currentInput.split(/[\s,]+/).filter(Boolean);
    const lastToken = tokens.length ? tokens[tokens.length - 1].toLowerCase() : '';

    tagSuggestions.innerHTML = '';
    if (!lastToken) return;

    const allTags = metaEngine.extractAllTags(cards);
    const matches = allTags.filter(t => t.tag.startsWith(lastToken) && !tokens.includes(t.tag)).slice(0, 5);

    matches.forEach(({ tag }) => {
      const pill = document.createElement('span');
      pill.className = 'tag-suggestion-pill';
      pill.textContent = `+ #${tag}`;
      pill.addEventListener('click', () => {
        tokens[tokens.length - 1] = tag;
        formTags.value = tokens.join(', ') + ', ';
        tagSuggestions.innerHTML = '';
        formTags.focus();
      });
      tagSuggestions.appendChild(pill);
    });
  }

  async function handleCardFormSubmit(e) {
    e.preventDefault();

    const title = formTitle.value.trim();
    if (!title) return;

    const id = editCardId.value || 'card-' + Date.now();
    const isNew = !editCardId.value;

    // Collect tags
    const tagsRaw = formTags.value.split(/[\s,]+/).map(t => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean);
    const tags = Array.from(new Set(tagsRaw));

    // Collect dynamic metadata
    const metadata = {};
    const metaInputs = metadataFieldsContainer.querySelectorAll('[name^="meta_"]');
    metaInputs.forEach(input => {
      const key = input.name.replace('meta_', '');
      const val = input.value.trim();
      if (val) {
        metadata[key] = val;
      }
    });

    // Collect reminder
    let reminder = null;
    if (reminderDateTime.value) {
      reminder = {
        datetime: reminderDateTime.value,
        repeat: reminderRepeat.value,
        dismissed: false
      };
    }

    const cardPayload = {
      id,
      title,
      content: formContent.value.trim(),
      color: selectedColor,
      pinned: formPinned.checked,
      tags,
      metadata,
      checklist: editingChecklist.filter(c => c.text && c.text.trim()),
      reminder,
      updatedAt: new Date().toISOString()
    };

    if (isNew) {
      cardPayload.createdAt = new Date().toISOString();
      cards.unshift(cardPayload);
    } else {
      const idx = cards.findIndex(c => c.id === id);
      if (idx !== -1) {
        cardPayload.createdAt = cards[idx].createdAt || cardPayload.updatedAt;
        cards[idx] = cardPayload;
      } else {
        cards.unshift(cardPayload);
      }
    }

    await saveCards();
    closeCardModal();
    renderAll();
  }

  // --- SCHEMA MODAL ---
  function openSchemaModal() {
    renderSchemaList();
    schemaModal.style.display = 'flex';
  }

  function renderSchemaList() {
    schemaFieldsList.innerHTML = '';
    const schema = metaEngine.getSchema();

    schema.fields.forEach((field, index) => {
      const row = document.createElement('div');
      row.className = 'schema-field-row';
      row.innerHTML = `
        <div class="schema-field-info">
          <span class="schema-field-icon">${field.icon || '🏷️'}</span>
          <span class="schema-field-name">${escapeHtml(field.label)} <code>(${escapeHtml(field.key)})</code></span>
          <span class="schema-field-type">${field.type}</span>
        </div>
        <button type="button" class="checklist-del-btn" title="Hapus field">✕</button>
      `;

      row.querySelector('.checklist-del-btn').addEventListener('click', () => {
        schema.fields.splice(index, 1);
        metaEngine.setSchema(schema);
        renderSchemaList();
      });

      schemaFieldsList.appendChild(row);
    });
  }

  function handleAddNewSchemaField() {
    const key = document.getElementById('newFieldKey').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const label = document.getElementById('newFieldLabel').value.trim();
    const type = document.getElementById('newFieldType').value;
    const icon = document.getElementById('newFieldIcon').value.trim() || '🏷️';
    const optionsRaw = document.getElementById('newFieldOptions').value.trim();

    if (!key || !label) {
      alert('Kunci (Key) dan Label wajib diisi!');
      return;
    }

    const schema = metaEngine.getSchema();
    if (schema.fields.some(f => f.key === key)) {
      alert(`Field dengan kunci "${key}" sudah ada!`);
      return;
    }

    const newField = { key, label, type, icon };
    if (type === 'select') {
      newField.options = optionsRaw.split(',').map(o => o.trim()).filter(Boolean);
    }

    schema.fields.push(newField);
    metaEngine.setSchema(schema);

    // Reset inputs
    document.getElementById('newFieldKey').value = '';
    document.getElementById('newFieldLabel').value = '';
    document.getElementById('newFieldIcon').value = '';
    document.getElementById('newFieldOptions').value = '';

    renderSchemaList();
  }

  // --- EXPORT & IMPORT ---
  function exportDataJson() {
    const backupData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      schema: metaEngine.getSchema(),
      cards: cards
    };

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `wekeepit-backup-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
  }

  function importDataJson(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (Array.isArray(parsed)) {
          cards = parsed;
        } else if (parsed && Array.isArray(parsed.cards)) {
          cards = parsed.cards;
          if (parsed.schema) {
            metaEngine.setSchema(parsed.schema);
            await saveSchema();
          }
        } else {
          throw new Error('Format file JSON tidak dikenali');
        }

        await saveCards();
        renderAll();
        dataModal.style.display = 'none';
        alertToast('Data berhasil diimpor!');
      } catch (err) {
        alert('Gagal mengimpor file: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // --- REMINDERS & TOAST ---
  function handleReminderTriggered(card) {
    activeAlertCard = card;
    document.getElementById('toastTitle').textContent = `⏰ Pengingat: ${card.title}`;
    document.getElementById('toastDesc').textContent = card.content ? card.content.slice(0, 120) : 'Waktunya menyelesaikan agenda!';
    reminderToast.style.display = 'flex';
  }

  function handleCardUpdated(card) {
    const idx = cards.findIndex(c => c.id === card.id);
    if (idx !== -1) {
      cards[idx] = card;
      saveCards();
      renderAll();
    }
  }

  function alertToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'reminder-toast';
    toast.style.background = '#065f46';
    toast.style.borderColor = '#10b981';
    toast.innerHTML = `
      <div class="toast-icon">✓</div>
      <div class="toast-body"><span style="color:#fff">${escapeHtml(msg)}</span></div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  // --- HELPERS ---
  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatCardContent(text) {
    if (!text) return '';
    const escaped = escapeHtml(text);
    // Auto-link URLs
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    return escaped.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function formatTimeAgo(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return 'Baru saja';
    if (diff < 3600) return `${Math.floor(diff / 60)}m lalu`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}j lalu`;
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  }

  // Start app
  document.addEventListener('DOMContentLoaded', init);
})();
