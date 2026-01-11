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
const PROFILE_LINK_SELECTOR = 'a[href*="profile.php?z="]';
const ZWIFT_ID_PATTERN = /z=(\d+)/;
const TABLE_LOAD_TIMEOUT_MS = 5000;
const PAGE_INFO_TIMEOUT_MS = 3000;
const TABLE_POLL_INTERVAL_MS = 200;
const MAX_VALID_POSITION = 200;

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

function getActiveCategory() {
  const categoryId = detectActiveCategoryId();
  const categoryName = formatCategoryName(categoryId);

  const tables = document.querySelectorAll('table');
  for (const table of tables) {
    if (table.offsetParent !== null && table.querySelector(PROFILE_LINK_SELECTOR)) {
      return { categoryId, categoryName, table };
    }
  }

  return { categoryId: null, categoryName: null, table: null };
}

function detectActiveCategoryId() {
  const activeButtons = document.querySelectorAll('button.btn-primary[data-value], button.active[data-value]');
  for (const btn of activeButtons) {
    const value = btn.dataset.value;
    if (isValidCategory(value)) {
      return value.toUpperCase();
    }
  }

  const hashCategory = parseCategoryFromHash(window.location.hash);
  if (hashCategory) return hashCategory;

  const urlCategory = parseCategoryFromUrl(window.location.search);
  if (urlCategory) return urlCategory;

  return null;
}

function detectCurrentUserZwiftId() {
  const profileLinks = document.querySelectorAll(PROFILE_LINK_SELECTOR);

  for (const link of profileLinks) {
    if (link.closest('table')) continue;

    const match = link.href.match(ZWIFT_ID_PATTERN);
    if (match) return match[1];
  }

  const highlightedRow = document.querySelector(`tr.${HIGHLIGHTED_ROW_CLASS}`);
  if (highlightedRow) {
    const link = highlightedRow.querySelector(PROFILE_LINK_SELECTOR);
    const match = link?.href?.match(ZWIFT_ID_PATTERN);
    if (match) return match[1];
  }

  return null;
}

async function waitForTableData(maxWaitMs = TABLE_LOAD_TIMEOUT_MS) {
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

    await new Promise(r => setTimeout(r, TABLE_POLL_INTERVAL_MS));
  }

  return false;
}


function findPositionFromCells(cells) {
  if (cells[0]) {
    const firstCellPos = parsePosition(cells[0].textContent, MAX_VALID_POSITION);
    if (firstCellPos) return firstCellPos;
  }

  for (const cell of cells) {
    const pos = parsePosition(cell.textContent, MAX_VALID_POSITION);
    if (pos) return pos;
  }

  return null;
}

function findPositionFromRow(row) {
  const cells = row.querySelectorAll('td');
  const cellPosition = findPositionFromCells(cells);
  if (cellPosition) return cellPosition;

  const tbody = row.closest('tbody');
  if (tbody) {
    const rows = [...tbody.querySelectorAll('tr')];
    const rowIndex = rows.indexOf(row) + 1;
    return rowIndex <= MAX_VALID_POSITION ? rowIndex : null;
  }

  return null;
}

function parseRiderFromRow(row, link, currentUserZwiftId) {
  const position = findPositionFromRow(row);
  if (!position) return null;

  const zwiftId = extractZwiftId(link.href);
  if (!zwiftId) return null;

  const name = link.textContent.trim();
  if (!name) return null;

  return {
    position,
    name,
    zwiftId,
    isCurrentUser: zwiftId === currentUserZwiftId,
  };
}

function getRidersFromPage() {
  const currentUserZwiftId = detectCurrentUserZwiftId();
  const { categoryId, categoryName, table } = getActiveCategory();

  if (!table) {
    return { riders: [], currentUserZwiftId, categoryId: null, categoryName: null };
  }

  const profileLinks = table.querySelectorAll(
    'a[href*="profile.php"], a[href*="/profile/"], a[href*="zwift_id"]'
  );

  const seenZwiftIds = new Set();
  const riders = [];

  for (const link of profileLinks) {
    const row = link.closest('tr');
    if (!row) continue;

    const rider = parseRiderFromRow(row, link, currentUserZwiftId);
    if (!rider) continue;
    if (seenZwiftIds.has(rider.zwiftId)) continue;

    seenZwiftIds.add(rider.zwiftId);
    riders.push(rider);
  }

  return {
    riders: riders.sort((a, b) => a.position - b.position),
    currentUserZwiftId,
    categoryId,
    categoryName,
  };
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
      if (currentSyncAbortController?.signal.aborted) {
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
        console.log(`[ZP Replay] HTTP ${response.status} for rider ${zwiftId}`);
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
        console.log(`[ZP Replay] Invalid JSON for rider ${zwiftId}`);
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
      console.log(`[ZP Replay] Fetch failed for rider ${zwiftId}: ${error.message}`);
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
  }
}

async function prepareSyncContext() {
  const eventId = getEventIdFromUrl();
  if (!eventId) {
    throw new Error('Not on a ZwiftPower event page');
  }

  await waitForTableData(TABLE_LOAD_TIMEOUT_MS);

  const eventName = getEventName();
  const { riders: allRiders, currentUserZwiftId, categoryId, categoryName } = getRidersFromPage();

  if (allRiders.length === 0) {
    throw new Error('No riders found in category.');
  }

  const ridersToSync = selectRidersToSync(allRiders, MAX_RIDERS_TO_SYNC);
  const fullEventName = categoryName ? `${eventName} - ${categoryName}` : eventName;
  const fullEventId = categoryId ? `${eventId}_${categoryId}` : eventId;

  const existingRace = await getExistingRaceData(fullEventId);
  const existingRiderIds = new Set(existingRace?.riders?.map(r => r.zwiftId) || []);
  const newRidersToSync = ridersToSync.filter(r => !existingRiderIds.has(r.zwiftId));

  return {
    eventId,
    fullEventId,
    fullEventName,
    allRiders,
    ridersToSync,
    newRidersToSync,
    existingRace,
    currentUserZwiftId,
    categoryId,
    categoryName,
  };
}

