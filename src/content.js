/**
 * Content script for ZwiftPower pages
 * Extracts rider list and fetches analysis data
 */

const ZWIFTPOWER_EVENT_PATTERN = /zwiftpower\.com\/events\.php\?zid=(\d+)/;
const ZWIFTPOWER_API_BASE = 'https://zwiftpower.com/api3.php';
const MAX_RIDERS_TO_SYNC = 50;
const DELAY_BETWEEN_REQUESTS_MS = 1500;
const HIGHLIGHTED_ROW_CLASS = 'pointed';
const FETCH_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;
const MAX_CONSECUTIVE_FAILURES = 5;

// Sync state
let currentSyncAbortController = null;

/**
 * Extract event ID from current URL
 */
function getEventIdFromUrl() {
  const match = window.location.href.match(ZWIFTPOWER_EVENT_PATTERN);
  return match ? match[1] : null;
}

/**
 * Extract event name from page
 */
function getEventName() {
  const titleEl = document.querySelector('h3') || document.querySelector('title');
  return titleEl?.textContent?.trim() || 'Unknown Race';
}

/**
 * Detect the active category from the page
 */
function getActiveCategory() {
  const hash = window.location.hash;
  if (hash) {
    const tabMatch = hash.match(/#tab_([a-z])/i);
    if (tabMatch) {
      const categoryId = tabMatch[1].toUpperCase();
      const tabPane = document.querySelector(hash);
      const table = tabPane?.querySelector('table');
      if (table) {
        return { categoryId, categoryName: `Category ${categoryId}`, table };
      }
    }
  }

  const activeTab = document.querySelector('.nav-tabs .nav-link.active, .nav-tabs .active a');
  if (activeTab) {
    const tabText = activeTab.textContent.trim();
    const categoryMatch = tabText.match(/^([A-E])\b/i);
    const categoryId = categoryMatch ? categoryMatch[1].toUpperCase() : null;

    const tabId = activeTab.getAttribute('href') || activeTab.closest('a')?.getAttribute('href');
    if (tabId && tabId.startsWith('#')) {
      const tabPane = document.querySelector(tabId);
      const table = tabPane?.querySelector('table');
      if (table) {
        return {
          categoryId,
          categoryName: categoryId ? `Category ${categoryId}` : tabText,
          table,
        };
      }
    }
  }

  const activePane = document.querySelector('.tab-pane.active, .tab-pane.show');
  if (activePane) {
    const paneId = activePane.id;
    const categoryMatch = paneId?.match(/tab_([a-z])/i);
    const categoryId = categoryMatch ? categoryMatch[1].toUpperCase() : null;
    const table = activePane.querySelector('table');
    if (table) {
      return {
        categoryId,
        categoryName: categoryId ? `Category ${categoryId}` : 'Results',
        table,
      };
    }
  }

  const tables = document.querySelectorAll('table');
  for (const table of tables) {
    if (table.offsetParent !== null) {
      const hasProfileLinks = table.querySelector('a[href*="profile.php"]');
      if (hasProfileLinks) {
        return { categoryId: null, categoryName: 'Results', table };
      }
    }
  }

  return { categoryId: null, categoryName: null, table: null };
}

/**
 * Detect current user's Zwift ID
 */
function detectCurrentUserZwiftId() {
  const highlightedRow = document.querySelector(`tr.${HIGHLIGHTED_ROW_CLASS}`);
  if (highlightedRow) {
    const link = highlightedRow.querySelector('a[href*="profile.php"]');
    const match = link?.href?.match(/z=(\d+)/);
    if (match) return match[1];
  }

  const profileLink = document.querySelector('a[href*="profile.php?z="]');
  if (profileLink) {
    const match = profileLink.href.match(/z=(\d+)/);
    if (match) return match[1];
  }

  return null;
}

/**
 * Wait for table data to load
 */
async function waitForTableData(maxWaitMs = 5000) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const { table } = getActiveCategory();
    if (table) {
      const profileLinks = table.querySelectorAll('a[href*="profile.php"], a[href*="/profile/"]');
      if (profileLinks.length > 0) {
        return true;
      }
    }

    const profileLinks = document.querySelectorAll('table a[href*="profile.php"]');
    if (profileLinks.length > 0) {
      return true;
    }

    await new Promise(r => setTimeout(r, 200));
  }

  return false;
}

