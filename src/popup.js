/**
 * Popup UI for ZwiftPower Race Replay extension
 * Shows sync controls and progress
 */

const STORAGE_KEY_RACES = 'syncedRaces';
const STORAGE_KEY_SYNC_STATUS = 'syncStatus';
const SYNC_STATUS_MAX_AGE_MS = 2 * 60 * 1000;
const COMPLETE_RESET_DELAY_MS = 3000;
const RESTORABLE_SYNC_STATUSES = ['starting', 'syncing', 'error'];

// DOM Elements
const elements = {
  syncControls: document.getElementById('syncControls'),
  raceCard: document.querySelector('.race-card'),
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
let currentEventId = null;
let resetTimerId = null;

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

function setSyncButton(label, { disabled = false, busy = false } = {}) {
  elements.syncBtn.disabled = disabled;
  elements.syncBtn.querySelector('.btn-text').textContent = label;
  elements.syncBtn.querySelector('.btn-spinner').classList.toggle('hidden', !busy);
}

function showProgress(text, { percent, cancellable = false } = {}) {
  elements.syncProgress.classList.remove('hidden');
  elements.cancelBtn.classList.toggle('hidden', !cancellable);
  elements.progressText.textContent = text;
  if (percent !== undefined) {
    elements.progressFill.style.width = `${percent}%`;
  }
}

function hideProgress() {
  elements.syncProgress.classList.add('hidden');
  elements.cancelBtn.classList.add('hidden');
}

function renderStarting() {
  setSyncButton('Starting...', { disabled: true, busy: true });
  showProgress('Starting sync...', { percent: 0 });
}

function renderSyncing(status) {
  const percent = status.total > 0 ? (status.current / status.total) * 100 : 0;
  setSyncButton('Syncing...', { disabled: true, busy: true });
  showProgress(`Syncing ${status.current}/${status.total}: #${status.riderPosition} ${status.riderName}`, {
    percent,
    cancellable: true,
  });

  if (status.eventName) {
    elements.raceName.textContent = status.eventName;
  }
}

function renderComplete(status) {
  const skipped = status.errors > 0 ? ` (${status.errors} skipped)` : '';
  setSyncButton('Synced!');
  showProgress(`Done! ${status.successfulSyncs} riders synced${skipped}`, { percent: 100 });
  loadRaceList();

  resetTimerId = setTimeout(() => {
    setSyncButton('Re-sync race');
    hideProgress();
  }, COMPLETE_RESET_DELAY_MS);
}

function renderError(status) {
  setSyncButton('Retry sync');
  showProgress(status.error || 'Unknown error');
}

function renderCancelled() {
  setSyncButton('Sync race');
  hideProgress();
}

const syncStatusRenderers = {
  starting: renderStarting,
  syncing: renderSyncing,
  complete: renderComplete,
  error: renderError,
  cancelled: renderCancelled,
};

function updateSyncProgress(status) {
  clearTimeout(resetTimerId);
  syncStatusRenderers[status.status]?.(status);
}

/**
 * Show message when not on a race page
 */
function showNotOnRacePage(message) {
  elements.raceCard.classList.add('hidden');
  setSyncButton(message, { disabled: true });
}

/**
 * Show race info when on a valid race page
 */
function showRaceInfo(response) {
  elements.raceCard.classList.remove('hidden');
  elements.syncBtn.disabled = false;
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
}

async function restoreSyncStatus() {
  const status = await storage.getSyncStatus();

  if (isSyncStatusStale(status, Date.now(), SYNC_STATUS_MAX_AGE_MS)) {
    await storage.clearSyncStatus();
    return;
  }

  if (isSyncStatusForEvent(status, currentEventId) && RESTORABLE_SYNC_STATUSES.includes(status.status)) {
    updateSyncProgress(status);
  }
}

/**
 * Check current page and update UI
 */
async function checkCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;

    if (!tab?.url?.includes('zwiftpower.com')) {
      showNotOnRacePage('Open a ZwiftPower race');
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageInfo' });

    if (!response?.isEventPage) {
      showNotOnRacePage('Navigate to a race page');
      return;
    }

    currentEventId = response.eventId;
    showRaceInfo(response);

    const existingRaces = await storage.getRaces();
    if (existingRaces[response.eventId]) {
      setSyncButton('Re-sync race');
    }

    await restoreSyncStatus();
  } catch (error) {
    console.log('[Popup] Error checking page:', error.message);
    showNotOnRacePage('Open a ZwiftPower race');
  }
}

/**
 * Start race sync via background service worker
 */
function startSync() {
  if (!currentTabId) return;

  updateSyncProgress({ status: 'starting' });
  chrome.runtime.sendMessage({ action: 'startSync', tabId: currentTabId });
}

function cancelSync() {
  if (!currentTabId) return;

  chrome.runtime.sendMessage({ action: 'cancelSync', tabId: currentTabId });
  updateSyncProgress({ status: 'cancelled' });
}

function eventPageUrl(raceKey) {
  return `https://zwiftpower.com/events.php?zid=${raceKey.split('_')[0]}`;
}

function openRace(raceKey) {
  chrome.tabs.create({ url: eventPageUrl(raceKey) });
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
  const raceEntries = Object.entries(races).filter(([eventId]) => isValidEventId(eventId));

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
      const zwiftPowerUrl = eventPageUrl(eventId);
      return `
      <div class="race-item" data-event-id="${eventId}">
        <div class="race-item-info">
          <a href="${zwiftPowerUrl}" target="_blank" class="race-item-name" title="Open on ZwiftPower">${escapeHtml(race.eventName || `Race ${eventId}`)}</a>
          <div class="race-item-meta">${race.riders?.length || 0} riders | ${formatRelativeTime(race.syncedAt)}${syncIndicator}</div>
        </div>
        <div class="race-item-actions">
          <button class="btn btn-secondary btn-open" data-event-id="${eventId}">Open race</button>
          <button class="btn btn-danger btn-delete" data-event-id="${eventId}">×</button>
        </div>
      </div>
    `;
    })
    .join('');

  // Add event listeners
  elements.raceList.querySelectorAll('.btn-open').forEach((btn) => {
    btn.addEventListener('click', () => openRace(btn.dataset.eventId));
  });

  elements.raceList.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', () => deleteRace(btn.dataset.eventId));
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  const newStatus = changes[STORAGE_KEY_SYNC_STATUS]?.newValue;
  if (isSyncStatusForEvent(newStatus, currentEventId)) {
    updateSyncProgress(newStatus);
  }

  if (changes[STORAGE_KEY_RACES]) {
    loadRaceList();
  }
});

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  elements.syncBtn.addEventListener('click', startSync);
  elements.cancelBtn.addEventListener('click', cancelSync);
  await checkCurrentPage();
  await loadRaceList();
});
