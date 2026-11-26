/**
 * WeKeepIt - Main Application Controller
 */

(function () {
  'use strict';

  // State
  let cards = [];
  let currentTab = 'all'; // 'all', 'pinned', 'reminders', 'checklist'
  let currentDensity = 'normal'; // 'normal', 'compact', 'free'
  // Free Canvas Mode State & Card Positions (Posisi bebas & acak)
  let cardPositions = {};
  try {
    const savedPos = localStorage.getItem('wekeepit_canvas_positions');
    if (savedPos) cardPositions = JSON.parse(savedPos);
  } catch (e) { cardPositions = {}; }

  function saveCardPositions() {
    localStorage.setItem('wekeepit_canvas_positions', JSON.stringify(cardPositions));
  }

  let highestZIndex = 20;

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

  // --- FILE EXPLORER STATE (Detail, Tree, Card) ---
  let explorerViewMode = 'detail'; // 'detail', 'tree', 'card'
  let explorerSearchQuery = '';
  let explorerSortKey = 'name'; // 'name', 'type', 'size', 'chunks'
  let explorerSortAsc = true;
  let explorerCurrentPath = '';

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
  const tidyUpBtn = document.getElementById('tidyUpBtn');
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

  // Kanban DOM Elements & Schema
  const tabDomainKanban = document.getElementById('tabDomainKanban');
  const kanbanView = document.getElementById('kanbanView');
  const kanbanBoardContainer = document.getElementById('kanbanBoardContainer');
  const countKanbanFlow = document.getElementById('countKanbanFlow');
  const kanbanTotalBadge = document.getElementById('kanbanTotalBadge');
  const newKanbanTaskBtn = document.getElementById('newKanbanTaskBtn');
  const emptyKanbanActionBtn = document.getElementById('emptyKanbanActionBtn');
  const kanbanEmptyState = document.getElementById('kanbanEmptyState');
  const targetBoardNoticeBtn = document.getElementById('targetBoardNoticeBtn');
  const targetBoardKanbanBtn = document.getElementById('targetBoardKanbanBtn');
  const formStatusRow = document.getElementById('formStatusRow');
  const formStatus = document.getElementById('formStatus');
  const formPriority = document.getElementById('formPriority');

  const PRIORITY_LEVELS = {
    urgent: { id: 'urgent', key: 'Urgent', label: '🔥 Urgent (P0)', shortLabel: '🔥 Urgent', color: '#ef4444' },
    high: { id: 'high', key: 'High', label: '⚡ High (P1)', shortLabel: '⚡ High', color: '#f97316' },
    medium: { id: 'medium', key: 'Medium', label: '📌 Medium (P2)', shortLabel: '📌 Medium', color: '#f59e0b' },
    low: { id: 'low', key: 'Low', label: '☕ Low (P3)', shortLabel: '☕ Low', color: '#94a3b8' }
  };

  function getCardPriority(card) {
    if (!card) return null;
    const raw = card.priority || (card.metadata && (card.metadata.priority || card.metadata.prioritas));
    if (!raw) return null;
    const str = String(raw).trim().toLowerCase();
    if (/urgent|critical|kritis|p0/i.test(str)) return PRIORITY_LEVELS.urgent;
    if (/high|tinggi|p1/i.test(str)) return PRIORITY_LEVELS.high;
    if (/medium|sedang|p2/i.test(str)) return PRIORITY_LEVELS.medium;
    if (/low|rendah|p3/i.test(str)) return PRIORITY_LEVELS.low;
    return null;
  }

  // Workflow Sub-Views State & Elements (Kanban / Timeline / Calendar / Table)
  let currentWorkflowView = 'kanban'; // 'kanban', 'timeline', 'calendar', 'table'
  let timelineWindowStart = new Date();
  timelineWindowStart.setDate(timelineWindowStart.getDate() - 3);
  let calendarCurrentDate = new Date();
  let tableSortKey = 'title';
  let tableSortDirection = 'asc';
  let tableFilterText = '';

  const workflowViewToggle = document.getElementById('workflowViewToggle');
  const kanbanSectionWrap = document.getElementById('kanbanSectionWrap');
  const timelineSectionWrap = document.getElementById('timelineSectionWrap');
  const calendarSectionWrap = document.getElementById('calendarSectionWrap');
  const tableSectionWrap = document.getElementById('tableSectionWrap');
  const tableTotalCount = document.getElementById('tableTotalCount');
  const tableQuickFilter = document.getElementById('tableQuickFilter');
  const flowTableBody = document.getElementById('flowTableBody');
  const timelineGanttWrapper = document.getElementById('timelineGanttWrapper');
  const timelineRangeLabel = document.getElementById('timelineRangeLabel');
  const timelinePrevBtn = document.getElementById('timelinePrevBtn');
  const timelineTodayBtn = document.getElementById('timelineTodayBtn');
  const timelineNextBtn = document.getElementById('timelineNextBtn');
  const calendarGridContainer = document.getElementById('calendarGridContainer');
  const calendarMonthLabel = document.getElementById('calendarMonthLabel');
  const calendarPrevMonthBtn = document.getElementById('calendarPrevMonthBtn');
  const calendarTodayBtn = document.getElementById('calendarTodayBtn');
  const calendarNextMonthBtn = document.getElementById('calendarNextMonthBtn');
  const formDateRangeRow = document.getElementById('formDateRangeRow');
  const formStartDate = document.getElementById('formStartDate');
  const formDueDate = document.getElementById('formDueDate');

  const KANBAN_COLUMNS = [
    { id: 'backlog', label: 'Backlog', icon: '📥', color: '#64748b' },
    { id: 'todo', label: 'To Do', icon: '📋', color: '#f59e0b' },
    { id: 'in_progress', label: 'In Progress', icon: '⚡', color: '#3b82f6' },
    { id: 'review', label: 'Review', icon: '🔍', color: '#8b5cf6' },
    { id: 'done', label: 'Selesai', icon: '✅', color: '#10b981' }
  ];

  function isKanbanTask(card) {
    return Boolean(card && card.status && ['backlog', 'todo', 'in_progress', 'review', 'done'].includes(card.status));
  }

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

  // Archive & Trash Bin Modal DOM Elements (Soft Delete)
  const archiveModal = document.getElementById('archiveModal');
  const archiveModalBtn = document.getElementById('archiveModalBtn');
  const closeArchiveModal = document.getElementById('closeArchiveModal');
  const closeArchiveModalBtn = document.getElementById('closeArchiveModalBtn');
  const archiveCountBadge = document.getElementById('archiveCountBadge');
  const archiveTotalBadge = document.getElementById('archiveTotalBadge');
  const archiveListContainer = document.getElementById('archiveListContainer');
  const emptyArchiveBtn = document.getElementById('emptyArchiveBtn');
  const schemaFieldsList = document.getElementById('schemaFieldsList');
  const dataModal = document.getElementById('dataModal');
  const reminderToast = document.getElementById('reminderToast');

  // --- MODAL OVERLAY HELPERS ---
  function showModalOverlay(modalEl) {
    if (!modalEl) return;
    modalEl.style.display = 'flex';
    modalEl.scrollTop = 0;
    const mb = modalEl.querySelector('.modal-body');
    if (mb) mb.scrollTop = 0;
    document.body.classList.add('modal-open');
  }

  function hideModalOverlay(modalEl) {
    if (!modalEl) return;
    modalEl.style.display = 'none';
    const anyOpen = document.querySelector('.modal-overlay[style*="display: flex"]');
    if (!anyOpen) {
      document.body.classList.remove('modal-open');
    }
  }

  function triggerStaticModal(modalEl) {
    if (!modalEl) return;
    const dialog = modalEl.querySelector('.modal-dialog');
    if (!dialog) return;
    dialog.classList.remove('modal-dialog-static-nudge');
    void dialog.offsetWidth;
    dialog.classList.add('modal-dialog-static-nudge');
  }

  // Form State
  let editingChecklist = [];
  let editingAttachments = [];
  let selectedColor = '#6366f1';

  // --- SERVER & API HELPERS ---
  const API_BASE = (window.location.protocol.startsWith('http') && window.location.hostname !== 'wekeepit.local')
    ? window.location.origin
    : 'http://127.0.0.1:4321';

  function apiUrl(endpoint) {
    return API_BASE + endpoint;
  }

  // --- DYNAMIC METADATA LABELS HELPER ---
  function updateMetadataLabels() {
    const schema = metaEngine.getSchema();
    const fields = schema && Array.isArray(schema.fields) ? schema.fields : [];
    const fieldNames = fields.map(f => f.label || f.key).filter(Boolean);
    const suffix = fieldNames.length > 0 ? ` (${fieldNames.slice(0, 3).join(', ')}${fieldNames.length > 3 ? '...' : ''})` : '';

    const collapsibleTitle = document.querySelector('#toggleMetadataFields span');
    if (collapsibleTitle) {
      collapsibleTitle.textContent = `🔗 Metadata Kustom${suffix}`;
    }

    const linkOption = document.querySelector('#cardTypeSelect option[value="link"]');
    if (linkOption) {
      linkOption.textContent = `🔗 Metadata & Akses${suffix}`;
    }
  }

  // --- AUTHENTICATION & RBAC STATE (V2.4.0) ---
  let currentUser = null;
  let authEnabled = false;

  async function checkAuthStatus() {
    try {
      const res = await fetch(apiUrl('/api/auth/me'), { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        authEnabled = Boolean(data.authEnabled);
        if (authEnabled) {
          if (data.authenticated && data.user) {
            currentUser = data.user;
            applyUserSession(currentUser, true);
            hideAuthModal();
            return true;
          } else {
            currentUser = null;
            applyUserSession(null, false);
            showAuthModal();
            return false;
          }
        } else {
          // Desktop mode: zero-friction
          currentUser = data.user || { role: 'admin', username: 'local-owner', displayName: 'Pemilik Lokal' };
          applyUserSession(currentUser, false);
          hideAuthModal();
          return true;
        }
      }
    } catch (e) {
      console.warn('Auth check error (offline fallback):', e);
    }
    return true;
  }

  function applyUserSession(user, showPill = true) {
    const pill = document.getElementById('authUserPill');
    const roleBadge = document.getElementById('authUserRoleBadge');
    const nameEl = document.getElementById('authUserName');
    const banner = document.getElementById('viewerBanner');

    document.body.classList.remove('role-admin', 'role-editor', 'role-viewer');

    if (!user) {
      if (pill) pill.style.display = 'none';
      if (banner) banner.style.display = 'none';
      return;
    }

    const role = (user.role || 'viewer').toLowerCase();
    document.body.classList.add(`role-${role}`);

    if (pill) {
      if (showPill && authEnabled) {
        pill.style.display = 'inline-flex';
        if (roleBadge) {
          roleBadge.textContent = role === 'admin' ? 'Admin' : (role === 'editor' ? 'Editor' : 'Viewer');
          roleBadge.className = `auth-role-badge role-${role}`;
        }
        if (nameEl) {
          nameEl.textContent = user.displayName || user.username || 'Pengguna';
        }
      } else {
        pill.style.display = 'none';
      }
    }

    if (banner) {
      banner.style.display = (authEnabled && role === 'viewer') ? 'flex' : 'none';
    }
  }

  function showAuthModal() {
    const modal = document.getElementById('authLoginModal');
    if (modal) {
      modal.style.display = 'flex';
      const userInput = document.getElementById('loginUsername');
      if (userInput) setTimeout(() => userInput.focus(), 100);
    }
  }

  function hideAuthModal() {
    const modal = document.getElementById('authLoginModal');
    if (modal) {
      modal.style.display = 'none';
    }
    const alertBox = document.getElementById('authLoginAlert');
    if (alertBox) {
      alertBox.style.display = 'none';
      alertBox.textContent = '';
    }
  }

  async function handleLogin(e) {
    if (e) e.preventDefault();
    const userInput = document.getElementById('loginUsername');
    const passInput = document.getElementById('loginPassword');
    const alertBox = document.getElementById('authLoginAlert');
    const submitBtn = document.getElementById('btnLoginSubmit');

    const username = (userInput ? userInput.value : '').trim();
    const password = passInput ? passInput.value : '';

    if (!username || !password) {
      if (alertBox) {
        alertBox.textContent = 'Harap masukkan username dan password.';
        alertBox.style.display = 'block';
      }
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Memverifikasi...';
    }

    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        currentUser = data.user;
        applyUserSession(currentUser, true);
        hideAuthModal();
        if (passInput) passInput.value = '';
        await loadCards();
        renderAll();
      } else {
        if (alertBox) {
          alertBox.textContent = data.error || 'Username atau password salah.';
          alertBox.style.display = 'block';
        }
      }
    } catch (err) {
      if (alertBox) {
        alertBox.textContent = 'Gagal terhubung ke server autentikasi: ' + err.message;
        alertBox.style.display = 'block';
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Masuk Sekarang ➔</span>';
      }
    }
  }

  async function handleLogout() {
    if (!confirm('Apakah Anda yakin ingin keluar dari akun ini?')) return;
    try {
      await fetch(apiUrl('/api/auth/logout'), { method: 'POST' });
    } catch {}
    currentUser = null;
    applyUserSession(null, false);
    showAuthModal();
  }

  // --- INITIALIZATION ---
  async function init() {
    setupNativeBridge();
    setupEventListeners();
    await checkAuthStatus();
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
        const res = await fetch(apiUrl('/api/cards'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cards)
        });
        if (res.status === 401 && authEnabled) {
          showAuthModal();
        } else if (res.status === 403) {
          alert('Aksi ditolak: Peran akun Anda (Viewer) tidak memiliki izin mengubah data kartu.');
        }
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
          updateMetadataLabels();
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
    // Auth login & logout
    const loginForm = document.getElementById('authLoginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', handleLogin);
    }
    const logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', handleLogout);
    }

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


    // File Explorer View Mode Buttons
    document.querySelectorAll('.explorer-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.explorer-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        explorerViewMode = btn.getAttribute('data-mode');
        switchExplorerView(explorerViewMode);
      });
    });

    // File Explorer Search Filter
    const explorerSearchInput = document.getElementById('explorerSearchInput');
    const explorerClearSearchBtn = document.getElementById('explorerClearSearchBtn');
    if (explorerSearchInput) {
      explorerSearchInput.addEventListener('input', (e) => {
        explorerSearchQuery = e.target.value.trim().toLowerCase();
        if (explorerClearSearchBtn) {
          explorerClearSearchBtn.style.display = explorerSearchQuery ? 'block' : 'none';
        }
        renderFileExplorer();
      });
    }

    if (explorerClearSearchBtn) {
      explorerClearSearchBtn.addEventListener('click', () => {
        if (explorerSearchInput) explorerSearchInput.value = '';
        explorerSearchQuery = '';
        explorerClearSearchBtn.style.display = 'none';
        renderFileExplorer();
      });
    }

    // Table Header Sorting
    document.querySelectorAll('.indexed-files-table th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort');
        if (explorerSortKey === key) {
          explorerSortAsc = !explorerSortAsc;
        } else {
          explorerSortKey = key;
          explorerSortAsc = true;
        }
        renderFileExplorer();
      });
    });

    // Density & Free Canvas Toggle
    document.querySelectorAll('.density-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.density-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentDensity = btn.getAttribute('data-density');

        if (currentDensity === 'free') {
          cardsGrid.classList.remove('compact');
          pinnedGrid.classList.remove('compact');
          cardsGrid.classList.add('free-canvas');
          pinnedGrid.classList.add('free-canvas');
          if (tidyUpBtn) tidyUpBtn.style.display = 'inline-flex';
        } else if (currentDensity === 'compact') {
          cardsGrid.classList.remove('free-canvas');
          pinnedGrid.classList.remove('free-canvas');
          cardsGrid.classList.add('compact');
          pinnedGrid.classList.add('compact');
          if (tidyUpBtn) tidyUpBtn.style.display = 'none';
        } else {
          cardsGrid.classList.remove('free-canvas', 'compact');
          pinnedGrid.classList.remove('free-canvas', 'compact');
          if (tidyUpBtn) tidyUpBtn.style.display = 'none';
        }

        renderAll();
      });
    });

    if (targetBoardNoticeBtn) {
      targetBoardNoticeBtn.addEventListener('click', () => {
        targetBoardNoticeBtn.classList.add('active');
        if (targetBoardKanbanBtn) targetBoardKanbanBtn.classList.remove('active');
        if (formStatusRow) formStatusRow.style.display = 'none';
        if (formDateRangeRow) formDateRangeRow.style.display = 'none';
      });
    }

    if (targetBoardKanbanBtn) {
      targetBoardKanbanBtn.addEventListener('click', () => {
        targetBoardKanbanBtn.classList.add('active');
        if (targetBoardNoticeBtn) targetBoardNoticeBtn.classList.remove('active');
        if (formStatusRow) formStatusRow.style.display = 'flex';
        if (formDateRangeRow) formDateRangeRow.style.display = 'flex';
        if (formStatus && !formStatus.value) formStatus.value = 'todo';
      });
    }

    // Workflow View Switcher (Kanban vs Timeline vs Calendar vs Table)
    document.querySelectorAll('.workflow-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.workflow-view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentWorkflowView = btn.getAttribute('data-flow-view') || 'kanban';

        if (kanbanSectionWrap) kanbanSectionWrap.style.display = (currentWorkflowView === 'kanban') ? 'block' : 'none';
        if (timelineSectionWrap) timelineSectionWrap.style.display = (currentWorkflowView === 'timeline') ? 'block' : 'none';
        if (calendarSectionWrap) calendarSectionWrap.style.display = (currentWorkflowView === 'calendar') ? 'block' : 'none';
        if (tableSectionWrap) tableSectionWrap.style.display = (currentWorkflowView === 'table') ? 'block' : 'none';

        renderWorkflowActiveView();
      });
    });

    // Table Column Sorting Listeners
    document.querySelectorAll('.flow-database-table th.sortable-th').forEach(th => {
      th.addEventListener('click', () => {
        const sortKey = th.getAttribute('data-sort-key');
        if (tableSortKey === sortKey) {
          tableSortDirection = (tableSortDirection === 'asc') ? 'desc' : 'asc';
        } else {
          tableSortKey = sortKey;
          tableSortDirection = 'asc';
        }
        renderTableView();
      });
    });

    if (tableQuickFilter) {
      tableQuickFilter.addEventListener('input', (e) => {
        tableFilterText = e.target.value.trim().toLowerCase();
        renderTableView();
      });
    }

    if (timelinePrevBtn) {
      timelinePrevBtn.addEventListener('click', () => {
        timelineWindowStart.setDate(timelineWindowStart.getDate() - 7);
        renderTimelineView();
      });
    }
    if (timelineTodayBtn) {
      timelineTodayBtn.addEventListener('click', () => {
        timelineWindowStart = new Date();
        timelineWindowStart.setDate(timelineWindowStart.getDate() - 3);
        renderTimelineView();
      });
    }
    if (timelineNextBtn) {
      timelineNextBtn.addEventListener('click', () => {
        timelineWindowStart.setDate(timelineWindowStart.getDate() + 7);
        renderTimelineView();
      });
    }

    if (calendarPrevMonthBtn) {
      calendarPrevMonthBtn.addEventListener('click', () => {
        calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() - 1);
        renderCalendarView();
      });
    }
    if (calendarTodayBtn) {
      calendarTodayBtn.addEventListener('click', () => {
        calendarCurrentDate = new Date();
        renderCalendarView();
      });
    }
    if (calendarNextMonthBtn) {
      calendarNextMonthBtn.addEventListener('click', () => {
        calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + 1);
        renderCalendarView();
      });
    }

    if (newKanbanTaskBtn) {
      newKanbanTaskBtn.addEventListener('click', () => openCardModal(null, 'kanban', 'todo'));
    }

    if (emptyKanbanActionBtn) {
      emptyKanbanActionBtn.addEventListener('click', () => openCardModal(null, 'kanban', 'todo'));
    }

    if (tidyUpBtn) {
      tidyUpBtn.addEventListener('click', tidyUpCanvasCards);
    }

    // Theme & Appearance Manager
    const THEMES = [
      { id: 'bulletin-board', name: 'Buletin', isLight: false, headerHex: '#442a17', dot: 'linear-gradient(135deg, #d8a46b 50%, #fef08a 50%)' },
      { id: 'light-snow', name: 'Daylight Snow', isLight: true, headerHex: '#ffffff', dot: 'linear-gradient(135deg, #f6f8fa 50%, #4f46e5 50%)' },
      { id: 'light-cream', name: 'Warm Cream', isLight: true, headerHex: '#f7f3e8', dot: 'linear-gradient(135deg, #fcf9f2 50%, #b45309 50%)' },
      { id: 'obsidian', name: 'Obsidian', isLight: false, headerHex: '#161b22', dot: 'linear-gradient(135deg, #0e1117 50%, #6366f1 50%)' },
      { id: 'ocean', name: 'Deep Ocean', isLight: false, headerHex: '#081a33', dot: 'linear-gradient(135deg, #071b35 50%, #0284c7 50%)' },
      { id: 'forest', name: 'Nord Forest', isLight: false, headerHex: '#0d2017', dot: 'linear-gradient(135deg, #07140e 50%, #059669 50%)' },
      { id: 'amethyst', name: 'Amethyst', isLight: false, headerHex: '#181128', dot: 'linear-gradient(135deg, #0f0a1a 50%, #9333ea 50%)' },
      { id: 'amber', name: 'Sunset Amber', isLight: false, headerHex: '#1c150e', dot: 'linear-gradient(135deg, #120d08 50%, #d97706 50%)' },
      { id: 'cyberpunk', name: 'Cyberpunk', isLight: false, headerHex: '#0c0d14', dot: 'linear-gradient(135deg, #050508 50%, #00f0ff 50%)' },
      { id: 'crimson', name: 'Crimson Rose', isLight: false, headerHex: '#1c0c10', dot: 'linear-gradient(135deg, #120709 50%, #e11d48 50%)' }
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
            headerColor: themeObj ? themeObj.headerHex : '#161b22',
            isLight: themeObj ? !!themeObj.isLight : false
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
      if (e.target === cardModal) triggerStaticModal(cardModal);
    });

    // Manage Schema modal
    document.getElementById('manageSchemaBtn').addEventListener('click', openSchemaModal);
    document.getElementById('closeSchemaModal').addEventListener('click', () => hideModalOverlay(schemaModal));
    document.getElementById('cancelSchemaModal').addEventListener('click', () => hideModalOverlay(schemaModal));
    schemaModal.addEventListener('click', (e) => {
      if (e.target === schemaModal) triggerStaticModal(schemaModal);
    });

    // Data Export / Import modal
    document.getElementById('exportImportBtn').addEventListener('click', () => showModalOverlay(dataModal));
    document.getElementById('closeDataModal').addEventListener('click', () => hideModalOverlay(dataModal));
    document.getElementById('closeDataModalBtn').addEventListener('click', () => hideModalOverlay(dataModal));
    dataModal.addEventListener('click', (e) => {
      if (e.target === dataModal) triggerStaticModal(dataModal);
    });

    // Archive / Soft Delete modal
    if (archiveModalBtn) {
      archiveModalBtn.addEventListener('click', openArchiveModal);
    }
    if (closeArchiveModal) {
      closeArchiveModal.addEventListener('click', () => hideModalOverlay(archiveModal));
    }
    if (closeArchiveModalBtn) {
      closeArchiveModalBtn.addEventListener('click', () => hideModalOverlay(archiveModal));
    }
    if (emptyArchiveBtn) {
      emptyArchiveBtn.addEventListener('click', emptyArchive);
    }
    if (archiveModal) {
      archiveModal.addEventListener('click', (e) => {
        if (e.target === archiveModal) triggerStaticModal(archiveModal);
      });
    }

    document.getElementById('downloadJsonBtn').addEventListener('click', exportDataJson);
    document.getElementById('triggerImportBtn').addEventListener('click', () => {
      document.getElementById('importFileInput').click();
    });
    document.getElementById('importFileInput').addEventListener('change', importDataJson);

    // GitHub Release Update Checker
    const checkUpdateBtn = document.getElementById('checkUpdateBtn');
    const updateCheckStatus = document.getElementById('updateCheckStatus');
    if (checkUpdateBtn && updateCheckStatus) {
      checkUpdateBtn.addEventListener('click', async () => {
        checkUpdateBtn.disabled = true;
        checkUpdateBtn.textContent = 'Memeriksa...';
        updateCheckStatus.style.display = 'block';
        updateCheckStatus.innerHTML = '<span style="color: var(--accent-color);">⏳ Menghubungi GitHub Releases...</span>';

        try {
          const res = await fetch('https://api.github.com/repos/rvmdn/wekeepit/releases/latest', {
            headers: { 'Accept': 'application/vnd.github.v3+json' }
          });
          if (!res.ok) {
            throw new Error(`Status ${res.status}`);
          }
          const data = await res.json();
          const latestTag = (data.tag_name || data.name || '').trim();
          const currentVersion = (document.getElementById('currentAppVersion')?.textContent.trim()) || 'v2.1.1';

          if (latestTag && latestTag !== currentVersion) {
            const installerAsset = data.assets?.find(a => typeof a.name === 'string' && a.name.endsWith('-Setup.exe'));
            const downloadUrl = installerAsset ? installerAsset.browser_download_url : data.html_url;

            updateCheckStatus.innerHTML = `
              <div style="margin-top: 6px; padding: 10px; border-radius: 6px; background: rgba(34, 197, 94, 0.12); border: 1px solid rgba(34, 197, 94, 0.35); color: #4ade80;">
                <div>🎉 <strong>Versi Baru Tersedia: ${latestTag}</strong></div>
                <div style="font-size: 11px; margin-top: 3px; color: var(--text-primary);">${data.name || ''}</div>
                <div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">
                  <a href="${downloadUrl}" target="_blank" class="btn btn-primary" style="font-size: 11px; padding: 4px 10px; text-decoration: none;">⬇️ Unduh Installer</a>
                  <a href="${data.html_url}" target="_blank" class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px; text-decoration: none;">Lihat Catatan Rilis</a>
                </div>
              </div>
            `;
          } else {
            updateCheckStatus.innerHTML = `
              <div style="margin-top: 6px; color: #4ade80;">
                ✅ Anda sudah menggunakan versi terbaru (v2.0.0).
              </div>
            `;
          }
        } catch (err) {
          updateCheckStatus.innerHTML = `
            <div style="margin-top: 6px; color: var(--text-muted);">
              ℹ️ Kunjungi <a href="https://github.com/rvmdn/wekeepit/releases" target="_blank" style="color: var(--accent-color); text-decoration: underline;">GitHub Releases</a> untuk mengunduh rilis installer terbaru.
            </div>
          `;
        } finally {
          checkUpdateBtn.disabled = false;
          checkUpdateBtn.textContent = 'Periksa Pembaruan';
        }
      });
    }

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
    if (closeDocViewerModal) closeDocViewerModal.addEventListener('click', () => { hideModalOverlay(docViewerModal); });
    if (closeDocViewerModalBtn) closeDocViewerModalBtn.addEventListener('click', () => { hideModalOverlay(docViewerModal); });
    if (docViewerModal) {
      docViewerModal.addEventListener('click', (e) => {
        if (e.target === docViewerModal) triggerStaticModal(docViewerModal);
      });
    }
    if (copyDocTextBtn) copyDocTextBtn.addEventListener('click', copyActiveViewerDocText);
    if (downloadDocFileBtn) downloadDocFileBtn.addEventListener('click', downloadActiveViewerDocFile);

    // Dynamic auto-grow for formContent editor
    if (formContent) {
      formContent.addEventListener('input', () => {
        formContent.style.height = 'auto';
        formContent.style.height = Math.max(68, Math.min(180, formContent.scrollHeight)) + 'px';
      });
    }

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
        if (e.target === folderModal) triggerStaticModal(folderModal);
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
    if (kanbanView) kanbanView.style.display = (domain === 'kanban') ? 'block' : 'none';
    if (documentsView) documentsView.style.display = (domain === 'documents') ? 'block' : 'none';
    if (searchResultsView) searchResultsView.style.display = (domain === 'search') ? 'block' : 'none';

    // Toggle Work Board header controls (only visible on Notice Board)
    if (boardFilterTabs) boardFilterTabs.style.display = (domain === 'board') ? 'flex' : 'none';
    if (viewDensityToggle) viewDensityToggle.style.display = (domain === 'board') ? 'flex' : 'none';
    if (tidyUpBtn && domain !== 'board') tidyUpBtn.style.display = 'none';

    const tagBarSection = document.getElementById('tagBarSection');
    if (tagBarSection) {
      if (domain === 'board' || domain === 'kanban') {
        renderTagChips();
      } else {
        tagBarSection.style.display = 'none';
      }
    }

    if (domain === 'board') {
      renderAll();
    } else if (domain === 'kanban') {
      renderWorkflowActiveView();
      updateTabCounts();
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
    if (folderModal) showModalOverlay(folderModal);
    if (folderPathInput) folderPathInput.focus({ preventScroll: true });
  }

  function closeFolderModalFn() {
    if (folderModal) hideModalOverlay(folderModal);
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
                renderFileExplorer();
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
    if (currentDomain === 'kanban') {
      renderWorkflowActiveView();
    } else {
      renderCards();
    }
    updateTabCounts();
  }

  function renderTagChips() {
    const activeCards = cards.filter(c => !c.archived);
    const allTags = metaEngine.extractAllTags(activeCards);
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

    // Filter matching cards: strictly Notice Board notes (non-kanban, non-archived)
    const noticeCards = cards.filter(c => !c.archived && !isKanbanTask(c));
    let filtered = noticeCards.filter(card => metaEngine.matches(card, parsedQuery));

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
    const isFree = currentDensity === 'free';
    
    if (isFree) {
      container.classList.add('free-canvas');
    } else {
      container.classList.remove('free-canvas');
    }

    cardItems.forEach((card, index) => {
      const cardEl = createCardElement(card);
      container.appendChild(cardEl);

      if (isFree) {
        setupFreeCardPosition(cardEl, card, index, container);
        attachCardDrag(cardEl, card, container);
      } else {
        cardEl.style.position = '';
        cardEl.style.left = '';
        cardEl.style.top = '';
        cardEl.style.zIndex = '';
        cardEl.style.transform = '';
      }
    });

    if (isFree) {
      adjustFreeContainerHeight(container);
    } else {
      container.style.minHeight = '';
    }
  }

  function renderKanbanView() {
    if (!kanbanBoardContainer) return;
    kanbanBoardContainer.innerHTML = '';

    const parsedQuery = metaEngine.parseQuery(searchQuery);
    const kanbanTasks = cards.filter(c => !c.archived && isKanbanTask(c));
    const filteredTasks = kanbanTasks.filter(c => metaEngine.matches(c, parsedQuery));

    if (kanbanTotalBadge) {
      kanbanTotalBadge.textContent = `${kanbanTasks.length} Tugas`;
    }

    const kanbanSectionWrap = kanbanView ? kanbanView.querySelector('.kanban-section') : null;

    if (kanbanTasks.length === 0) {
      if (kanbanEmptyState) kanbanEmptyState.style.display = 'flex';
      if (kanbanSectionWrap) kanbanSectionWrap.style.display = 'none';
      return;
    } else {
      if (kanbanEmptyState) kanbanEmptyState.style.display = 'none';
      if (kanbanSectionWrap) kanbanSectionWrap.style.display = 'block';
    }

    KANBAN_COLUMNS.forEach(col => {
      const colCards = filteredTasks.filter(c => c.status === col.id);

      const colEl = document.createElement('div');
      colEl.className = `kanban-column kanban-col-${col.id}`;
      colEl.setAttribute('data-status', col.id);

      // Column Header
      const headerEl = document.createElement('div');
      headerEl.className = 'kanban-column-header';
      headerEl.innerHTML = `
        <div class="kanban-col-title-group">
          <span class="kanban-col-icon">${col.icon}</span>
          <h3 class="kanban-col-title">${escapeHtml(col.label)}</h3>
          <span class="kanban-col-badge">${colCards.length}</span>
        </div>
        <button type="button" class="kanban-add-card-btn" title="Tambah kartu baru ke status ${escapeHtml(col.label)}" data-status="${col.id}">＋</button>
      `;

      headerEl.querySelector('.kanban-add-card-btn').addEventListener('click', () => {
        openCardModal(null, 'kanban', col.id);
      });

      // Column Body (Cards & Drop zone)
      const bodyEl = document.createElement('div');
      bodyEl.className = 'kanban-column-body';
      bodyEl.setAttribute('data-status', col.id);

      // Drag and drop listeners for column body
      bodyEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        bodyEl.classList.add('kanban-drop-target');
      });

      bodyEl.addEventListener('dragleave', (e) => {
        if (!bodyEl.contains(e.relatedTarget)) {
          bodyEl.classList.remove('kanban-drop-target');
        }
      });

      bodyEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        bodyEl.classList.remove('kanban-drop-target');
        const cardId = e.dataTransfer.getData('text/plain');
        if (!cardId) return;

        const targetCard = cards.find(c => String(c.id) === String(cardId));
        if (targetCard && targetCard.status !== col.id) {
          targetCard.status = col.id;
          targetCard.updatedAt = new Date().toISOString();
          await saveCards();
          renderKanbanView();
          updateTabCounts();
          alertToast(`Tugas "${targetCard.title || 'Tugas'}" dipindah ke ${col.label}`);
        }
      });

      if (colCards.length === 0) {
        const emptyDrop = document.createElement('div');
        emptyDrop.className = 'kanban-empty-drop-hint';
        emptyDrop.innerHTML = `<span>Tarik tugas ke sini</span>`;
        bodyEl.appendChild(emptyDrop);
      } else {
        colCards.forEach(card => {
          const cardEl = createCardElement(card);
          cardEl.classList.add('kanban-card');
          cardEl.setAttribute('draggable', 'true');

          cardEl.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', String(card.id));
            e.dataTransfer.effectAllowed = 'move';
            cardEl.classList.add('kanban-card-dragging');
          });

          cardEl.addEventListener('dragend', () => {
            cardEl.classList.remove('kanban-card-dragging');
            document.querySelectorAll('.kanban-column-body').forEach(b => b.classList.remove('kanban-drop-target'));
          });

          bodyEl.appendChild(cardEl);
        });
      }

      colEl.appendChild(headerEl);
      colEl.appendChild(bodyEl);
      kanbanBoardContainer.appendChild(colEl);
    });
  }

  function renderWorkflowActiveView() {
    if (currentWorkflowView === 'timeline') {
      renderTimelineView();
    } else if (currentWorkflowView === 'calendar') {
      renderCalendarView();
    } else if (currentWorkflowView === 'table') {
      renderTableView();
    } else {
      renderKanbanView();
    }
  }

  function renderTableView() {
    if (!flowTableBody) return;
    flowTableBody.innerHTML = '';

    const kanbanTasks = cards.filter(c => !c.archived && isKanbanTask(c));
    const parsedQuery = metaEngine.parseQuery(searchQuery);
    let filteredTasks = kanbanTasks.filter(c => metaEngine.matches(c, parsedQuery));

    // Secondary table quick filter
    if (tableFilterText) {
      filteredTasks = filteredTasks.filter(t => {
        const titleMatch = (t.title || '').toLowerCase().includes(tableFilterText);
        const statusMatch = (t.status || '').toLowerCase().includes(tableFilterText);
        const priorityMatch = ((t.priority || (t.metadata && t.metadata.priority)) || '').toLowerCase().includes(tableFilterText);
        const tagsMatch = Array.isArray(t.tags) && t.tags.some(tag => tag.toLowerCase().includes(tableFilterText));
        return titleMatch || statusMatch || priorityMatch || tagsMatch;
      });
    }

    if (tableTotalCount) {
      tableTotalCount.textContent = `${filteredTasks.length} Tugas Terdaftar`;
    }

    // Sort order mapping
    const STATUS_RANK = { backlog: 0, todo: 1, in_progress: 2, review: 3, done: 4 };
    const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };

    filteredTasks.sort((a, b) => {
      let valA, valB;
      if (tableSortKey === 'status') {
        valA = STATUS_RANK[a.status] !== undefined ? STATUS_RANK[a.status] : 99;
        valB = STATUS_RANK[b.status] !== undefined ? STATUS_RANK[b.status] : 99;
      } else if (tableSortKey === 'priority') {
        const pA = getCardPriority(a);
        const pB = getCardPriority(b);
        valA = pA ? PRIORITY_RANK[pA.id] : 99;
        valB = pB ? PRIORITY_RANK[pB.id] : 99;
      } else if (tableSortKey === 'dueDate') {
        valA = a.dueDate || (a.reminder && a.reminder.datetime ? a.reminder.datetime.slice(0, 10) : a.startDate) || '9999-99-99';
        valB = b.dueDate || (b.reminder && b.reminder.datetime ? b.reminder.datetime.slice(0, 10) : b.startDate) || '9999-99-99';
      } else if (tableSortKey === 'checklist') {
        const lenA = Array.isArray(a.checklist) ? a.checklist.length : 0;
        const compA = lenA ? a.checklist.filter(c => c.done).length : 0;
        const lenB = Array.isArray(b.checklist) ? b.checklist.length : 0;
        const compB = lenB ? b.checklist.filter(c => c.done).length : 0;
        valA = lenA ? (compA / lenA) : -1;
        valB = lenB ? (compB / lenB) : -1;
      } else {
        // default: title
        valA = (a.title || '').toLowerCase();
        valB = (b.title || '').toLowerCase();
      }

      let cmp = 0;
      if (typeof valA === 'string') {
        cmp = valA.localeCompare(valB);
      } else {
        cmp = valA > valB ? 1 : (valA < valB ? -1 : 0);
      }
      return tableSortDirection === 'asc' ? cmp : -cmp;
    });

    // Update Header Sort Icons
    document.querySelectorAll('.flow-database-table th.sortable-th').forEach(th => {
      const key = th.getAttribute('data-sort-key');
      const icon = th.querySelector('.sort-icon');
      if (key === tableSortKey) {
        th.classList.add('active-sort');
        if (icon) icon.textContent = tableSortDirection === 'asc' ? '▲' : '▼';
      } else {
        th.classList.remove('active-sort');
        if (icon) icon.textContent = '↕';
      }
    });

    if (filteredTasks.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.className = 'table-empty-row';
      emptyRow.innerHTML = `<td colspan="7">Tidak ada tugas alur kerja yang cocok dengan filter</td>`;
      flowTableBody.appendChild(emptyRow);
      return;
    }

    filteredTasks.forEach(task => {
      const row = document.createElement('tr');
      const colDef = KANBAN_COLUMNS.find(c => c.id === task.status) || KANBAN_COLUMNS[1];
      const pInfo = getCardPriority(task);

      // Date string
      let dateDisplay = '—';
      if (task.startDate && task.dueDate) {
        dateDisplay = `${task.startDate} s.d. ${task.dueDate}`;
      } else if (task.dueDate) {
        dateDisplay = `🎯 ${task.dueDate}`;
      } else if (task.startDate) {
        dateDisplay = `📅 ${task.startDate}`;
      } else if (task.reminder && task.reminder.datetime) {
        dateDisplay = `⏰ ${task.reminder.datetime.slice(0, 10)}`;
      }

      // Checklist progress
      let checklistDisplay = '—';
      if (Array.isArray(task.checklist) && task.checklist.length > 0) {
        const total = task.checklist.length;
        const completed = task.checklist.filter(c => c.done).length;
        const percentage = Math.round((completed / total) * 100);
        const isComplete = (completed === total);
        checklistDisplay = `
          <div style="display:flex; align-items:center; gap:6px;">
            <div class="checklist-progress-track" style="width: 50px; flex:none;">
              <div class="checklist-progress-fill ${isComplete ? 'is-complete' : ''}" style="width: ${percentage}%"></div>
            </div>
            <span class="checklist-progress-badge ${isComplete ? 'is-complete' : ''}" style="font-size:0.68rem; padding:1px 4px;">
              ${completed}/${total}
            </span>
          </div>
        `;
      }

      // Tags display
      let tagsDisplay = '';
      if (Array.isArray(task.tags) && task.tags.length > 0) {
        tagsDisplay = task.tags.slice(0, 3).map(t => `<span class="card-tag-pill" style="--tag-color:${metaEngine.getTagColor(t)}; font-size:0.65rem; padding:1px 5px; cursor:pointer;" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`).join(' ');
      } else {
        tagsDisplay = '<span style="color:var(--text-muted); font-size:0.75rem;">—</span>';
      }

      row.innerHTML = `
        <td>
          <div class="table-task-title-cell" title="Klik untuk edit tugas">
            <span style="color: ${task.color || 'var(--accent-primary)'}; font-size: 0.9rem;">●</span>
            <span>${escapeHtml(task.title || 'Tanpa Judul')}</span>
          </div>
        </td>
        <td>
          <span class="card-status-badge status-${task.status}">
            ${colDef.icon} ${colDef.label}
          </span>
        </td>
        <td>
          ${pInfo ? `<span class="card-priority-badge priority-${pInfo.id}">${pInfo.shortLabel}</span>` : '<span style="color:var(--text-muted); font-size:0.75rem;">—</span>'}
        </td>
        <td style="font-size: 0.78rem;">
          ${dateDisplay}
        </td>
        <td>
          ${checklistDisplay}
        </td>
        <td>
          ${tagsDisplay}
        </td>
        <td style="text-align: center;">
          <div style="display:inline-flex; gap:4px;">
            <button type="button" class="btn btn-icon-only" data-action="edit" title="Edit Tugas" style="width:26px; height:26px; font-size:0.75rem; padding:0;">✏️</button>
            <button type="button" class="btn btn-icon-only" data-action="delete" title="Pindahkan ke Arsip & Sampah" style="width:26px; height:26px; font-size:0.75rem; padding:0;">🗑️</button>
          </div>
        </td>
      `;

      // Title click opens modal
      row.querySelector('.table-task-title-cell').addEventListener('click', () => openCardModal(task));
      // Action buttons
      row.querySelector('[data-action="edit"]').addEventListener('click', () => openCardModal(task));
      row.querySelector('[data-action="delete"]').addEventListener('click', () => archiveCard(task.id));

      // Tag click filters
      row.querySelectorAll('[data-tag]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          handleTagChipClick(el.getAttribute('data-tag'));
        });
      });

      flowTableBody.appendChild(row);
    });
  }

  function renderTimelineView() {
    if (!timelineGanttWrapper) return;
    timelineGanttWrapper.innerHTML = '';

    const kanbanTasks = cards.filter(c => !c.archived && isKanbanTask(c));
    const parsedQuery = metaEngine.parseQuery(searchQuery);
    const filteredTasks = kanbanTasks.filter(c => metaEngine.matches(c, parsedQuery));

    // Timeline Window: 14 days
    const totalDays = 14;
    const days = [];
    const startDate = new Date(timelineWindowStart);
    startDate.setHours(0, 0, 0, 0);

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      days.push(d);
    }

    const endDate = days[days.length - 1];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

    if (timelineRangeLabel) {
      timelineRangeLabel.textContent = `${startDate.getDate()} ${monthNames[startDate.getMonth()]} - ${endDate.getDate()} ${monthNames[endDate.getMonth()]} ${endDate.getFullYear()}`;
    }

    const todayStr = new Date().toISOString().slice(0, 10);

    // Build Table
    const tableEl = document.createElement('div');
    tableEl.className = 'gantt-table';

    // Sidebar
    const sidebarEl = document.createElement('div');
    sidebarEl.className = 'gantt-sidebar';
    sidebarEl.innerHTML = `<div class="gantt-sidebar-header">📋 Tugas & Aktivitas (${filteredTasks.length})</div>`;

    // Canvas
    const canvasEl = document.createElement('div');
    canvasEl.className = 'gantt-canvas';

    // Canvas Header (Dates)
    const headerDatesEl = document.createElement('div');
    headerDatesEl.className = 'gantt-header-dates';
    days.forEach(d => {
      const dStr = d.toISOString().slice(0, 10);
      const isToday = (dStr === todayStr);
      const col = document.createElement('div');
      col.className = `gantt-header-date-col ${isToday ? 'is-today' : ''}`;
      col.innerHTML = `<span>${dayNames[d.getDay()]}</span><strong>${d.getDate()}</strong>`;
      headerDatesEl.appendChild(col);
    });
    canvasEl.appendChild(headerDatesEl);

    if (filteredTasks.length === 0) {
      const emptyRow = document.createElement('div');
      emptyRow.className = 'gantt-sidebar-row';
      emptyRow.innerHTML = `<span style="color:var(--text-muted); font-style:italic;">Belum ada tugas</span>`;
      sidebarEl.appendChild(emptyRow);

      const emptyCanvasRow = document.createElement('div');
      emptyCanvasRow.className = 'gantt-track-row';
      emptyCanvasRow.innerHTML = `<span style="padding-left:1rem; color:var(--text-muted); font-style:italic;">Tugas alur kerja akan muncul sebagai bar horizontal di sini</span>`;
      canvasEl.appendChild(emptyCanvasRow);
    } else {
      filteredTasks.forEach(task => {
        const colDef = KANBAN_COLUMNS.find(c => c.id === task.status) || KANBAN_COLUMNS[1];
        const pInfo = getCardPriority(task);

        // Sidebar row
        const rowSidebar = document.createElement('div');
        rowSidebar.className = 'gantt-sidebar-row';
        rowSidebar.innerHTML = `
          <div style="display:flex; align-items:center; gap:6px; min-width:0; overflow:hidden;">
            ${pInfo ? `<span class="card-priority-badge priority-${pInfo.id}" style="font-size:0.62rem; padding:1px 4px;">${pInfo.shortLabel}</span>` : ''}
            <span class="gantt-task-name" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
          </div>
          <span class="card-status-badge status-${task.status}" style="font-size:0.65rem; padding:1px 6px;">
            ${colDef.icon} ${colDef.label}
          </span>
        `;
        rowSidebar.addEventListener('click', () => openCardModal(task));
        sidebarEl.appendChild(rowSidebar);

        // Track row in canvas
        const trackRow = document.createElement('div');
        trackRow.className = 'gantt-track-row';

        // Background columns
        days.forEach(d => {
          const dStr = d.toISOString().slice(0, 10);
          const gridCol = document.createElement('div');
          gridCol.className = `gantt-grid-col ${dStr === todayStr ? 'is-today' : ''}`;
          trackRow.appendChild(gridCol);
        });

        // Compute bar span
        const taskStartStr = task.startDate || (task.createdAt ? task.createdAt.slice(0, 10) : todayStr);
        const taskDueStr = task.dueDate || (task.reminder && task.reminder.datetime ? task.reminder.datetime.slice(0, 10) : taskStartStr);

        const taskStartDate = new Date(taskStartStr + 'T00:00:00');
        const taskDueDate = new Date(taskDueStr + 'T23:59:59');

        const windowStartTime = startDate.getTime();
        const windowEndTime = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59).getTime();
        const windowDuration = windowEndTime - windowStartTime;

        // Check if overlaps window
        if (taskDueDate.getTime() >= windowStartTime && taskStartDate.getTime() <= windowEndTime) {
          const clampedStart = Math.max(taskStartDate.getTime(), windowStartTime);
          const clampedEnd = Math.min(taskDueDate.getTime(), windowEndTime);

          const leftPercent = ((clampedStart - windowStartTime) / windowDuration) * 100;
          const widthPercent = Math.max(2.5, ((clampedEnd - clampedStart) / windowDuration) * 100);

          const barEl = document.createElement('div');
          barEl.className = `gantt-bar-item status-${task.status}`;
          barEl.style.left = `${leftPercent}%`;
          barEl.style.width = `${widthPercent}%`;
          barEl.style.backgroundColor = colDef.color;
          barEl.textContent = task.title;
          barEl.title = `${task.title} (${colDef.label}) : ${taskStartStr} s/d ${taskDueStr}`;

          barEl.addEventListener('click', (e) => {
            e.stopPropagation();
            openCardModal(task);
          });

          trackRow.appendChild(barEl);
        }

        canvasEl.appendChild(trackRow);
      });
    }

    tableEl.appendChild(sidebarEl);
    tableEl.appendChild(canvasEl);
    timelineGanttWrapper.appendChild(tableEl);
  }

  function renderCalendarView() {
    if (!calendarGridContainer) return;
    calendarGridContainer.innerHTML = '';

    const kanbanTasks = cards.filter(c => !c.archived && isKanbanTask(c));
    const parsedQuery = metaEngine.parseQuery(searchQuery);
    const filteredTasks = kanbanTasks.filter(c => metaEngine.matches(c, parsedQuery));

    const year = calendarCurrentDate.getFullYear();
    const month = calendarCurrentDate.getMonth();

    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const dayHeaders = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

    if (calendarMonthLabel) {
      calendarMonthLabel.textContent = `${monthNames[month]} ${year}`;
    }

    // 1. Day headers
    dayHeaders.forEach(dh => {
      const h = document.createElement('div');
      h.className = 'calendar-day-header';
      h.textContent = dh;
      calendarGridContainer.appendChild(h);
    });

    // 2. Month math
    const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // Total cells = 35 or 42
    const totalCells = (firstDayIndex + daysInMonth > 35) ? 42 : 35;

    for (let i = 0; i < totalCells; i++) {
      const cell = document.createElement('div');
      cell.className = 'calendar-day-cell';

      let cellDateNumber = 0;
      let cellDateStr = '';

      if (i < firstDayIndex) {
        // Prev month
        cellDateNumber = prevMonthDays - firstDayIndex + i + 1;
        cell.classList.add('other-month');
        const prevMonth = month === 0 ? 11 : month - 1;
        const prevYear = month === 0 ? year - 1 : year;
        cellDateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(cellDateNumber).padStart(2, '0')}`;
      } else if (i >= firstDayIndex + daysInMonth) {
        // Next month
        cellDateNumber = i - (firstDayIndex + daysInMonth) + 1;
        cell.classList.add('other-month');
        const nextMonth = month === 11 ? 0 : month + 1;
        const nextYear = month === 11 ? year + 1 : year;
        cellDateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(cellDateNumber).padStart(2, '0')}`;
      } else {
        // Current month
        cellDateNumber = i - firstDayIndex + 1;
        cellDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(cellDateNumber).padStart(2, '0')}`;
      }

      if (cellDateStr === todayStr) {
        cell.classList.add('is-today');
      }

      // Top row in cell
      const topRow = document.createElement('div');
      topRow.className = 'calendar-cell-top';
      topRow.innerHTML = `<span class="calendar-date-number">${cellDateNumber}</span>`;
      cell.appendChild(topRow);

      // Tasks for this date
      const tasksOnDate = filteredTasks.filter(t => {
        const start = t.startDate || (t.createdAt ? t.createdAt.slice(0, 10) : null);
        const due = t.dueDate || (t.reminder && t.reminder.datetime ? t.reminder.datetime.slice(0, 10) : start);
        if (!due && !start) return false;
        if (start && due && start <= due) {
          return cellDateStr >= start && cellDateStr <= due;
        }
        return cellDateStr === (due || start);
      });

      tasksOnDate.slice(0, 3).forEach(task => {
        const colDef = KANBAN_COLUMNS.find(c => c.id === task.status) || KANBAN_COLUMNS[1];
        const pInfo = getCardPriority(task);
        const chip = document.createElement('div');
        chip.className = `calendar-task-chip status-${task.status}`;
        chip.style.backgroundColor = 'var(--bg-hover)';
        chip.style.borderColor = pInfo ? pInfo.color : colDef.color;
        chip.innerHTML = `
          ${pInfo ? `<span style="font-size:0.68rem;">${pInfo.shortLabel.split(' ')[0]}</span>` : `<span>${colDef.icon}</span>`}
          <span style="overflow:hidden;text-overflow:ellipsis;">${escapeHtml(task.title)}</span>
        `;
        chip.title = `${task.title} (${colDef.label}${pInfo ? ' - ' + pInfo.label : ''})`;
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          openCardModal(task);
        });
        cell.appendChild(chip);
      });

      if (tasksOnDate.length > 3) {
        const moreLabel = document.createElement('span');
        moreLabel.style.fontSize = '0.68rem';
        moreLabel.style.color = 'var(--text-muted)';
        moreLabel.textContent = `+${tasksOnDate.length - 3} lainnya`;
        cell.appendChild(moreLabel);
      }

      // Clicking day cell creates task for this date
      cell.addEventListener('click', () => {
        openCardModal(null, 'kanban', 'todo', cellDateStr);
      });

      calendarGridContainer.appendChild(cell);
    }
  }

  function setupFreeCardPosition(cardEl, card, index, container) {
    const cardId = card.id || String(index);
    let pos = cardPositions[cardId];

    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') {
      // Default initial layout: scatter nicely in a staggered grid
      const colWidth = 310;
      const rowHeight = 220;
      const containerWidth = Math.max(640, container.clientWidth || 900);
      const cols = Math.max(1, Math.floor(containerWidth / colWidth));
      
      const col = index % cols;
      const row = Math.floor(index / cols);
      
      // Slight natural random tilt & jitter for the "acak" board feel
      const jitterX = Math.round((Math.sin(index * 3.7) * 16));
      const jitterY = Math.round((Math.cos(index * 2.3) * 14));
      const rotation = Number((Math.sin(index * 5.1) * 3).toFixed(1)); // between -3deg and +3deg

      pos = {
        x: Math.max(12, col * colWidth + 16 + jitterX),
        y: Math.max(12, row * rowHeight + 16 + jitterY),
        rot: rotation,
        z: index + 1
      };
      cardPositions[cardId] = pos;
    }

    cardEl.style.position = 'absolute';
    cardEl.style.left = `${pos.x}px`;
    cardEl.style.top = `${pos.y}px`;
    cardEl.style.zIndex = pos.z || 1;
    cardEl.style.transform = pos.rot ? `rotate(${pos.rot}deg)` : 'none';
  }

  function adjustFreeContainerHeight(container) {
    let maxBottom = 400;
    const cardsInContainer = container.querySelectorAll('.card');
    cardsInContainer.forEach(el => {
      const top = parseFloat(el.style.top) || 0;
      const height = el.offsetHeight || 200;
      if (top + height + 60 > maxBottom) {
        maxBottom = top + height + 60;
      }
    });
    container.style.minHeight = `${maxBottom}px`;
  }

  function attachCardDrag(cardEl, card, container) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let origLeft = 0, origTop = 0;
    let hasMoved = false;

    const onPointerDown = (e) => {
      // Only drag via left mouse or single touch
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      
      // Don't drag if clicking buttons, inputs, links, or checklists
      const interactive = e.target.closest('button, a, input, textarea, select, .checkbox-label, .card-tag-pill');
      if (interactive) return;

      isDragging = true;
      hasMoved = false;
      cardEl.setPointerCapture(e.pointerId);

      highestZIndex += 1;
      cardEl.style.zIndex = highestZIndex;
      cardEl.classList.add('is-dragging');

      startX = e.clientX;
      startY = e.clientY;
      origLeft = parseFloat(cardEl.style.left) || 0;
      origTop = parseFloat(cardEl.style.top) || 0;

      e.preventDefault();
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      if (!hasMoved && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
        hasMoved = true;
      }

      if (hasMoved) {
        const newLeft = Math.max(0, origLeft + deltaX);
        const newTop = Math.max(0, origTop + deltaY);

        cardEl.style.left = `${newLeft}px`;
        cardEl.style.top = `${newTop}px`;
      }
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      cardEl.classList.remove('is-dragging');
      try { cardEl.releasePointerCapture(e.pointerId); } catch (err) {}

      if (hasMoved) {
        const finalLeft = parseFloat(cardEl.style.left) || 0;
        const finalTop = parseFloat(cardEl.style.top) || 0;
        const cardId = card.id;

        if (!cardPositions[cardId]) cardPositions[cardId] = {};
        cardPositions[cardId].x = finalLeft;
        cardPositions[cardId].y = finalTop;
        cardPositions[cardId].z = highestZIndex;

        saveCardPositions();
        adjustFreeContainerHeight(container);
      }
    };

    cardEl.addEventListener('pointerdown', onPointerDown);
    cardEl.addEventListener('pointermove', onPointerMove);
    cardEl.addEventListener('pointerup', onPointerUp);
    cardEl.addEventListener('pointercancel', onPointerUp);
  }

  function tidyUpCanvasCards() {
    if (currentDensity !== 'free') return;

    const grids = [pinnedGrid, cardsGrid];
    
    grids.forEach(grid => {
      const cardEls = Array.from(grid.querySelectorAll('.card'));
      if (cardEls.length === 0) return;

      const colWidth = 310;
      const rowGap = 20;
      const containerWidth = Math.max(640, grid.clientWidth || 900);
      const cols = Math.max(1, Math.floor(containerWidth / colWidth));

      // Calculate smooth dynamic masonry-like positions
      const colHeights = new Array(cols).fill(16);

      cardEls.forEach((el, index) => {
        // Find column with least height
        let bestCol = 0;
        for (let c = 1; c < cols; c++) {
          if (colHeights[c] < colHeights[bestCol]) {
            bestCol = c;
          }
        }

        const targetX = bestCol * colWidth + 16;
        const targetY = colHeights[bestCol];
        const cardHeight = el.offsetHeight || 180;

        colHeights[bestCol] += cardHeight + rowGap;

        // Apply smooth CSS transition
        el.classList.add('is-tidying');
        el.style.left = `${targetX}px`;
        el.style.top = `${targetY}px`;
        el.style.transform = 'rotate(0deg)';

        const cardId = el.getAttribute('data-id') || String(index);
        cardPositions[cardId] = {
          x: targetX,
          y: targetY,
          rot: 0,
          z: index + 1
        };

        setTimeout(() => {
          el.classList.remove('is-tidying');
        }, 600);
      });

      saveCardPositions();
      adjustFreeContainerHeight(grid);
    });

    alertToast('Kartu berhasil dirapikan!');
  }


  function createCardElement(card) {
    const cardEl = document.createElement('div');
    cardEl.className = `card ${card.pinned ? 'pinned' : ''}`;
    cardEl.setAttribute('data-id', card.id || '');
    cardEl.style.setProperty('--card-color', card.color || '#6366f1');

    const isTask = isKanbanTask(card);
    const cardStatus = card.status || 'todo';
    const statusDef = KANBAN_COLUMNS.find(c => c.id === cardStatus) || KANBAN_COLUMNS[1];
    const priorityInfo = getCardPriority(card);
    if (priorityInfo) {
      cardEl.classList.add(`has-priority-${priorityInfo.id}`);
    }

    // Header
    const headerEl = document.createElement('div');
    headerEl.className = 'card-header';
    headerEl.innerHTML = `
      <div class="card-title-group" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
        <span class="card-drag-indicator" title="Geser kartu">⠿</span>
        ${priorityInfo ? `<span class="card-priority-badge priority-${priorityInfo.id}" title="Prioritas: ${priorityInfo.label}">
          ${priorityInfo.shortLabel}
        </span>` : ''}
        ${isTask ? `<span class="card-status-badge status-${cardStatus}" title="Status: ${statusDef.label}">
          ${statusDef.icon} ${statusDef.label}
        </span>` : ''}
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
        <button class="card-action-btn" title="Pindahkan ke Kotak Arsip & Sampah" data-action="delete">
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
      archiveCard(card.id);
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
      // Skip priority in metadata box since it's already a first-class header badge
      if (key.toLowerCase() === 'priority' || key.toLowerCase() === 'prioritas') continue;
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
        const actionLabel = (fieldDef && fieldDef.actionLabel)
          ? escapeHtml(fieldDef.actionLabel)
          : `Buka ${escapeHtml(label.replace(/\s*\/.*$/, ''))}`;
        valEl.innerHTML = `
          <a href="${escapeHtml(val)}" target="_blank" rel="noopener noreferrer" class="metadata-link-btn">
            ${icon || '🔗'} ${actionLabel}
          </a>
        `;
      } else if (type === 'badge' || type === 'pill' || key === 'role' || (fieldDef && fieldDef.type === 'badge')) {
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
    const isComplete = (completed === total && total > 0);

    const box = document.createElement('div');
    box.className = 'card-checklist-box';

    // Progress bar (Trello/Notion visual progress)
    const progressWrap = document.createElement('div');
    progressWrap.className = 'checklist-progress-bar-wrap';
    progressWrap.innerHTML = `
      <div class="checklist-progress-track">
        <div class="checklist-progress-fill ${isComplete ? 'is-complete' : ''}" style="width: ${percentage}%"></div>
      </div>
      <span class="checklist-progress-badge ${isComplete ? 'is-complete' : ''}">
        ${isComplete ? '✅' : '☑️'} ${completed}/${total} (${percentage}%)
      </span>
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
    const activeCards = cards.filter(c => !c.archived);
    const noticeCards = activeCards.filter(c => !isKanbanTask(c));
    const kanbanCards = activeCards.filter(c => isKanbanTask(c));
    const archivedCards = cards.filter(c => c.archived);

    countAll.textContent = noticeCards.length;
    countPinned.textContent = noticeCards.filter(c => c.pinned).length;
    if (countDocuments) countDocuments.textContent = noticeCards.filter(c => Array.isArray(c.attachments) && c.attachments.length > 0).length;
    countReminders.textContent = noticeCards.filter(c => c.reminder && c.reminder.datetime).length;
    countChecklist.textContent = noticeCards.filter(c => Array.isArray(c.checklist) && c.checklist.length > 0).length;

    if (countKanbanFlow) {
      countKanbanFlow.textContent = kanbanCards.length;
      countKanbanFlow.style.display = kanbanCards.length > 0 ? 'inline-flex' : 'none';
    }
    if (kanbanTotalBadge) {
      kanbanTotalBadge.textContent = `${kanbanCards.length} Tugas`;
    }

    if (archiveCountBadge) {
      archiveCountBadge.textContent = archivedCards.length;
      archiveCountBadge.style.display = archivedCards.length > 0 ? 'inline-flex' : 'none';
    }
  }

  // --- ARSIP & TEMPAT SAMPAH (SOFT DELETE LOGIC) ---
  function openArchiveModal() {
    renderArchiveModal();
    showModalOverlay(archiveModal);
  }

  function renderArchiveModal() {
    if (!archiveListContainer) return;
    archiveListContainer.innerHTML = '';
    const archivedCards = cards.filter(c => c.archived);
    if (archiveTotalBadge) {
      archiveTotalBadge.textContent = `${archivedCards.length} item`;
    }

    if (archivedCards.length === 0) {
      archiveListContainer.innerHTML = `
        <div class="archive-empty-state">
          <span style="font-size: 2.2rem; opacity: 0.6;">📦</span>
          <p style="margin: 8px 0 0; color: var(--text-muted); font-size: 0.88rem;">
            Kotak arsip & sampah kosong. Tidak ada catatan yang dihapus.
          </p>
        </div>
      `;
      return;
    }

    archivedCards.forEach(card => {
      const isTask = isKanbanTask(card);
      const pInfo = getCardPriority(card);
      const dateStr = card.archivedAt ? formatTimeAgo(card.archivedAt) : 'baru saja';

      const row = document.createElement('div');
      row.className = 'archive-item-row';
      row.innerHTML = `
        <div class="archive-item-info">
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            ${pInfo ? `<span class="card-priority-badge priority-${pInfo.id}" style="font-size:0.62rem; padding:1px 4px;">${pInfo.shortLabel}</span>` : ''}
            <strong class="archive-item-title">${escapeHtml(card.title || 'Tanpa Judul')}</strong>
            <span class="archive-item-origin-badge">${isTask ? '⚡ Kanban Task' : '📌 Notice Board'}</span>
          </div>
          <div class="archive-item-meta">
            <span>🗑️ Dihapus ${dateStr}</span>
            ${card.tags && card.tags.length ? `<span>• Tags: ${card.tags.map(t => '#' + escapeHtml(t)).join(' ')}</span>` : ''}
          </div>
        </div>
        <div class="archive-item-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-action="restore" style="font-size:0.75rem; padding:4px 8px;">
            🔄 Pulihkan
          </button>
          <button type="button" class="btn-danger-subtle" data-action="delete-perm">
            🗑️ Hapus Permanen
          </button>
        </div>
      `;

      row.querySelector('[data-action="restore"]').addEventListener('click', () => {
        restoreCard(card.id);
      });

      row.querySelector('[data-action="delete-perm"]').addEventListener('click', () => {
        permanentDeleteCard(card.id);
      });

      archiveListContainer.appendChild(row);
    });
  }

  function archiveCard(id) {
    const card = cards.find(c => c.id === id);
    if (!card) return;
    card.archived = true;
    card.archivedAt = new Date().toISOString();
    saveCards();
    renderAll();
    alertToast(`Catatan "${card.title || 'Tanpa Judul'}" dipindahkan ke Arsip & Sampah 📦`);
  }

  function restoreCard(id) {
    const card = cards.find(c => c.id === id);
    if (!card) return;
    delete card.archived;
    delete card.archivedAt;
    card.updatedAt = new Date().toISOString();
    saveCards();
    renderAll();
    renderArchiveModal();
    alertToast(`Catatan "${card.title || 'Tanpa Judul'}" berhasil dipulihkan! 🔄`);
  }

  function permanentDeleteCard(id) {
    const card = cards.find(c => c.id === id);
    const title = card ? card.title : 'catatan ini';
    if (!confirm(`Hapus PERMANEN "${title}"? Data tidak dapat dipulihkan lagi.`)) return;
    cards = cards.filter(c => c.id !== id);
    saveCards();
    renderAll();
    renderArchiveModal();
    alertToast(`Catatan telah dihapus secara permanen. 🗑️`);
  }

  function emptyArchive() {
    const archivedCount = cards.filter(c => c.archived).length;
    if (archivedCount === 0) {
      alertToast('Kotak arsip & sampah sudah kosong.');
      return;
    }
    if (!confirm(`Hapus PERMANEN semua ${archivedCount} kartu di tempat sampah? Tindakan ini tidak dapat dibatalkan.`)) return;
    cards = cards.filter(c => !c.archived);
    saveCards();
    renderAll();
    renderArchiveModal();
    alertToast(`Kotak sampah telah dikosongkan. 🧹`);
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
      el.style.display = show ? '' : 'none';
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

    const activeSection = {
      link: metadataCollapsible,
      document: attachmentsCollapsible,
      checklist: checklistCollapsible,
      reminder: reminderCollapsible
    }[type];
    if (activeSection && type !== 'note') {
      setTimeout(() => {
        activeSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
  }

  function openCardModal(card = null, defaultTarget = null, defaultStatus = 'todo', defaultDate = null) {
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

    // Target Board, Status & Date Range Setup
    const isTask = card ? isKanbanTask(card) : (defaultTarget === 'kanban' || currentDomain === 'kanban');
    if (isTask) {
      if (targetBoardKanbanBtn) targetBoardKanbanBtn.classList.add('active');
      if (targetBoardNoticeBtn) targetBoardNoticeBtn.classList.remove('active');
      if (formStatusRow) formStatusRow.style.display = 'flex';
      if (formDateRangeRow) formDateRangeRow.style.display = 'flex';
      if (formStatus) formStatus.value = (card && card.status) ? card.status : (defaultStatus || 'todo');
      if (formStartDate) formStartDate.value = card ? (card.startDate || '') : (defaultDate || new Date().toISOString().slice(0, 10));
      if (formDueDate) formDueDate.value = card ? (card.dueDate || '') : (defaultDate || '');
    } else {
      if (targetBoardNoticeBtn) targetBoardNoticeBtn.classList.add('active');
      if (targetBoardKanbanBtn) targetBoardKanbanBtn.classList.remove('active');
      if (formStatusRow) formStatusRow.style.display = 'none';
      if (formDateRangeRow) formDateRangeRow.style.display = 'none';
      if (formStatus) formStatus.value = '';
      if (formStartDate) formStartDate.value = '';
      if (formDueDate) formDueDate.value = '';
    }

    if (formPriority) {
      const pInfo = card ? getCardPriority(card) : null;
      formPriority.value = pInfo ? pInfo.key : '';
    }

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
    showModalOverlay(cardModal);
    const modalBody = cardModal.querySelector('.modal-body');
    if (modalBody) modalBody.scrollTop = 0;
    if (formContent) {
      formContent.style.height = 'auto';
      formContent.style.height = Math.max(64, Math.min(160, formContent.scrollHeight)) + 'px';
    }
    formTitle.focus({ preventScroll: true });
  }

  function closeCardModal() {
    hideModalOverlay(cardModal);
  }

  function renderMetadataFormFields(existingData = {}) {
    updateMetadataLabels();
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

    const isKanban = targetBoardKanbanBtn && targetBoardKanbanBtn.classList.contains('active');
    const assignedStatus = isKanban ? (formStatus && formStatus.value ? formStatus.value : 'todo') : null;
    const assignedPriority = (formPriority && formPriority.value) ? formPriority.value : null;

    if (assignedPriority) {
      metadata.priority = assignedPriority;
    } else {
      delete metadata.priority;
      delete metadata.prioritas;
    }

    const existingCard = cards.find(c => c.id === id);
    const cardPayload = {
      id,
      title,
      status: assignedStatus,
      priority: assignedPriority,
      startDate: isKanban ? (formStartDate && formStartDate.value ? formStartDate.value : null) : null,
      dueDate: isKanban ? (formDueDate && formDueDate.value ? formDueDate.value : null) : null,
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
    showModalOverlay(docViewerModal);
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
    showModalOverlay(schemaModal);
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
      version: '2.0',
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

  // --- FILE EXPLORER IMPLEMENTATION ---
  function switchExplorerView(mode) {
    const detailPane = document.getElementById('explorerDetailView');
    const treePane = document.getElementById('explorerTreeView');
    const cardPane = document.getElementById('explorerCardView');

    if (detailPane) detailPane.style.display = (mode === 'detail') ? 'block' : 'none';
    if (treePane) treePane.style.display = (mode === 'tree') ? 'block' : 'none';
    if (cardPane) cardPane.style.display = (mode === 'card') ? 'block' : 'none';

    renderFileExplorer();
  }

  function getFilteredAndSortedDocs() {
    let list = Array.isArray(indexedDocsList) ? [...indexedDocsList] : [];

    // Filter by breadcrumb path if set
    if (explorerCurrentPath) {
      list = list.filter(d => (d.path || '').startsWith(explorerCurrentPath));
    }

    // Filter by search query
    if (explorerSearchQuery) {
      list = list.filter(d => {
        const name = (d.file_name || d.fileName || '').toLowerCase();
        const p = (d.path || '').toLowerCase();
        return name.includes(explorerSearchQuery) || p.includes(explorerSearchQuery);
      });
    }

    // Sort list
    list.sort((a, b) => {
      let valA, valB;
      if (explorerSortKey === 'size') {
        valA = a.size || 0;
        valB = b.size || 0;
      } else if (explorerSortKey === 'chunks') {
        valA = a.chunk_count !== undefined ? a.chunk_count : (a.chunkCount || 0);
        valB = b.chunk_count !== undefined ? b.chunk_count : (b.chunkCount || 0);
      } else if (explorerSortKey === 'type') {
        valA = (a.extension || '').toLowerCase();
        valB = (b.extension || '').toLowerCase();
      } else {
        valA = (a.file_name || a.fileName || '').toLowerCase();
        valB = (b.file_name || b.fileName || '').toLowerCase();
      }

      if (valA < valB) return explorerSortAsc ? -1 : 1;
      if (valA > valB) return explorerSortAsc ? 1 : -1;
      return 0;
    });

    return list;
  }

  function renderFileExplorer() {
    const docs = getFilteredAndSortedDocs();
    if (indexedFilesBadge) {
      indexedFilesBadge.textContent = `${docs.length} berkas`;
    }

    renderExplorerBreadcrumbs();

    if (explorerViewMode === 'tree') {
      renderExplorerTreeView(docs);
    } else if (explorerViewMode === 'card') {
      renderExplorerCardView(docs);
    } else {
      renderIndexedDocsTable(docs);
    }
  }

  function renderExplorerBreadcrumbs() {
    const bar = document.getElementById('explorerBreadcrumbBar');
    if (!bar) return;

    bar.innerHTML = '';
    const rootItem = document.createElement('span');
    rootItem.className = `breadcrumb-item ${!explorerCurrentPath ? 'active' : ''}`;
    rootItem.textContent = '📁 Semua Dokumen';
    rootItem.addEventListener('click', () => {
      explorerCurrentPath = '';
      renderFileExplorer();
    });
    bar.appendChild(rootItem);

    if (explorerCurrentPath) {
      const parts = explorerCurrentPath.split(/[/\\]/).filter(Boolean);
      let cumulativePath = '';

      parts.forEach((part, idx) => {
        const sep = document.createElement('span');
        sep.className = 'breadcrumb-separator';
        sep.textContent = ' / ';
        bar.appendChild(sep);

        // Rebuild platform separator correctly
        cumulativePath += (idx === 0 && explorerCurrentPath.includes(':') ? part + '\\' : part + '\\');
        const thisPath = cumulativePath.replace(/\\$/, '');

        const item = document.createElement('span');
        item.className = `breadcrumb-item ${idx === parts.length - 1 ? 'active' : ''}`;
        item.textContent = part;
        if (idx !== parts.length - 1) {
          item.addEventListener('click', () => {
            explorerCurrentPath = thisPath;
            renderFileExplorer();
          });
        }
        bar.appendChild(item);
      });
    }
  }

  // --- 1. Detail View (Table) ---
  function renderIndexedDocsTable(docsToRender) {
    if (!indexedFilesTableBody) return;
    const docs = docsToRender || getFilteredAndSortedDocs();
    indexedFilesTableBody.innerHTML = '';

    if (!Array.isArray(docs) || docs.length === 0) {
      indexedFilesTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="table-empty-cell">Tidak ada dokumen yang cocok dengan saringan atau belum diindeks.</td>
        </tr>
      `;
      return;
    }

    docs.forEach(doc => {
      const tr = document.createElement('tr');
      const ext = (doc.extension || '').toLowerCase();
      let docIcon = '📄';
      if (ext === '.pdf') docIcon = '📕';
      else if (ext === '.docx') docIcon = '📘';
      else if (ext === '.xlsx') docIcon = '📗';
      else if (ext === '.md') docIcon = '📝';

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
          <div class="table-actions">
            <button class="btn-table-action btn-view-doc" title="Lihat Teks Pratinjau">👁️</button>
            <button class="btn-table-action btn-open-native" title="Buka di Windows Explorer">📁</button>
          </div>
        </td>
      `;

      tr.querySelector('.btn-view-doc').addEventListener('click', () => {
        openDocumentViewerModal(doc);
      });

      tr.querySelector('.btn-open-native').addEventListener('click', async () => {
        await requestOpenFile(doc.path, false, doc.folder_id || doc.folderId);
      });

      indexedFilesTableBody.appendChild(tr);
    });
  }

  // --- 2. Tree View (Hierarchy) ---
  function renderExplorerTreeView(docs) {
    const treeContainer = document.getElementById('treeContainer');
    if (!treeContainer) return;
    treeContainer.innerHTML = '';

    if (!docs || docs.length === 0) {
      treeContainer.innerHTML = '<div class="tree-empty-notice">Tidak ada dokumen yang ditemukan.</div>';
      return;
    }

    // Build directory tree structure
    const rootTree = { name: 'Root', isFolder: true, children: {}, files: [] };

    docs.forEach(doc => {
      const fullPath = doc.path || '';
      const parts = fullPath.split(/[/\\]/).filter(Boolean);
      let curr = rootTree;

      // Folders in path (excluding filename)
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i];
        if (!curr.children[seg]) {
          curr.children[seg] = {
            name: seg,
            fullPath: parts.slice(0, i + 1).join('\\'),
            isFolder: true,
            children: {},
            files: []
          };
        }
        curr = curr.children[seg];
      }
      curr.files.push(doc);
    });

    const rootWrapper = document.createElement('div');
    rootWrapper.className = 'tree-node tree-node-root';

    // Render tree nodes recursively
    function renderTreeNode(folderObj, parentEl) {
      // Subfolders
      Object.values(folderObj.children).forEach(sub => {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'tree-node';

        const row = document.createElement('div');
        row.className = 'tree-item-row';
        row.innerHTML = `
          <span class="tree-toggle-arrow">▼</span>
          <span class="tree-item-icon">📁</span>
          <span class="tree-item-label" title="${escapeHtml(sub.fullPath)}">${escapeHtml(sub.name)}</span>
          <div class="tree-item-meta">
            <span>(${sub.files.length + Object.keys(sub.children).length} item)</span>
            <button type="button" class="tree-actions-btn btn-open-folder" title="Buka folder di Windows Explorer">📁 Buka</button>
          </div>
        `;

        // Toggle folder expand/collapse
        row.addEventListener('click', (e) => {
          if (e.target.closest('.btn-open-folder')) return;
          nodeEl.classList.toggle('collapsed');
        });

        row.querySelector('.btn-open-folder').addEventListener('click', async (e) => {
          e.stopPropagation();
          await requestOpenFile(sub.fullPath, true);
        });

        nodeEl.appendChild(row);

        const childrenEl = document.createElement('div');
        childrenEl.className = 'tree-children';
        renderTreeNode(sub, childrenEl);
        nodeEl.appendChild(childrenEl);

        parentEl.appendChild(nodeEl);
      });

      // Files in this folder
      folderObj.files.forEach(doc => {
        const fileRow = document.createElement('div');
        fileRow.className = 'tree-item-row tree-file-row';
        const ext = (doc.extension || '').toLowerCase();
        let icon = '📄';
        if (ext === '.pdf') icon = '📕';
        else if (ext === '.docx') icon = '📘';
        else if (ext === '.xlsx') icon = '📗';
        else if (ext === '.md') icon = '📝';

        fileRow.innerHTML = `
          <span class="tree-toggle-arrow" style="opacity: 0;">•</span>
          <span class="tree-item-icon">${icon}</span>
          <span class="tree-item-label" title="${escapeHtml(doc.path)}">${escapeHtml(doc.file_name || doc.fileName || '')}</span>
          <div class="tree-item-meta">
            <span>${docEngine.formatSize(doc.size || 0)}</span>
            <button type="button" class="tree-actions-btn btn-view-doc" title="Pratinjau Teks">👁️ Lihat</button>
            <button type="button" class="tree-actions-btn btn-open-native" title="Buka Dokumen Asli">🚀 Buka</button>
          </div>
        `;

        fileRow.querySelector('.btn-view-doc').addEventListener('click', () => {
          openDocumentViewerModal(doc);
        });

        fileRow.querySelector('.btn-open-native').addEventListener('click', async () => {
          await requestOpenFile(doc.path, false, doc.folder_id || doc.folderId);
        });

        parentEl.appendChild(fileRow);
      });
    }

    renderTreeNode(rootTree, rootWrapper);
    treeContainer.appendChild(rootWrapper);
  }

  // --- 3. Card View (Visual Tiles) ---
  function renderExplorerCardView(docs) {
    const grid = document.getElementById('docCardsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!docs || docs.length === 0) {
      grid.innerHTML = '<div class="folders-empty-notice" style="grid-column: 1 / -1;">Tidak ada dokumen yang ditemukan.</div>';
      return;
    }

    docs.forEach(doc => {
      const card = document.createElement('div');
      card.className = 'doc-tile-card';
      const ext = (doc.extension || '').toLowerCase();
      let icon = '📄';
      if (ext === '.pdf') icon = '📕';
      else if (ext === '.docx') icon = '📘';
      else if (ext === '.xlsx') icon = '📗';
      else if (ext === '.md') icon = '📝';

      const chunkCount = doc.chunk_count !== undefined ? doc.chunk_count : (doc.chunkCount || 0);

      card.innerHTML = `
        <div class="doc-tile-header">
          <div class="doc-tile-icon">${icon}</div>
          <div class="doc-tile-info">
            <span class="doc-tile-name" title="${escapeHtml(doc.path)}">${escapeHtml(doc.file_name || doc.fileName || '')}</span>
            <div class="doc-tile-sub">${escapeHtml(ext.toUpperCase().replace('.', ''))} Dokumen</div>
          </div>
        </div>

        <div class="doc-tile-details">
          <span>📏 ${docEngine.formatSize(doc.size || 0)}</span>
          <span>⚡ ${chunkCount} unit teks</span>
        </div>

        <div class="doc-tile-actions">
          <button type="button" class="doc-tile-btn btn-view-doc" title="Pratinjau Teks Dokumen">
            👁️ Pratinjau
          </button>
          <button type="button" class="doc-tile-btn btn-open-native" title="Buka Berkas di Windows Explorer">
            📁 Buka
          </button>
        </div>
      `;

      card.querySelector('.btn-view-doc').addEventListener('click', () => {
        openDocumentViewerModal(doc);
      });

      card.querySelector('.btn-open-native').addEventListener('click', async () => {
        await requestOpenFile(doc.path, false, doc.folder_id || doc.folderId);
      });

      grid.appendChild(card);
    });
  }