/**
 * Extract Zwift ID from a profile link
 */
function extractZwiftId(href) {
  let match = href.match(/[?&]z=(\d+)/);
  if (match) return match[1];

  match = href.match(/\/profile\/(\d+)/);
  if (match) return match[1];

  match = href.match(/zwift_id=(\d+)/);
  if (match) return match[1];

  return null;
}

/**
 * Get list of riders from the active category table
 */
function getRidersFromPage() {
  const riders = [];
  const currentUserZwiftId = detectCurrentUserZwiftId();
  const { categoryId, categoryName, table } = getActiveCategory();

  if (!table) {
    return { riders: [], currentUserZwiftId, categoryId: null, categoryName: null };
  }

  const profileLinks = table.querySelectorAll(
    'a[href*="profile.php"], a[href*="/profile/"], a[href*="zwift_id"]'
  );

  profileLinks.forEach((link) => {
    const row = link.closest('tr');
    if (!row) return;

    const cells = row.querySelectorAll('td');
    let position = null;

    if (cells[0]) {
      const firstCellText = cells[0].textContent.trim();
      const posMatch = firstCellText.match(/^(\d+)$/);
      if (posMatch) {
        position = parseInt(posMatch[1], 10);
      }
    }

    if (!position) {
      for (const cell of cells) {
        const text = cell.textContent.trim();
        if (/^\d+$/.test(text) && parseInt(text, 10) <= 200) {
          position = parseInt(text, 10);
          break;
        }
      }
    }

    if (!position) {
      const tbody = row.closest('tbody');
      if (tbody) {
        const rows = [...tbody.querySelectorAll('tr')];
        position = rows.indexOf(row) + 1;
      }
    }

    if (!position || position > 200) return;

    const zwiftId = extractZwiftId(link.href);
    if (!zwiftId) return;

    const name = link.textContent.trim();
    if (!name) return;

    if (riders.some(r => r.zwiftId === zwiftId)) return;

    riders.push({
      position,
      name,
      zwiftId,
      isCurrentUser: zwiftId === currentUserZwiftId,
    });
  });

  return {
    riders: riders.sort((a, b) => a.position - b.position),
    currentUserZwiftId,
    categoryId,
    categoryName,
  };
}

/**
 * Select riders to sync, prioritizing current user first
 */