function createRiderWithAnalysis(rider, analysis) {
  return {
    position: rider.position,
    name: rider.name,
    zwiftId: rider.zwiftId,
    isCurrentUser: rider.isCurrentUser,
    ...analysis,
  };
}

function createRaceResult(ctx, riderData, errors, syncProgress, syncInProgress) {
  return {
    eventId: ctx.fullEventId,
    eventName: ctx.fullEventName,
    riders: riderData,
    errors,
    totalRiders: ctx.allRiders.length,
    syncedRiders: ctx.ridersToSync.length,
    successfulSyncs: riderData.length,
    currentUserZwiftId: ctx.currentUserZwiftId,
    categoryId: ctx.categoryId,
    categoryName: ctx.categoryName,
    syncedAt: new Date().toISOString(),
    syncInProgress,
    syncProgress,
  };
}

async function checkDataAvailability(ctx) {
  await updateSyncStatus({
    status: 'checking',
    eventId: ctx.fullEventId,
    eventName: ctx.fullEventName,
    message: 'Checking if race data is available...',
  });

  const testRider = ctx.newRidersToSync[0];
  const testAnalysis = await fetchRiderAnalysis(testRider.zwiftId, ctx.eventId);

  if (!testAnalysis) {
    throw new Error('Race analysis not ready yet. ZwiftPower may still be processing - try again later.');
  }

  return { testRider, testAnalysis };
}

async function syncRemainingRiders(ctx, riderData, errors, startIndex) {
  let consecutiveFailures = 0;

  for (let i = startIndex; i < ctx.newRidersToSync.length; i++) {
    if (currentSyncAbortController?.signal.aborted) {
      break;
    }

    const rider = ctx.newRidersToSync[i];

    await updateSyncStatus({
      status: 'syncing',
      eventId: ctx.fullEventId,
      eventName: ctx.fullEventName,
      current: i + 1,
      total: ctx.newRidersToSync.length,
      riderName: rider.name,
      riderPosition: rider.position,
      consecutiveFailures,
    });

    await delay(DELAY_BETWEEN_REQUESTS_MS);

    const analysis = await fetchRiderAnalysis(rider.zwiftId, ctx.eventId);

    if (analysis) {
      consecutiveFailures = 0;
      riderData.push(createRiderWithAnalysis(rider, analysis));

      const progress = { current: i + 1, total: ctx.newRidersToSync.length };
      const raceResult = createRaceResult(ctx, riderData, errors, progress, true);
      await saveRaceData(raceResult);
    } else {
      consecutiveFailures++;
      errors.push(rider.position);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        await updateSyncStatus({
          status: 'error',
          error: `Sync stopped: ${consecutiveFailures} consecutive failures. Try again later.`,
          eventId: ctx.fullEventId,
          eventName: ctx.fullEventName,
        });
        break;
      }
    }
  }
}

async function syncRaceData() {
  cancelSync();
  currentSyncAbortController = new AbortController();

  const ctx = await prepareSyncContext();

  if (ctx.newRidersToSync.length === 0) {
    await updateSyncStatus({
      status: 'complete',
      eventId: ctx.fullEventId,
      eventName: ctx.fullEventName,
      successfulSyncs: ctx.existingRace.riders.length,
      totalRiders: ctx.allRiders.length,
      errors: 0,
      message: 'All riders already synced',
    });
    return ctx.existingRace;
  }

  const { testRider, testAnalysis } = await checkDataAvailability(ctx);

  const riderData = [...(ctx.existingRace?.riders || [])];
  const errors = [];

  riderData.push(createRiderWithAnalysis(testRider, testAnalysis));

  const initialProgress = { current: 1, total: ctx.newRidersToSync.length };
  let raceResult = createRaceResult(ctx, riderData, errors, initialProgress, true);
  await saveRaceData(raceResult);

  await updateSyncStatus({
    status: 'syncing',
    eventId: ctx.fullEventId,
    eventName: ctx.fullEventName,
    current: 1,
    total: ctx.newRidersToSync.length,
    riderName: testRider.name,
    riderPosition: testRider.position,
  });

  await syncRemainingRiders(ctx, riderData, errors, 1);

  raceResult = createRaceResult(ctx, riderData, errors, null, false);
  await saveRaceData(raceResult);

  await updateSyncStatus({
    status: 'complete',
    eventId: ctx.fullEventId,
    eventName: ctx.fullEventName,
    successfulSyncs: riderData.length,
    totalRiders: ctx.allRiders.length,
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

      await waitForTableData(PAGE_INFO_TIMEOUT_MS);

      const { riders, categoryId, categoryName } = getRidersFromPage();
      const ridersToSync = selectRidersToSync(riders, MAX_RIDERS_TO_SYNC);

      sendResponse({
        eventId,
        eventName: getEventName(),
        riderCount: riders.length,
        syncCount: ridersToSync.length,
        isEventPage: true,
        userParticipates: riders.some(r => r.isCurrentUser),
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
