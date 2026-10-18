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

  // V2 Domain & Search State
  let currentDomain = 'board'; // 'board', 'documents', 'search'
  let searchScope = 'all'; // 'all', 'board', 'documents'
  let searchMode = 'all_terms'; // 'all_terms', 'exact'
  let searchResults = { items: [], total: 0, page: 1, limit: 10, totalPages: 1 };
  let searchDebounceTimer = null;
  let foldersList = [];
  let indexedDocsList = [];
  let statusPollTimer = null;

  // Instances
  const metaEngine = new MetadataEngine();
  const docEngine = new DocumentEngine();
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
  const countDocuments = document.getElementById('countDocuments');
  const countReminders = document.getElementById('countReminders');
  const countChecklist = document.getElementById('countChecklist');
  const pinnedBadge = document.getElementById('pinnedBadge');
  const cardsBadge = document.getElementById('cardsBadge');

  // V2 Domain & Navigation DOM Elements
  const tabDomainBoard = document.getElementById('tabDomainBoard');
  const tabDomainDocs = document.getElementById('tabDomainDocs');
  const tabDomainSearch = document.getElementById('tabDomainSearch');
  const countSearchResults = document.getElementById('countSearchResults');
  const boardView = document.getElementById('boardView');
  const documentsView = document.getElementById('documentsView');
  const searchResultsView = document.getElementById('searchResultsView');
  const searchScopeSelect = document.getElementById('searchScopeSelect');
  const searchModeSelect = document.getElementById('searchModeSelect');
  const boardFilterTabs = document.getElementById('boardFilterTabs');
  const viewDensityToggle = document.getElementById('viewDensityToggle');

  // Documents View DOM Elements
  const statFoldersCount = document.getElementById('statFoldersCount');
  const statDocsCount = document.getElementById('statDocsCount');
  const statChunksCount = document.getElementById('statChunksCount');
  const statIndexerBadge = document.getElementById('statIndexerBadge');
  const statIndexerStatusText = document.getElementById('statIndexerStatusText');
  const indexingProgressBanner = document.getElementById('indexingProgressBanner');
  const progressCounterText = document.getElementById('progressCounterText');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressFilenameText = document.getElementById('progressFilenameText');
  const foldersGrid = document.getElementById('foldersGrid');
  const foldersEmptyNotice = document.getElementById('foldersEmptyNotice');
  const indexedFilesTableBody = document.getElementById('indexedFilesTableBody');
  const indexedFilesBadge = document.getElementById('indexedFilesBadge');
  const addFolderBtn = document.getElementById('addFolderBtn');
  const reindexAllBtn = document.getElementById('reindexAllBtn');

  // Folder Modal DOM Elements
  const folderModal = document.getElementById('folderModal');
  const addFolderForm = document.getElementById('addFolderForm');
  const folderPathInput = document.getElementById('folderPathInput');
  const folderRecursiveCheck = document.getElementById('folderRecursiveCheck');
  const folderExclusionsInput = document.getElementById('folderExclusionsInput');
  const closeFolderModal = document.getElementById('closeFolderModal');
  const cancelFolderModal = document.getElementById('cancelFolderModal');

  // Search Results DOM Elements
  const searchSummaryText = document.getElementById('searchSummaryText');
  const searchResultsList = document.getElementById('searchResultsList');
  const searchPaginationBar = document.getElementById('searchPaginationBar');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const paginationInfo = document.getElementById('paginationInfo');

  // Modals
  const cardModal = document.getElementById('cardModal');
  const cardModalTitle = document.getElementById('cardModalTitle');
  const cardForm = document.getElementById('cardForm');
  const cardTypeSelect = document.getElementById('cardTypeSelect');
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

  // Document Vault DOM Elements
  const toggleAttachments = document.getElementById('toggleAttachments');
  const attachmentsCountPreview = document.getElementById('attachmentsCountPreview');
  const attachmentDropZone = document.getElementById('attachmentDropZone');
  const documentFileInput = document.getElementById('documentFileInput');
  const triggerDocUploadBtn = document.getElementById('triggerDocUploadBtn');
  const attachmentExtractingIndicator = document.getElementById('attachmentExtractingIndicator');
  const extractingStatusText = document.getElementById('extractingStatusText');
  const attachmentsEditorList = document.getElementById('attachmentsEditorList');

  // Document Viewer Modal DOM Elements
  const docViewerModal = document.getElementById('docViewerModal');
  const docViewerTitle = document.getElementById('docViewerTitle');
  const docViewerIcon = document.getElementById('docViewerIcon');
  const docViewerMeta = document.getElementById('docViewerMeta');
  const docViewerContent = document.getElementById('docViewerContent');
  const closeDocViewerModal = document.getElementById('closeDocViewerModal');
  const closeDocViewerModalBtn = document.getElementById('closeDocViewerModalBtn');
  const copyDocTextBtn = document.getElementById('copyDocTextBtn');
  const downloadDocFileBtn = document.getElementById('downloadDocFileBtn');
  let activeViewerDoc = null;

  const schemaModal = document.getElementById('schemaModal');
  const schemaFieldsList = document.getElementById('schemaFieldsList');
  const dataModal = document.getElementById('dataModal');
  const reminderToast = document.getElementById('reminderToast');

  // Form State
  let editingChecklist = [];
  let editingAttachments = [];
  let selectedColor = '#6366f1';

  // --- SERVER & API HELPERS ---
  const API_BASE = (window.location.origin && window.location.origin.includes(':4321')) ? '' : 'http://127.0.0.1:4321';

  function apiUrl(endpoint) {
    return API_BASE + endpoint;
  }

  // --- INITIALIZATION ---
  async function init() {
    setupNativeBridge();
    setupEventListeners();
    await checkServer();
    await loadSchema();
    await loadCards();
    reminderService.init();
    renderAll();
    if (isServerAvailable) {
      pollIndexerStatus();
    }
    // Auto-reconnect polling if server was started after page loaded
    setInterval(async () => {
      if (!isServerAvailable) {
        await checkServer();
      }
    }, 2000);
  }

  async function checkServer() {
    try {
      const res = await fetch(apiUrl('/api/ping'), { cache: 'no-store' });
      if (res.ok) {
        const wasOffline = !isServerAvailable;
        isServerAvailable = true;
        updateSyncStatus(true, 'Tersinkron ke Disk (wekeepit-data.json)');
        if (wasOffline) {
          if (currentDomain === 'documents') {
            loadFoldersAndDocuments();
          }
          pollIndexerStatus();
        }
        return true;
      }
    } catch (e) {
      // Offline / standalone
    }
    isServerAvailable = false;
    updateSyncStatus(false, 'Mode Lokal (Browser Storage)');
    return false;
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
          } else if (msg && msg.type === 'FOLDER_PICKED' && msg.path) {
            const folderInput = document.getElementById('folderPathInput');
            if (folderInput) {
              folderInput.value = msg.path;
              folderInput.focus();
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
        const res = await fetch(apiUrl('/api/cards?_t=') + Date.now());
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
        await fetch(apiUrl('/api/cards'), {
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
        const res = await fetch(apiUrl('/api/schema?_t=') + Date.now());
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
        await fetch(apiUrl('/api/schema'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(schema)
        });
      } catch (err) {}
    }
  }

  // --- EVENT LISTENERS ---
  function setupEventListeners() {
    // V2 Domain navigation tabs
    document.querySelectorAll('.domain-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const domain = tab.getAttribute('data-domain');
        switchDomain(domain);
      });
    });

    // Search input
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      clearSearchBtn.style.display = searchQuery ? 'inline-block' : 'none';
      if (searchScope !== 'documents') {
        renderAll();
      }
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      if (searchScope !== 'board' && searchQuery) {
        searchDebounceTimer = setTimeout(() => {
          performDocumentSearch(1);
        }, 300);
      } else if (!searchQuery) {
        if (countSearchResults) countSearchResults.style.display = 'none';
        if (currentDomain === 'search') renderSearchEmptyPrompt();
      }
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (searchQuery && searchScope !== 'board') {
          if (currentDomain !== 'search') {
            switchDomain('search');
          }
          performDocumentSearch(1);
        }
      }
    });

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      clearSearchBtn.style.display = 'none';
      if (countSearchResults) countSearchResults.style.display = 'none';
      renderAll();
      if (currentDomain === 'search') renderSearchEmptyPrompt();
      searchInput.focus();
    });

    resetFilterBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      clearSearchBtn.style.display = 'none';
      if (countSearchResults) countSearchResults.style.display = 'none';
      renderAll();
      if (currentDomain === 'search') renderSearchEmptyPrompt();
    });

    // V2 Search Scope & Mode
    if (searchScopeSelect) {
      searchScopeSelect.addEventListener('change', () => {
        searchScope = searchScopeSelect.value;
        if (searchScope === 'documents' && currentDomain !== 'search') {
          switchDomain('search');
        } else if (searchScope === 'board' && currentDomain === 'search') {
          switchDomain('board');
        }
        if (searchQuery) {
          if (searchScope !== 'documents') renderAll();
          if (searchScope !== 'board') performDocumentSearch(1);
        }
      });
    }

    if (searchModeSelect) {
      searchModeSelect.addEventListener('change', () => {
        searchMode = searchModeSelect.value;
        if (searchQuery && searchScope !== 'board') {
          performDocumentSearch(1);
        }
      });
    }

    // Work Board Navigation tabs
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

    // Theme & Appearance Manager
    const THEMES = [
      { id: 'obsidian', name: 'Obsidian', headerHex: '#161b22', dot: 'linear-gradient(135deg, #0e1117 50%, #6366f1 50%)' },
      { id: 'ocean', name: 'Deep Ocean', headerHex: '#0f172a', dot: 'linear-gradient(135deg, #070d19 50%, #0284c7 50%)' },
      { id: 'forest', name: 'Nord Forest', headerHex: '#0d2017', dot: 'linear-gradient(135deg, #07140e 50%, #059669 50%)' },
      { id: 'amethyst', name: 'Amethyst', headerHex: '#181128', dot: 'linear-gradient(135deg, #0f0a1a 50%, #9333ea 50%)' },
      { id: 'amber', name: 'Sunset Amber', headerHex: '#1c150e', dot: 'linear-gradient(135deg, #120d08 50%, #d97706 50%)' },
      { id: 'cyberpunk', name: 'Cyberpunk', headerHex: '#0c0d14', dot: 'linear-gradient(135deg, #050508 50%, #00f0ff 50%)' },
      { id: 'crimson', name: 'Crimson Rose', headerHex: '#1c0c10', dot: 'linear-gradient(135deg, #120709 50%, #e11d48 50%)' }
    ];

    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const themeMenuDropdown = document.getElementById('themeMenuDropdown');
    const themeLabel = document.getElementById('themeLabel');
    const themePaletteGrid = document.getElementById('themePaletteGrid');
    const themeOptAcrylic = document.getElementById('themeOptAcrylic');
    const themeOptGlow = document.getElementById('themeOptGlow');
    const themeOptMono = document.getElementById('themeOptMono');

    let currentThemeId = localStorage.getItem('wekeepit_theme_palette') || 'obsidian';
    let isAcrylic = localStorage.getItem('wekeepit_theme') !== 'solid'; // default true
    let isGlow = localStorage.getItem('wekeepit_theme_glow') === 'true';
    let isMono = localStorage.getItem('wekeepit_theme_mono') === 'true';

    function renderThemeChips() {
      if (!themePaletteGrid) return;
      themePaletteGrid.innerHTML = '';
      THEMES.forEach(t => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `theme-chip-btn ${t.id === currentThemeId ? 'active' : ''}`;
        btn.dataset.themeId = t.id;
        btn.innerHTML = `
          <span class="theme-dot" style="background: ${t.dot}"></span>
          <span class="theme-chip-name">${t.name}</span>
          <span class="theme-chip-check">✓</span>
        `;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          setThemePalette(t.id);
        });
        themePaletteGrid.appendChild(btn);
      });
    }

    function setThemePalette(themeId) {
      currentThemeId = themeId;
      document.documentElement.setAttribute('data-theme', themeId);
      localStorage.setItem('wekeepit_theme_palette', themeId);

      const themeObj = THEMES.find(t => t.id === themeId);
      if (themeLabel && themeObj) {
        themeLabel.textContent = themeObj.name;
      }

      renderThemeChips();
      notifyNativeTheme();
    }

    function applyCosmetics() {
      document.body.classList.toggle('theme-acrylic', isAcrylic);
      document.body.classList.toggle('effect-glow', isGlow);
      document.body.classList.toggle('font-mono', isMono);

      if (themeOptAcrylic) themeOptAcrylic.checked = isAcrylic;
      if (themeOptGlow) themeOptGlow.checked = isGlow;
      if (themeOptMono) themeOptMono.checked = isMono;

      localStorage.setItem('wekeepit_theme', isAcrylic ? 'acrylic' : 'solid');
      localStorage.setItem('wekeepit_theme_glow', isGlow ? 'true' : 'false');
      localStorage.setItem('wekeepit_theme_mono', isMono ? 'true' : 'false');

      notifyNativeTheme();
    }

    function notifyNativeTheme() {
      if (window.chrome && window.chrome.webview) {
        try {
          const themeObj = THEMES.find(t => t.id === currentThemeId);
          window.chrome.webview.postMessage(JSON.stringify({
            type: 'SET_THEME',
            transparent: isAcrylic,
            headerColor: themeObj ? themeObj.headerHex : '#161b22'
          }));
        } catch (e) {}
      }
    }

    if (themeToggleBtn && themeMenuDropdown) {
      themeToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        themeMenuDropdown.classList.toggle('hidden');
      });

      document.addEventListener('click', (e) => {
        if (!themeMenuDropdown.contains(e.target) && e.target !== themeToggleBtn && !themeToggleBtn.contains(e.target)) {
          themeMenuDropdown.classList.add('hidden');
        }
      });
    }

    if (themeOptAcrylic) {
      themeOptAcrylic.addEventListener('change', (e) => {
        isAcrylic = e.target.checked;
        applyCosmetics();
      });
    }

    if (themeOptGlow) {
      themeOptGlow.addEventListener('change', (e) => {
        isGlow = e.target.checked;
        applyCosmetics();
      });
    }

    if (themeOptMono) {
      themeOptMono.addEventListener('change', (e) => {
        isMono = e.target.checked;
        applyCosmetics();
      });
    }

    setThemePalette(currentThemeId);
    applyCosmetics();

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

    // Card Type Selector (Mau Simpan Apa?)
    if (cardTypeSelect) {
      cardTypeSelect.addEventListener('change', () => {
        updateCardTypeView(cardTypeSelect.value);
      });
    }

    // Collapsibles in card editor
    setupCollapsible('toggleMetadataFields');
    setupCollapsible('toggleChecklist');
    setupCollapsible('toggleAttachments');
    setupCollapsible('toggleReminder');

    // Document Upload & Drop Zone
    if (triggerDocUploadBtn && documentFileInput) {
      triggerDocUploadBtn.addEventListener('click', () => documentFileInput.click());
      documentFileInput.addEventListener('change', handleDocumentFileInputChange);
    }

    if (attachmentDropZone) {
      attachmentDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        attachmentDropZone.classList.add('dragover');
      });
      attachmentDropZone.addEventListener('dragleave', () => {
        attachmentDropZone.classList.remove('dragover');
      });
      attachmentDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        attachmentDropZone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files) {
          handleDocumentFiles(Array.from(e.dataTransfer.files));
        }
      });
    }

    // Document Viewer Modal Actions
    if (closeDocViewerModal) closeDocViewerModal.addEventListener('click', () => { docViewerModal.style.display = 'none'; });
    if (closeDocViewerModalBtn) closeDocViewerModalBtn.addEventListener('click', () => { docViewerModal.style.display = 'none'; });
    if (docViewerModal) {
      docViewerModal.addEventListener('click', (e) => {
        if (e.target === docViewerModal) docViewerModal.style.display = 'none';
      });
    }
    if (copyDocTextBtn) copyDocTextBtn.addEventListener('click', copyActiveViewerDocText);
    if (downloadDocFileBtn) downloadDocFileBtn.addEventListener('click', downloadActiveViewerDocFile);

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

    // V2 Folder management & Indexer actions
    if (addFolderBtn) addFolderBtn.addEventListener('click', openFolderModal);
    if (closeFolderModal) closeFolderModal.addEventListener('click', closeFolderModalFn);
    if (cancelFolderModal) cancelFolderModal.addEventListener('click', closeFolderModalFn);
    if (folderModal) {
      folderModal.addEventListener('click', (e) => {
        if (e.target === folderModal) closeFolderModalFn();
      });
    }
    if (addFolderForm) addFolderForm.addEventListener('submit', handleAddFolderSubmit);
    if (reindexAllBtn) reindexAllBtn.addEventListener('click', handleReindexAll);

    // Browse Folder Explorer Button
    const browseFolderBtn = document.getElementById('browseFolderBtn');
    if (browseFolderBtn) {
      browseFolderBtn.addEventListener('click', async () => {
        // 1. Native Desktop App (WebView2)
        if (window.chrome && window.chrome.webview) {
          try {
            window.chrome.webview.postMessage(JSON.stringify({ type: 'PICK_FOLDER' }));
            return;
          } catch (e) {
            console.warn('Native picker bridge error, falling back:', e);
          }
        }

        // 2. Web Browser via local Node.js endpoint
        try {
          browseFolderBtn.disabled = true;
          const origText = browseFolderBtn.textContent;
          browseFolderBtn.textContent = '⏳ Membuka...';
          const res = await fetch(apiUrl('/api/browse-folder'));
          if (res.ok) {
            const data = await res.json();
            if (data && data.path && folderPathInput) {
              folderPathInput.value = data.path;
              folderPathInput.focus();
            }
          }
          browseFolderBtn.textContent = origText;
        } catch (err) {
          console.warn('API folder picker error:', err);
        } finally {
          browseFolderBtn.disabled = false;
          browseFolderBtn.textContent = '📂 Telusuri...';
        }
      });
    }

    // V2 Document Search Pagination
    if (prevPageBtn) {
      prevPageBtn.addEventListener('click', () => {
        if (searchResults && searchResults.page > 1) {
          performDocumentSearch(searchResults.page - 1);
        }
      });
    }
    if (nextPageBtn) {
      nextPageBtn.addEventListener('click', () => {
        if (searchResults && searchResults.page < searchResults.totalPages) {
          performDocumentSearch(searchResults.page + 1);
        }
      });
    }
  }

  // ==========================================================================
  // V2 DOMAIN & DOCUMENT CONTROLLERS
  // ==========================================================================

  function switchDomain(domain) {
    currentDomain = domain;

    // Update active tab buttons
    document.querySelectorAll('.domain-tab').forEach(tab => {
      tab.classList.toggle('active', tab.getAttribute('data-domain') === domain);
    });

    // Toggle view panels
    if (boardView) boardView.style.display = (domain === 'board') ? 'block' : 'none';
    if (documentsView) documentsView.style.display = (domain === 'documents') ? 'block' : 'none';
    if (searchResultsView) searchResultsView.style.display = (domain === 'search') ? 'block' : 'none';

    // Toggle Work Board header controls
    if (boardFilterTabs) boardFilterTabs.style.display = (domain === 'board') ? 'flex' : 'none';
    if (viewDensityToggle) viewDensityToggle.style.display = (domain === 'board') ? 'flex' : 'none';

    const tagBarSection = document.getElementById('tagBarSection');
    if (tagBarSection) {
      if (domain === 'board') {
        renderTagChips();
      } else {
        tagBarSection.style.display = 'none';
      }
    }

    if (domain === 'board') {
      renderAll();
    } else if (domain === 'documents') {
      checkServer().then(() => loadFoldersAndDocuments());
    } else if (domain === 'search') {
      if (searchQuery.trim()) {
        performDocumentSearch(searchResults.page || 1);
      } else {
        renderSearchEmptyPrompt();
      }
    }
  }

  // --- FOLDER MANAGEMENT ---
  function openFolderModal() {
    if (folderPathInput) folderPathInput.value = '';
    if (folderRecursiveCheck) folderRecursiveCheck.checked = true;
    if (folderExclusionsInput) folderExclusionsInput.value = '.git, node_modules, bin, obj, temp';
    if (folderModal) folderModal.style.display = 'flex';
    if (folderPathInput) folderPathInput.focus();
  }

  function closeFolderModalFn() {
    if (folderModal) folderModal.style.display = 'none';
  }

  async function handleAddFolderSubmit(e) {
    e.preventDefault();
    if (!folderPathInput) return;
    const folderPath = folderPathInput.value.trim();
    if (!folderPath) {
      alert('Path folder wajib diisi!');
      return;
    }

    const recursive = folderRecursiveCheck ? folderRecursiveCheck.checked : true;
    const exclusions = folderExclusionsInput
      ? folderExclusionsInput.value.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    try {
      const res = await fetch(apiUrl('/api/folders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath, recursive, exclusions })
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Gagal menambahkan folder');
      }

      closeFolderModalFn();
      alertToast('Folder berhasil didaftarkan! Memulai pemindaian berkas...');
      await loadFoldersAndDocuments();

      // Trigger automatic scan for the new folder
      if (result.folder && result.folder.id) {
        await fetch(apiUrl('/api/indexer/scan'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderId: result.folder.id })
        });
      }
      pollIndexerStatus();
    } catch (err) {
      alert('Gagal menambah folder: ' + err.message);
    }
  }

  async function handleReindexAll() {
    if (!isServerAvailable) {
      alert('Server lokal tidak tersedia.');
      return;
    }
    try {
      const res = await fetch(apiUrl('/api/indexer/scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (res.ok) {
        alertToast('Memulai pemindaian rekonsiliasi folder...');
        pollIndexerStatus();
      }
    } catch (err) {
      alert('Gagal memulai pemindaian: ' + err.message);
    }
  }

  function pollIndexerStatus() {
    if (statusPollTimer) clearTimeout(statusPollTimer);

    async function check() {
      if (!isServerAvailable) return;
      try {
        const res = await fetch(apiUrl('/api/indexer/status?_t=') + Date.now());
        if (res.ok) {
          const data = await res.json();
          updateIndexerStatusUI(data);

          if (data.status === 'scanning' || data.status === 'indexing') {
            statusPollTimer = setTimeout(check, 1200);
          } else {
            // Idle: if in documents view, refresh documents table
            if (currentDomain === 'documents') {
              const docsRes = await fetch(apiUrl('/api/documents?_t=') + Date.now());
              if (docsRes.ok) {
                indexedDocsList = await docsRes.json();
                renderIndexedDocsTable();
              }
            }
          }
        }
      } catch (e) {}
    }
    check();
  }

  function updateIndexerStatusUI(data) {
    if (!data) return;
    if (statFoldersCount) statFoldersCount.textContent = data.foldersCount !== undefined ? data.foldersCount : foldersList.length;
    if (statDocsCount) statDocsCount.textContent = data.documentsCount !== undefined ? data.documentsCount : indexedDocsList.length;
    if (statChunksCount) statChunksCount.textContent = (data.chunksCount || 0).toLocaleString();

    const isBusy = data.status === 'scanning' || data.status === 'indexing';
    if (statIndexerStatusText) {
      statIndexerStatusText.textContent = isBusy
        ? (data.status === 'scanning' ? 'Memindai Berkas...' : 'Mengindeks Teks...')
        : 'Siap (Idle)';
    }

    if (indexingProgressBanner) {
      if (isBusy) {
        indexingProgressBanner.style.display = 'flex';
        const progress = data.progress || {};
        const current = progress.current || 0;
        const total = progress.total || 0;
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;

        if (progressCounterText) progressCounterText.textContent = `${current}/${total} (${percent}%)`;
        if (progressBarFill) progressBarFill.style.width = `${percent}%`;
        if (progressFilenameText) {
          progressFilenameText.textContent = progress.file ? `Sedang memproses: ${progress.file}` : 'Memeriksa berkas...';
        }
      } else {
        indexingProgressBanner.style.display = 'none';
      }
    }
  }

  async function loadFoldersAndDocuments() {
    if (!isServerAvailable) {
      await checkServer();
    }
    if (!isServerAvailable) {
      renderOfflineDocsNotice();
      return;
    }
    try {
      const [foldersRes, docsRes, statusRes] = await Promise.all([
        fetch(apiUrl('/api/folders?_t=') + Date.now()),
        fetch(apiUrl('/api/documents?_t=') + Date.now()),
        fetch(apiUrl('/api/indexer/status?_t=') + Date.now())
      ]);

      if (foldersRes.ok) {
        foldersList = await foldersRes.json();
        renderFoldersList();
      }
      if (docsRes.ok) {
        indexedDocsList = await docsRes.json();
        renderIndexedDocsTable();
      }
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        updateIndexerStatusUI(statusData);
      }
    } catch (err) {
      console.error('Gagal memuat pustaka dokumen:', err);
    }
  }

  function renderOfflineDocsNotice() {
    if (foldersGrid) {
      foldersGrid.innerHTML = `
        <div class="folders-empty-notice" style="grid-column: 1 / -1; border-color: #ef4444; color: #f87171;">
          <h4>⚠️ Server Backend WeKeepIt Tidak Aktif</h4>
          <p style="margin-top: 0.5rem; color: #cbd5e1;">
            Fitur pengindeksan dokumen lokal (.md, .pdf, .docx, .xlsx) dan SQLite FTS5 memerlukan server lokal Node.js.<br>
            Jalankan <code>npm start</code> pada direktori aplikasi untuk mengaktifkannya.
          </p>
        </div>
      `;
    }
  }

  function renderFoldersList() {
    if (!foldersGrid) return;
    foldersGrid.innerHTML = '';

    if (!Array.isArray(foldersList) || foldersList.length === 0) {
      if (foldersEmptyNotice) foldersEmptyNotice.style.display = 'block';
      return;
    }
    if (foldersEmptyNotice) foldersEmptyNotice.style.display = 'none';

    foldersList.forEach(folder => {
      const card = document.createElement('div');
      card.className = 'folder-card';
      const isEnabled = folder.enabled !== 0 && folder.enabled !== false;
      const exclusions = Array.isArray(folder.exclusions)
        ? folder.exclusions.join(', ')
        : (folder.exclusions || '-');

      card.innerHTML = `
        <div class="folder-card-header">
          <div class="folder-card-path" title="${escapeHtml(folder.path)}">
            📂 ${escapeHtml(folder.path)}
          </div>
          <span class="badge ${isEnabled ? 'badge-success' : 'badge-warning'}">
            ${isEnabled ? 'Aktif' : 'Nonaktif'}
          </span>
        </div>
        <div class="folder-card-meta">
          <span>🔄 Rekursif: ${folder.recursive ? 'Ya' : 'Tidak'}</span>
          <span>•</span>
          <span>🚫 Kecualikan: <code>${escapeHtml(exclusions)}</code></span>
        </div>
        <div class="folder-card-actions">
          <button type="button" class="btn btn-secondary btn-sm btn-toggle-folder">
            ${isEnabled ? 'Jeda' : 'Aktifkan'}
          </button>
          <button type="button" class="btn btn-secondary btn-sm btn-scan-folder" title="Pindai folder ini">
            🔄 Pindai
          </button>
          <button type="button" class="btn btn-danger btn-sm btn-delete-folder" title="Hapus dari daftar indeks">
            🗑️ Hapus
          </button>
        </div>
      `;

      card.querySelector('.btn-toggle-folder').addEventListener('click', async () => {
        try {
          const res = await fetch(apiUrl(`/api/folders/${folder.id}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: !isEnabled })
          });
          if (res.ok) {
            alertToast(`Folder ${!isEnabled ? 'diaktifkan' : 'dinonaktifkan'}`);
            loadFoldersAndDocuments();
          }
        } catch (err) {
          alert('Gagal mengubah status: ' + err.message);
        }
      });

      card.querySelector('.btn-scan-folder').addEventListener('click', async () => {
        try {
          const res = await fetch(apiUrl('/api/indexer/scan'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderId: folder.id })
          });
          if (res.ok) {
            alertToast('Pemindaian folder dimulai...');
            pollIndexerStatus();
          }
        } catch (err) {
          alert('Gagal memindai: ' + err.message);
        }
      });

      card.querySelector('.btn-delete-folder').addEventListener('click', async () => {
        if (!confirm(`Hapus folder ini dari daftar indeks?\n(File asli di disk TIDAK akan dihapus)\n\n${folder.path}`)) {
          return;
        }
        try {
          const res = await fetch(apiUrl(`/api/folders/${folder.id}`), {
            method: 'DELETE'
          });
          if (res.ok) {
            alertToast('Folder dan indeksnya berhasil dihapus');
            loadFoldersAndDocuments();
          }
        } catch (err) {
          alert('Gagal menghapus folder: ' + err.message);
        }
      });

      foldersGrid.appendChild(card);
    });
  }

  function renderIndexedDocsTable() {
    if (!indexedFilesTableBody) return;
    indexedFilesTableBody.innerHTML = '';

    if (indexedFilesBadge) {
      indexedFilesBadge.textContent = `${indexedDocsList.length} berkas`;
    }

    if (!Array.isArray(indexedDocsList) || indexedDocsList.length === 0) {
      indexedFilesTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="table-empty-cell">Belum ada dokumen yang selesai diindeks. Tambahkan folder dan lakukan pemindaian.</td>
        </tr>
      `;
      return;
    }

    indexedDocsList.forEach(doc => {
      const tr = document.createElement('tr');
      const ext = (doc.extension || '').toLowerCase();
      let docIcon = '📄';
      if (ext === '.pdf') docIcon = '📕';
      else if (ext === '.docx') docIcon = '📘';
      else if (ext === '.xlsx') docIcon = '📊';

      const formattedSize = docEngine.formatSize(doc.size || 0);
      const chunkCount = doc.chunk_count !== undefined ? doc.chunk_count : (doc.chunkCount || 0);

      let statusBadge = '<span class="badge badge-success">✓ Terindeks</span>';
      if (doc.status === 'failed' || doc.status === 'error') {
        statusBadge = `<span class="badge badge-danger" title="${escapeHtml(doc.last_error || 'Gagal diproses')}">✕ Gagal</span>`;
      } else if (doc.status === 'processing') {
        statusBadge = '<span class="badge badge-warning">⏳ Memproses</span>';
      }

      tr.innerHTML = `
        <td>
          <span style="margin-right: 0.35rem;">${docIcon}</span>
          <strong title="${escapeHtml(doc.path)}">${escapeHtml(doc.file_name || doc.fileName || '')}</strong>
        </td>
        <td><code>${escapeHtml(ext.toUpperCase())}</code></td>
        <td>${formattedSize}</td>
        <td>${chunkCount} unit</td>
        <td>${statusBadge}</td>
        <td>
          <div class="doc-item-actions">
            <button type="button" class="btn-doc-action btn-open-file" title="Buka berkas di aplikasi default">
              📂 Buka
            </button>
            <button type="button" class="btn-doc-action btn-open-folder" title="Tampilkan lokasi berkas di folder">
              📍 Folder
            </button>
          </div>
        </td>
      `;

      tr.querySelector('.btn-open-file').addEventListener('click', () => {
        openLocalPath(doc.path, false);
      });

      tr.querySelector('.btn-open-folder').addEventListener('click', () => {
        openLocalPath(doc.path, true);
      });

      indexedFilesTableBody.appendChild(tr);
    });
  }

  // --- DOCUMENT SEARCH ---
  async function performDocumentSearch(page = 1) {
    if (!isServerAvailable) {
      if (countSearchResults) countSearchResults.style.display = 'none';
      if (searchResultsList) {
        searchResultsList.innerHTML = `
          <div class="search-empty-state">
            <p>Fitur pencarian dokumen memerlukan server lokal. Jalankan <code>npm start</code> di terminal.</p>
          </div>
        `;
      }
      return;
    }

    const query = searchQuery.trim();
    if (!query) {
      if (countSearchResults) countSearchResults.style.display = 'none';
      renderSearchEmptyPrompt();
      return;
    }

    try {
      const params = new URLSearchParams({
        q: query,
        mode: searchMode,
        scope: searchScope,
        page: String(page),
        limit: '10'
      });

      const res = await fetch(apiUrl(`/api/search?${params.toString()}`));
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      searchResults = data;

      // Update search badge on domain tab
      if (countSearchResults) {
        const docCount = data.total || 0;
        countSearchResults.textContent = docCount;
        countSearchResults.style.display = docCount > 0 ? 'inline-block' : 'none';
      }

      if (currentDomain === 'search') {
        renderSearchResultsUI(data);
      }
    } catch (err) {
      console.error('Search error:', err);
      if (currentDomain === 'search' && searchResultsList) {
        searchResultsList.innerHTML = `
          <div class="search-empty-state">
            <p>Terjadi kesalahan saat mencari dokumen: ${escapeHtml(err.message)}</p>
          </div>
        `;
      }
    }
  }

  function renderSearchResultsUI(data) {
    if (!searchResultsList) return;
    searchResultsList.innerHTML = '';

    const query = searchQuery.trim();
    const docData = (data && data.documents) ? data.documents : (data || {});
    const items = docData.results || docData.items || [];
    const total = (docData.total !== undefined) ? docData.total : items.length;
    const mode = docData.mode || data.mode || searchMode;
    const modeLabel = (mode === 'exact')
      ? 'Mode A: Frasa Tepat (Exact Verbatim Phrase)'
      : 'Mode B: Semua Kata (All Terms dalam 1 Kalimat)';

    if (searchSummaryText) {
      searchSummaryText.innerHTML = `Menampilkan <strong>${total}</strong> hasil untuk <strong>"${escapeHtml(query)}"</strong> (${modeLabel})`;
    }

    if (!items || items.length === 0) {
      searchResultsList.innerHTML = `
        <div class="search-empty-state">
          <div class="empty-icon">🔍</div>
          <h4 style="margin-bottom: 0.5rem; color: var(--text-main);">Tidak ditemukan kecocokan dokumen</h4>
          <p style="color: var(--text-muted); font-size: 0.88rem;">
            Tidak ada kutipan teks yang cocok dengan kata kunci <strong>"${escapeHtml(query)}"</strong> dalam mode <em>${modeLabel}</em>.
            <br>Coba periksa ejaan, gunakan kata kunci lebih umum, atau beralih ke mode <strong>Semua Kata</strong>.
          </p>
        </div>
      `;
      if (searchPaginationBar) searchPaginationBar.style.display = 'none';
      return;
    }

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'search-result-card';
      const fileName = item.filename || item.fileName || '';
      const filePath = item.filePath || item.path || '';
      const ext = (item.extension || '').toLowerCase();
      const locationLabel = item.locationLabel || item.sourceLocation || 'Dokumen';
      const snippetHtml = item.highlightedHtml || item.snippetHtml || escapeHtml(item.snippet || '');

      let docIcon = '📄';
      if (ext === '.pdf') docIcon = '📕';
      else if (ext === '.docx') docIcon = '📘';
      else if (ext === '.xlsx') docIcon = '📊';

      card.innerHTML = `
        <div class="search-result-header">
          <div class="search-result-title-group">
            <span style="font-size: 1.2rem;">${docIcon}</span>
            <span class="search-result-filename">${escapeHtml(fileName)}</span>
            <span class="badge-tag">${escapeHtml(ext.toUpperCase())}</span>
          </div>
          <div class="search-location-badge">
            📍 ${escapeHtml(locationLabel)}
          </div>
        </div>
        <div class="search-result-snippet">
          "${snippetHtml}"
        </div>
        <div class="search-result-footer" style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
          <span class="search-result-path" title="${escapeHtml(filePath)}">
            ${escapeHtml(filePath)}
          </span>
          <div class="search-result-actions">
            <button type="button" class="btn btn-secondary btn-sm btn-open-file" title="Buka berkas di aplikasi default">
              📂 Buka Berkas
            </button>
            <button type="button" class="btn btn-secondary btn-sm btn-open-folder" title="Tampilkan lokasi berkas di explorer">
              📍 Buka Folder
            </button>
          </div>
        </div>
      `;

      card.querySelector('.btn-open-file').addEventListener('click', () => {
        openLocalPath(filePath, false);
      });

      card.querySelector('.btn-open-folder').addEventListener('click', () => {
        openLocalPath(filePath, true);
      });

      searchResultsList.appendChild(card);
    });

    // Pagination
    if (searchPaginationBar) {
      if (data.totalPages > 1) {
        searchPaginationBar.style.display = 'flex';
        if (paginationInfo) paginationInfo.textContent = `Halaman ${data.page} dari ${data.totalPages}`;
        if (prevPageBtn) prevPageBtn.disabled = data.page <= 1;
        if (nextPageBtn) nextPageBtn.disabled = data.page >= data.totalPages;
      } else {
        searchPaginationBar.style.display = 'none';
      }
    }
  }

  function renderSearchEmptyPrompt() {
    if (searchSummaryText) {
      searchSummaryText.innerHTML = 'Ketik kata kunci pada search bar untuk mencari kutipan teks dalam dokumen.';
    }
    if (searchResultsList) {
      searchResultsList.innerHTML = `
        <div class="search-empty-state">
          <div class="empty-icon">📁</div>
          <h4 style="margin-bottom: 0.5rem; color: var(--text-main);">Pencarian Teks Dokumen Lokal</h4>
          <p style="color: var(--text-muted); font-size: 0.88rem;">
            Mendukung pencarian pada berkas <strong>.md, .pdf, .docx, .xlsx</strong>.<br>
            Gunakan <strong>Mode A (Frasa Tepat)</strong> untuk menemukan kalimat verbatim, atau <strong>Mode B (Semua Kata)</strong> untuk menemukan kata-kata tanpa harus berurutan dalam satu kalimat.
          </p>
        </div>
      `;
    }
    if (searchPaginationBar) searchPaginationBar.style.display = 'none';
  }

  async function openLocalPath(filePath, folderOnly = false) {
    if (!filePath) return;
    if (!isServerAvailable) {
      alert('Server lokal tidak aktif untuk membuka berkas.');
      return;
    }
    try {
      const res = await fetch(apiUrl('/api/open-file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, folderOnly })
      });
      const result = await res.json();
      if (result.ok) {
        alertToast(folderOnly ? 'Membuka folder...' : 'Membuka berkas...');
      } else {
        alert(`Gagal membuka berkas: ${result.error || 'Terjadi kesalahan'}`);
      }
    } catch (err) {
      alert('Gagal membuka berkas: ' + err.message);
    }
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
    } else if (currentTab === 'documents') {
      filtered = filtered.filter(c => Array.isArray(c.attachments) && c.attachments.length > 0);
      cardsSectionTitle.textContent = '📁 Dokumen Terlampir';
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

    // Document Attachments & Smart Snippet Preview
    const attachmentsBox = createAttachmentsBox(card);

    // Checklist
    const checklistBox = createChecklistBox(card);

    // Footer (Reminder & Date)
    const footerEl = createCardFooter(card);

    // Assemble Card
    cardEl.appendChild(headerEl);
    if (card.tags && card.tags.length > 0) cardEl.appendChild(tagsEl);
    if (card.content) cardEl.appendChild(contentEl);
    if (attachmentsBox) cardEl.appendChild(attachmentsBox);
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

  function createAttachmentsBox(card) {
    if (!Array.isArray(card.attachments) || card.attachments.length === 0) {
      return null;
    }

    const box = document.createElement('div');
    box.className = 'card-attachments';

    card.attachments.forEach(att => {
      const meta = docEngine.getFileMeta(att.name);
      const snippetData = docEngine.getSnippet(att.textCorpus, searchQuery, 3);

      const docCard = document.createElement('div');
      docCard.className = 'doc-item-card';

      const header = document.createElement('div');
      header.className = 'doc-item-header';

      const titleGroup = document.createElement('div');
      titleGroup.className = 'doc-item-title-group';
      titleGroup.innerHTML = `
        <span class="doc-type-badge doc-type-${meta.type || meta.label.toLowerCase()}">${meta.icon} ${meta.label}</span>
        <span class="doc-item-filename" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
        <span class="doc-item-meta">${docEngine.formatSize(att.size)}${att.countInfo ? ' • ' + escapeHtml(att.countInfo) : ''}</span>
      `;

      const actions = document.createElement('div');
      actions.className = 'doc-item-actions';

      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'btn-doc-action';
      viewBtn.innerHTML = '👁️ Baca Teks';
      viewBtn.title = 'Buka & Baca teks dokumen lengkap';
      viewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDocViewerModal(att);
      });

      const dlBtn = document.createElement('button');
      dlBtn.type = 'button';
      dlBtn.className = 'btn-doc-action';
      dlBtn.innerHTML = '⬇️ Unduh';
      dlBtn.title = 'Unduh dokumen asli';
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadAttachment(att);
      });

      actions.appendChild(viewBtn);
      actions.appendChild(dlBtn);
      header.appendChild(titleGroup);
      header.appendChild(actions);
      docCard.appendChild(header);

      // Snippet preview (1-4 sentences)
      if (att.textCorpus) {
        const snippetBox = document.createElement('div');
        snippetBox.className = `doc-snippet-box ${snippetData.hasMatch ? 'has-match' : ''}`;
        const highlightedHtml = docEngine.renderHighlightedSnippet(snippetData.snippet, searchQuery);
        const prefix = snippetData.hasMatch
          ? '🔍 <strong>Ditemukan dalam dokumen:</strong> '
          : '💬 <strong>Cuplikan isi:</strong> ';
        snippetBox.innerHTML = prefix + highlightedHtml;
        docCard.appendChild(snippetBox);
      }

      box.appendChild(docCard);
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
    if (countDocuments) countDocuments.textContent = cards.filter(c => Array.isArray(c.attachments) && c.attachments.length > 0).length;
    countReminders.textContent = cards.filter(c => c.reminder && c.reminder.datetime).length;
    countChecklist.textContent = cards.filter(c => Array.isArray(c.checklist) && c.checklist.length > 0).length;
  }

  // --- CARD MODAL / FORM ---
  function updateCardTypeView(type) {
    const formContentGroup = document.getElementById('formContentGroup');
    const metadataCollapsible = document.getElementById('metadataCollapsible');
    const checklistCollapsible = document.getElementById('checklistCollapsible');
    const attachmentsCollapsible = document.getElementById('attachmentsCollapsible');
    const reminderCollapsible = document.getElementById('reminderCollapsible');

    const setVisibility = (el, show, autoExpand = false) => {
      if (!el) return;
      el.style.display = show ? 'block' : 'none';
      if (show && autoExpand && el.classList.contains('form-group-collapsible')) {
        el.classList.remove('collapsed');
      }
    };

    switch (type) {
      case 'note':
        setVisibility(formContentGroup, true);
        setVisibility(metadataCollapsible, false);
        setVisibility(checklistCollapsible, false);
        setVisibility(attachmentsCollapsible, false);
        setVisibility(reminderCollapsible, false);
        break;

      case 'link':
        setVisibility(formContentGroup, true);
        setVisibility(metadataCollapsible, true, true);
        setVisibility(checklistCollapsible, false);
        setVisibility(attachmentsCollapsible, false);
        setVisibility(reminderCollapsible, false);
        break;

      case 'document':
        setVisibility(formContentGroup, true);
        setVisibility(metadataCollapsible, false);
        setVisibility(checklistCollapsible, false);
        setVisibility(attachmentsCollapsible, true, true);
        setVisibility(reminderCollapsible, false);
        break;

      case 'checklist':
        setVisibility(formContentGroup, false);
        setVisibility(metadataCollapsible, false);
        setVisibility(checklistCollapsible, true, true);
        setVisibility(attachmentsCollapsible, false);
        setVisibility(reminderCollapsible, false);
        break;

      case 'reminder':
        setVisibility(formContentGroup, true);
        setVisibility(metadataCollapsible, false);
        setVisibility(checklistCollapsible, false);
        setVisibility(attachmentsCollapsible, false);
        setVisibility(reminderCollapsible, true, true);
        break;

      case 'all':
      default:
        setVisibility(formContentGroup, true);
        setVisibility(metadataCollapsible, true);
        setVisibility(checklistCollapsible, true);
        setVisibility(attachmentsCollapsible, true);
        setVisibility(reminderCollapsible, true);
        break;
    }
  }

  function openCardModal(card = null) {
    cardForm.reset();
    editingChecklist = [];
    editingAttachments = [];
    selectedColor = '#6366f1';

    let initialType = 'note';

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

      if (Array.isArray(card.attachments)) {
        editingAttachments = JSON.parse(JSON.stringify(card.attachments));
      }

      if (card.reminder) {
        reminderDateTime.value = card.reminder.datetime ? card.reminder.datetime.slice(0, 16) : '';
        reminderRepeat.value = card.reminder.repeat || 'none';
      }

      // Automatically detect initial type for existing card
      const hasDocs = editingAttachments.length > 0;
      const hasChecklist = editingChecklist.length > 0;
      const hasReminder = !!(card.reminder && card.reminder.datetime);
      const hasMeta = card.metadata && Object.values(card.metadata).some(Boolean);

      const featuresCount = [hasDocs, hasChecklist, hasReminder, hasMeta].filter(Boolean).length;
      if (featuresCount > 1) {
        initialType = 'all';
      } else if (hasDocs) {
        initialType = 'document';
      } else if (hasReminder) {
        initialType = 'reminder';
      } else if (hasChecklist) {
        initialType = 'checklist';
      } else if (hasMeta) {
        initialType = 'link';
      } else {
        initialType = 'note';
      }
    } else {
      cardModalTitle.textContent = 'Buat Catatan Baru';
      editCardId.value = '';
      initialType = 'note';
    }

    if (cardTypeSelect) {
      cardTypeSelect.value = initialType;
    }
    updateCardTypeView(initialType);

    renderChecklistEditor();
    renderAttachmentsEditor();
    cardModal.style.display = 'flex';
    const modalBody = cardModal.querySelector('.modal-body');
    if (modalBody) modalBody.scrollTop = 0;
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
      attachments: editingAttachments,
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

  // --- DOCUMENT ATTACHMENTS & VAULT LOGIC ---
  function renderAttachmentsEditor() {
    if (!attachmentsEditorList) return;
    attachmentsEditorList.innerHTML = '';
    if (attachmentsCountPreview) {
      attachmentsCountPreview.textContent = editingAttachments.length;
    }

    if (editingAttachments.length === 0) {
      return;
    }

    editingAttachments.forEach((att, index) => {
      const meta = docEngine.getFileMeta(att.name);
      const row = document.createElement('div');
      row.className = 'attachment-editor-item';
      row.innerHTML = `
        <div class="attachment-editor-left">
          <span class="doc-type-badge doc-type-${meta.type || meta.label.toLowerCase()}">${meta.icon} ${meta.label}</span>
          <span class="attachment-editor-filename" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
          <span class="attachment-editor-info">(${docEngine.formatSize(att.size)}${att.countInfo ? ' • ' + escapeHtml(att.countInfo) : ''}${att.wordCount ? ' • ' + att.wordCount.toLocaleString() + ' kata' : ''})</span>
        </div>
        <button type="button" class="btn-remove-attachment" data-index="${index}" title="Hapus lampiran">✕</button>
      `;

      row.querySelector('.btn-remove-attachment').addEventListener('click', () => {
        editingAttachments.splice(index, 1);
        renderAttachmentsEditor();
      });

      attachmentsEditorList.appendChild(row);
    });
  }

  async function handleDocumentFileInputChange(e) {
    if (e.target.files && e.target.files.length > 0) {
      await handleDocumentFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  }

  async function handleDocumentFiles(files) {
    if (!files || files.length === 0) return;

    if (attachmentExtractingIndicator) {
      attachmentExtractingIndicator.style.display = 'flex';
    }

    for (const file of files) {
      if (extractingStatusText) {
        extractingStatusText.textContent = `Mengekstrak isi ${file.name}...`;
      }
      try {
        const extracted = await docEngine.extractText(file);
        const base64Data = await docEngine.readFileAsBase64(file);

        editingAttachments.push({
          id: 'doc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          name: file.name,
          size: file.size,
          type: docEngine.getFileType(file.name),
          countInfo: extracted.countInfo,
          textCorpus: extracted.textCorpus,
          charCount: extracted.charCount,
          wordCount: extracted.wordCount,
          data: base64Data
        });
      } catch (err) {
        console.error('Gagal mengekstrak berkas:', file.name, err);
        alertToast(`Gagal mengekstrak: ${file.name}`);
      }
    }

    if (attachmentExtractingIndicator) {
      attachmentExtractingIndicator.style.display = 'none';
    }
    renderAttachmentsEditor();
  }

  function openDocViewerModal(att) {
    if (!docViewerModal) return;
    activeViewerDoc = att;
    const meta = docEngine.getFileMeta(att.name);

    if (docViewerTitle) docViewerTitle.textContent = att.name;
    if (docViewerIcon) docViewerIcon.textContent = meta.icon;

    const sizeStr = docEngine.formatSize(att.size);
    const wordStr = att.wordCount ? `${att.wordCount.toLocaleString()} Kata` : '';
    const charStr = att.charCount ? `${att.charCount.toLocaleString()} Karakter` : '';
    const infoParts = [meta.label, sizeStr, att.countInfo, wordStr, charStr].filter(Boolean);
    if (docViewerMeta) docViewerMeta.textContent = infoParts.join(' • ');

    if (docViewerContent) {
      docViewerContent.textContent = att.textCorpus || 'Isi dokumen kosong atau tidak terdeteksi teks.';
    }
    docViewerModal.style.display = 'flex';
  }

  function copyActiveViewerDocText() {
    if (!activeViewerDoc || !activeViewerDoc.textCorpus) return;
    navigator.clipboard.writeText(activeViewerDoc.textCorpus).then(() => {
      alertToast('Isi dokumen berhasil disalin ke clipboard!');
    }).catch(() => {
      alertToast('Gagal menyalin ke clipboard.');
    });
  }

  function downloadActiveViewerDocFile() {
    if (!activeViewerDoc) return;
    downloadAttachment(activeViewerDoc);
  }

  function downloadAttachment(att) {
    if (!att || !att.data) {
      alertToast('Data file tidak tersedia untuk diunduh.');
      return;
    }

    const link = document.createElement('a');
    link.href = att.data;
    link.download = att.name || 'dokumen';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
