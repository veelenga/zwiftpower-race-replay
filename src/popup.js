/**
 * Popup UI for ZwiftPower Race Replay extension
 * Shows sync controls and progress
 */

const STORAGE_KEY_RACES = 'syncedRaces';
const STORAGE_KEY_SYNC_STATUS = 'syncStatus';

// DOM Elements
const elements = {
  pageStatus: document.getElementById('pageStatus'),
  refreshBtn: document.getElementById('refreshBtn'),
  syncControls: document.getElementById('syncControls'),
  raceName: document.getElementById('raceName'),
  raceMeta: document.getElementById('raceMeta'),
  categoryBadge: document.getElementById('categoryBadge'),
  raceTip: document.getElementById('raceTip'),
  syncBtn: document.getElementById('syncBtn'),
  syncProgress: document.getElementById('syncProgress'),
  progressFill: document.getElementById('progressFill'),
  progressText: document.getElementById('progressText'),
  cancelBtn: document.getElementById('cancelBtn'),
  raceList: document.getElementById('raceList'),
};

let currentTabId = null;

/**
 * Storage helper functions
 */
const storage = {
  async getRaces() {
    const result = await chrome.storage.local.get(STORAGE_KEY_RACES);
    return result[STORAGE_KEY_RACES] || {};
  },

  async delete(eventId) {
    const races = await this.getRaces();
    delete races[eventId];
    await chrome.storage.local.set({ [STORAGE_KEY_RACES]: races });
  },

  async getSyncStatus() {
    const result = await chrome.storage.local.get(STORAGE_KEY_SYNC_STATUS);
    return result[STORAGE_KEY_SYNC_STATUS] || null;
  },

  async clearSyncStatus() {
    await chrome.storage.local.remove(STORAGE_KEY_SYNC_STATUS);
  },
};

/**
 * Update page status display
 */
function setPageStatus(type, message) {
  elements.pageStatus.className = `status ${type}`;
  elements.pageStatus.querySelector('.status-text').textContent = message;
}

/**
 * Format relative time
 */
function formatRelativeTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

/**
 * Update sync progress UI
 */
function updateSyncProgress(status) {
  if (!status) {
    elements.syncProgress.classList.add('hidden');
    return;
  }

  const btnText = elements.syncBtn.querySelector('.btn-text');
  const btnSpinner = elements.syncBtn.querySelector('.btn-spinner');

  switch (status.status) {
    case 'starting':
    case 'extracting':
      elements.syncBtn.disabled = true;
      btnText.textContent = 'Starting...';
      btnSpinner.classList.remove('hidden');
      elements.syncProgress.classList.remove('hidden');
      elements.progressFill.style.width = '0%';
      elements.progressText.textContent = 'Starting sync...';
      break;

    case 'checking':
      elements.syncBtn.disabled = true;
      btnText.textContent = 'Checking...';
      btnSpinner.classList.remove('hidden');
      elements.syncProgress.classList.remove('hidden');
      elements.progressFill.style.width = '5%';
      elements.progressText.textContent = status.message || 'Checking data availability...';
      break;

    case 'syncing':
      elements.syncBtn.disabled = true;
      btnText.textContent = 'Syncing...';
      btnSpinner.classList.remove('hidden');
      elements.syncProgress.classList.remove('hidden');
      elements.cancelBtn.classList.remove('hidden');

      const percent = status.total > 0 ? (status.current / status.total) * 100 : 0;
      elements.progressFill.style.width = `${percent}%`;
      elements.progressText.textContent = `Syncing ${status.current}/${status.total}: #${status.riderPosition} ${status.riderName}`;

      // Update race name if available
      if (status.eventName) {
        elements.raceName.textContent = status.eventName;
      }
      break;

    case 'complete':
      elements.syncBtn.disabled = false;
      btnText.textContent = 'Synced!';
      btnSpinner.classList.add('hidden');
      elements.cancelBtn.classList.add('hidden');
      elements.progressFill.style.width = '100%';
      elements.progressText.textContent = `Done! ${status.successfulSyncs} riders synced` +
        (status.errors > 0 ? ` (${status.errors} skipped)` : '');

      // Reload race list
      loadRaceList();

      // Reset button after delay
      setTimeout(() => {
        elements.syncBtn.disabled = false;
        btnText.textContent = 'Re-sync Race';
        elements.syncProgress.classList.add('hidden');
        storage.clearSyncStatus();
      }, 3000);
      break;

    case 'error':
      elements.syncBtn.disabled = false;
      btnText.textContent = 'Sync Failed';
      btnSpinner.classList.add('hidden');
      elements.cancelBtn.classList.add('hidden');
      elements.progressText.textContent = status.error || 'Unknown error';

      setTimeout(() => {
        elements.syncBtn.disabled = false;
        btnText.textContent = 'Retry Sync';
        elements.syncProgress.classList.add('hidden');
        storage.clearSyncStatus();
      }, 3000);
      break;
  }
}