function selectRidersToSync(allRiders) {
  const currentUser = allRiders.find(r => r.isCurrentUser);
  const topRiders = allRiders.slice(0, MAX_RIDERS_TO_SYNC);

  // Add current user if not already in top riders
  if (currentUser && !topRiders.some(r => r.zwiftId === currentUser.zwiftId)) {
    topRiders.push(currentUser);
  }

  // Reorder to put current user first
  if (currentUser) {
    const reordered = topRiders.filter(r => r.zwiftId === currentUser.zwiftId);
    reordered.push(...topRiders.filter(r => r.zwiftId !== currentUser.zwiftId));
    return reordered;
  }

  return topRiders;
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/**
 * Fetch analysis data for a single rider with retry logic
 */
async function fetchRiderAnalysis(zwiftId, eventId, retries = MAX_RETRIES) {
  const url = `${ZWIFTPOWER_API_BASE}?do=analysis&zwift_id=${zwiftId}&zwift_event_id=${eventId}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Check if sync was cancelled
      if (currentSyncAbortController?.signal.aborted) {
        console.log(`[ZP Replay] Sync cancelled, skipping rider ${zwiftId}`);
        return null;
      }

      const response = await fetchWithTimeout(url, {
        headers: {
          'accept': 'application/json',
          'x-requested-with': 'XMLHttpRequest',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        console.warn(`[ZP Replay] HTTP ${response.status} for rider ${zwiftId} (attempt ${attempt + 1})`);
        if (attempt < retries && response.status >= 500) {
          await delay(DELAY_BETWEEN_REQUESTS_MS);
          continue;
        }
        return null;
      }

      const text = await response.text();
      if (!text || text.trim() === '') {
        return null;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        console.warn(`[ZP Replay] Invalid JSON for rider ${zwiftId}`);
        return null;
      }

      if (!data.xData || data.xData.length === 0) {
        return null;
      }

      return {
        distance: data.xData || [],
        time: data.x2Data || [],
        power: data.datasets?.['1']?.data || [],
        heartRate: data.datasets?.['2']?.data || [],
        elevation: data.datasets?.['0']?.data || [],
        duration: data.x2Data?.length || 0,
        totalDistance: data.xData?.[data.xData.length - 1] || 0,
      };
    } catch (error) {
      console.error(`[ZP Replay] Failed to fetch rider ${zwiftId} (attempt ${attempt + 1}):`, error.message);
      if (attempt < retries) {
        await delay(DELAY_BETWEEN_REQUESTS_MS);
        continue;
      }
      return null;
    }
  }
  return null;
}

/**
 * Delay helper
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Update sync status in storage
 */
async function updateSyncStatus(status) {
  await chrome.storage.local.set({ syncStatus: status });
}

/**
 * Get existing race data from storage
 */
async function getExistingRaceData(eventId) {
  const existing = await chrome.storage.local.get('syncedRaces');
  const races = existing.syncedRaces || {};
  return races[eventId] || null;
}

/**
 * Save race data to storage
 */
async function saveRaceData(raceData) {
  const existing = await chrome.storage.local.get('syncedRaces');
  const races = existing.syncedRaces || {};
  races[raceData.eventId] = raceData;
  await chrome.storage.local.set({ syncedRaces: races });
}

/**
 * Cancel any ongoing sync
 */
function cancelSync() {
  if (currentSyncAbortController) {
    currentSyncAbortController.abort();
    currentSyncAbortController = null;
    console.log('[ZP Replay] Sync cancelled');
  }
}

/**
 * Sync race data - main sync function with incremental support
 */
async function syncRaceData() {
  // Cancel any previous sync
  cancelSync();

  // Create new abort controller for this sync
  currentSyncAbortController = new AbortController();

  const eventId = getEventIdFromUrl();
  if (!eventId) {
    throw new Error('Not on a ZwiftPower event page');
  }

  await waitForTableData(5000);

  const eventName = getEventName();
  const { riders: allRiders, currentUserZwiftId, categoryId, categoryName } = getRidersFromPage();

  if (allRiders.length === 0) {
    throw new Error('No riders found in category.');
  }

  const ridersToSync = selectRidersToSync(allRiders);
  const fullEventName = categoryName ? `${eventName} - ${categoryName}` : eventName;
  const fullEventId = categoryId ? `${eventId}_${categoryId}` : eventId;

  // Load existing race data for incremental sync
  const existingRace = await getExistingRaceData(fullEventId);
  const existingRiderIds = new Set(existingRace?.riders?.map(r => r.zwiftId) || []);

  // Filter out already synced riders
  const newRidersToSync = ridersToSync.filter(r => !existingRiderIds.has(r.zwiftId));

  console.log(`[ZP Replay] Event: ${fullEventId}`);
  console.log(`[ZP Replay] Total riders to sync: ${ridersToSync.length}`);
  console.log(`[ZP Replay] Already synced: ${existingRiderIds.size}`);
  console.log(`[ZP Replay] New riders to fetch: ${newRidersToSync.length}`);

  // If all riders already synced, we're done
  if (newRidersToSync.length === 0) {
    await updateSyncStatus({
      status: 'complete',
      eventId: fullEventId,
      eventName: fullEventName,
      successfulSyncs: existingRace.riders.length,
      totalRiders: allRiders.length,
      errors: 0,
      message: 'All riders already synced',
    });
    return existingRace;
  }

  // FAIL EARLY: Test first rider to check if analysis data is available
  console.log(`[ZP Replay] Testing data availability with first rider...`);
  await updateSyncStatus({
    status: 'checking',
    eventId: fullEventId,
    eventName: fullEventName,
    message: 'Checking if race data is available...',
  });

  const testRider = newRidersToSync[0];
  const testAnalysis = await fetchRiderAnalysis(testRider.zwiftId, eventId);

  if (!testAnalysis) {
    throw new Error('Race analysis not ready yet. ZwiftPower may still be processing - try again later.');
  }

  // Start with existing riders or empty array
  const riderData = [...(existingRace?.riders || [])];
  const errors = [];

  // Add the test rider we already fetched
  riderData.push({
    position: testRider.position,
    name: testRider.name,
    zwiftId: testRider.zwiftId,
    isCurrentUser: testRider.isCurrentUser,
    ...testAnalysis,
  });

  // Save immediately so user can start watching
  let raceResult = {
    eventId: fullEventId,
    eventName: fullEventName,
    riders: riderData,
    errors,
    totalRiders: allRiders.length,
    syncedRiders: ridersToSync.length,
    successfulSyncs: riderData.length,
    currentUserZwiftId,
    categoryId,
    categoryName,
    syncedAt: new Date().toISOString(),
    syncInProgress: true,
    syncProgress: {
      current: 1,
      total: newRidersToSync.length,
    },
  };
  await saveRaceData(raceResult);

  // Update status
  await updateSyncStatus({
    status: 'syncing',
    eventId: fullEventId,
    eventName: fullEventName,
    current: 1,
    total: newRidersToSync.length,
    riderName: testRider.name,
    riderPosition: testRider.position,
  });

  // Sync remaining new riders (skip first since we already fetched it)
  let consecutiveFailures = 0;

  for (let i = 1; i < newRidersToSync.length; i++) {
    // Check if sync was cancelled
    if (currentSyncAbortController?.signal.aborted) {
      console.log('[ZP Replay] Sync aborted by user');
      break;
    }

    const rider = newRidersToSync[i];

    await updateSyncStatus({
      status: 'syncing',
      eventId: fullEventId,
      eventName: fullEventName,
      current: i + 1,
      total: newRidersToSync.length,
      riderName: rider.name,
      riderPosition: rider.position,
      consecutiveFailures,
    });

    await delay(DELAY_BETWEEN_REQUESTS_MS);

    const analysis = await fetchRiderAnalysis(rider.zwiftId, eventId);

    if (analysis) {
      consecutiveFailures = 0;
      riderData.push({
        position: rider.position,
        name: rider.name,
        zwiftId: rider.zwiftId,
        isCurrentUser: rider.isCurrentUser,
        ...analysis,
      });

      // Save after each successful fetch so replay updates in real-time
      raceResult = {
        ...raceResult,
        riders: riderData,
        successfulSyncs: riderData.length,
        syncedAt: new Date().toISOString(),
        syncProgress: {
          current: i + 1,
          total: newRidersToSync.length,
        },
      };
      await saveRaceData(raceResult);
    } else {
      consecutiveFailures++;
      errors.push(rider.position);

      // Stop if too many consecutive failures
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`[ZP Replay] Too many consecutive failures (${consecutiveFailures}), stopping sync`);
        await updateSyncStatus({
          status: 'error',
          error: `Sync stopped: ${consecutiveFailures} consecutive failures. Try again later.`,
          eventId: fullEventId,
          eventName: fullEventName,
        });
        break;
      }
    }
  }

  // Final save with sync complete
  raceResult = {
    ...raceResult,
    riders: riderData,
    errors,
    successfulSyncs: riderData.length,
    syncedAt: new Date().toISOString(),
    syncInProgress: false,
  };
  await saveRaceData(raceResult);

  console.log(`[ZP Replay] Sync complete: ${riderData.length} riders, ${errors.length} errors`);

  await updateSyncStatus({
    status: 'complete',
    eventId: fullEventId,
    eventName: fullEventName,
    successfulSyncs: riderData.length,
    totalRiders: allRiders.length,
    errors: errors.length,
  });

  return raceResult;
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'cancelSync') {
    cancelSync();
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'getPageInfo') {
    (async () => {
      const eventId = getEventIdFromUrl();
      if (!eventId) {
        sendResponse({ isEventPage: false });
        return;
      }

      await waitForTableData(3000);

      const { riders, currentUserZwiftId, categoryId, categoryName } = getRidersFromPage();
      const ridersToSync = selectRidersToSync(riders);

      sendResponse({
        eventId,
        eventName: getEventName(),
        riderCount: riders.length,
        syncCount: ridersToSync.length,
        isEventPage: true,
        currentUserDetected: !!currentUserZwiftId,
        categoryId,
        categoryName,
      });
    })();
    return true;
  }

  if (message.action === 'startSync') {
    (async () => {
      try {
        await updateSyncStatus({ status: 'starting' });
        const result = await syncRaceData();
        sendResponse({ success: true, data: result });
      } catch (error) {
        await updateSyncStatus({ status: 'error', error: error.message });
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  return false;
});