/**
 * Check current page and update UI
 */
async function checkCurrentPage() {
  setPageStatus('loading', 'Checking page...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;

    if (!tab?.url?.includes('zwiftpower.com')) {
      setPageStatus('error', 'Not on ZwiftPower');

      // Still check for ongoing sync
      const syncStatus = await storage.getSyncStatus();
      if (syncStatus && (syncStatus.status === 'syncing' || syncStatus.status === 'extracting')) {
        elements.syncControls.classList.remove('hidden');
        elements.raceName.textContent = syncStatus.eventName || 'Syncing race...';
        elements.raceMeta.textContent = 'Sync in progress (you can navigate away)';
        elements.syncBtn.disabled = true;
        updateSyncProgress(syncStatus);
      }
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageInfo' });

    if (!response?.isEventPage) {
      setPageStatus('error', 'Not on a race page');

      // Still check for ongoing sync
      const syncStatus = await storage.getSyncStatus();
      if (syncStatus && (syncStatus.status === 'syncing' || syncStatus.status === 'extracting')) {
        elements.syncControls.classList.remove('hidden');
        elements.raceName.textContent = syncStatus.eventName || 'Syncing race...';
        elements.raceMeta.textContent = 'Sync in progress';
        elements.syncBtn.disabled = true;
        updateSyncProgress(syncStatus);
      }
      return;
    }

    setPageStatus('success', 'Race page detected');
    elements.syncControls.classList.remove('hidden');
    elements.raceName.textContent = response.eventName || `Event ${response.eventId}`;

    const isAllCategory = response.categoryId === 'ALL' || !response.categoryId;
    if (response.categoryName) {
      elements.categoryBadge.textContent = response.categoryName;
      elements.categoryBadge.className = `category-badge${isAllCategory ? ' all' : ''}`;
    } else {
      elements.categoryBadge.textContent = '';
    }

    if (isAllCategory) {
      elements.raceTip.classList.remove('hidden');
    } else {
      elements.raceTip.classList.add('hidden');
    }

    const userStatus = response.userParticipates ? ' (you participate)' : '';
    elements.raceMeta.textContent = `${response.riderCount} riders${userStatus}`;

    // Check if already synced
    const existingRaces = await storage.getRaces();
    if (existingRaces[response.eventId]) {
      elements.syncBtn.querySelector('.btn-text').textContent = 'Re-sync Race';
    }

    // Check for ongoing sync
    const syncStatus = await storage.getSyncStatus();
    if (syncStatus && ['starting', 'syncing', 'extracting'].includes(syncStatus.status)) {
      updateSyncProgress(syncStatus);
    }
  } catch (error) {
    console.log('[Popup] Error checking page:', error.message);
    setPageStatus('error', 'Could not read page');

    // Still check for ongoing sync
    const syncStatus = await storage.getSyncStatus();
    if (syncStatus && (syncStatus.status === 'syncing' || syncStatus.status === 'extracting')) {
      elements.syncControls.classList.remove('hidden');
      elements.raceName.textContent = syncStatus.eventName || 'Syncing race...';
      elements.raceMeta.textContent = 'Sync in progress';
      elements.syncBtn.disabled = true;
      updateSyncProgress(syncStatus);
    }
  }
}

/**
 * Start race sync via background service worker
 */
async function startSync() {
  if (!currentTabId) {
    const syncStatus = await storage.getSyncStatus();
    if (syncStatus && syncStatus.status === 'syncing') {
      return;
    }
    return;
  }

  updateSyncProgress({ status: 'extracting' });

  // Send start command to background service worker
  chrome.runtime.sendMessage({
    action: 'startSync',
    tabId: currentTabId,
  });
}

async function cancelSync() {
  if (!currentTabId) {
    return;
  }

  chrome.runtime.sendMessage({
    action: 'cancelSync',
    tabId: currentTabId,
  });

  const btnText = elements.syncBtn.querySelector('.btn-text');
  const btnSpinner = elements.syncBtn.querySelector('.btn-spinner');

  elements.syncBtn.disabled = false;
  btnText.textContent = 'Sync Cancelled';
  btnSpinner.classList.add('hidden');
  elements.cancelBtn.classList.add('hidden');
  elements.progressText.textContent = 'Sync cancelled by user';

  await storage.clearSyncStatus();

  setTimeout(() => {
    btnText.textContent = 'Re-sync Race';
    elements.syncProgress.classList.add('hidden');
  }, 2000);
}

/**
 * Open replay for a race
 */
function openReplay(eventId) {
  const replayUrl = chrome.runtime.getURL(`src/replay.html?eventId=${eventId}`);
  chrome.tabs.create({ url: replayUrl });
}

/**
 * Delete a synced race
 */
async function deleteRace(eventId) {
  if (!confirm('Delete this synced race?')) return;

  await storage.delete(eventId);
  await loadRaceList();
}

/**
 * Load and render race list
 */
async function loadRaceList() {
  const races = await storage.getRaces();
  const raceEntries = Object.entries(races);

  if (raceEntries.length === 0) {
    elements.raceList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
            <path d="M4.285 9.567a.5.5 0 0 1 .683.183A3.498 3.498 0 0 0 8 11.5a3.498 3.498 0 0 0 3.032-1.75.5.5 0 1 1 .866.5A4.498 4.498 0 0 1 8 12.5a4.498 4.498 0 0 1-3.898-2.25.5.5 0 0 1 .183-.683zM7 6.5C7 7.328 6.552 8 6 8s-1-.672-1-1.5S5.448 5 6 5s1 .672 1 1.5zm4 0c0 .828-.448 1.5-1 1.5s-1-.672-1-1.5S9.448 5 10 5s1 .672 1 1.5z"/>
          </svg>
        </div>
        <div class="empty-text">No races synced yet</div>
        <div class="empty-hint">Navigate to a ZwiftPower event page to sync</div>
      </div>`;
    return;
  }

  // Sort by sync date (newest first)
  raceEntries.sort((a, b) => new Date(b[1].syncedAt) - new Date(a[1].syncedAt));

  elements.raceList.innerHTML = raceEntries
    .map(([eventId, race]) => {
      const syncIndicator = race.syncInProgress ? ' <span class="sync-indicator">syncing...</span>' : '';
      return `
      <div class="race-item" data-event-id="${eventId}">
        <div class="race-item-info">
          <div class="race-item-name">${race.eventName || `Race ${eventId}`}</div>
          <div class="race-item-meta">${race.riders?.length || 0} riders | ${formatRelativeTime(race.syncedAt)}${syncIndicator}</div>
        </div>
        <div class="race-item-actions">
          <button class="btn btn-secondary btn-replay" data-event-id="${eventId}">Replay</button>
          <button class="btn btn-danger btn-delete" data-event-id="${eventId}">×</button>
        </div>
      </div>
    `;
    })
    .join('');

  // Add event listeners
  elements.raceList.querySelectorAll('.btn-replay').forEach((btn) => {
    btn.addEventListener('click', () => openReplay(btn.dataset.eventId));
  });

  elements.raceList.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', () => deleteRace(btn.dataset.eventId));
  });
}

/**
 * Listen for storage changes to update progress
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[STORAGE_KEY_SYNC_STATUS]) {
    const newStatus = changes[STORAGE_KEY_SYNC_STATUS].newValue;
    updateSyncProgress(newStatus);
  }
  // Refresh race list when races change
  if (areaName === 'local' && changes.syncedRaces) {
    loadRaceList();
  }
});

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  elements.syncBtn.addEventListener('click', startSync);
  elements.cancelBtn.addEventListener('click', cancelSync);
  elements.refreshBtn.addEventListener('click', checkCurrentPage);
  await checkCurrentPage();
  await loadRaceList();
});
